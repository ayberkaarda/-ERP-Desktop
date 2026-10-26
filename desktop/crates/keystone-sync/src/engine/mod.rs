//! Sync loop: read the manifest, push the outbox, then pull every manifest
//! resource.
//!
//! - One run at a time. Triggers coalesce: a trigger that arrives during a
//!   run schedules exactly one follow-up run ([`SyncEngine::run_once`]).
//! - A run never overwrites a local draft silently: push results go through
//!   the outbox, conflicts to the Conflict Inbox, and local reads
//!   ([`SyncEngine::list`], [`SyncEngine::get`]) lay pending drafts over the
//!   mirror.
//! - Pull requests are built from [`crate::store::MirrorStore::pull_base`] and applied with
//!   the same base; a `Stale` page is requested again from a fresh base. A
//!   request whose answer was lost is sent again unchanged (same cursor,
//!   session and `limit`) while the resource has not moved; when the
//!   manifest no longer allows its `limit`, the resource starts a new full
//!   download instead. Pulls that stop progressing fail the run.
//! - Identity: `UNAUTHENTICATED` keeps everything ([`SyncState::AuthRequired`]);
//!   a different user or company in the manifest wipes local data before
//!   anything is pushed; `USER_DEACTIVATED` wipes mirror, outbox, conflicts
//!   and tokens only when the token store recorded it for the current
//!   sign-in generation (see [`crate::client::HttpClient`]).
//! - Sign-in generation: a run belongs to the generation
//!   ([`crate::auth::SessionRecord::generation`]) it started in. Its calls
//!   are bound to it ([`SyncApi::manifest_in`] and friends), answers are
//!   committed only while it is still current, and a run cut short by a
//!   new sign-in is followed by a run under the new one.
//! - Local access: [`SyncEngine::list`], [`SyncEngine::get`] and
//!   [`SyncEngine::enqueue`] answer only when the local data was verified by
//!   a manifest of the current generation (not deactivated), and only for
//!   resources of that manifest. After another sign-in they fail with
//!   `OFFLINE_UNAVAILABLE` until a run has checked who signed in. Enqueue,
//!   sign-out and every wipe exclude each other.
//! - State is published through [`SyncEngine::subscribe`]; changed resources
//!   through [`SyncEngine::subscribe_changes`], also for a run that is
//!   cancelled midway.
//!
//! Store calls are synchronous SQLite work run inline on the calling task
//! (bounded: one push batch or one pull page at a time). Run the sync loop
//! on its own runtime thread so it cannot stall other tasks.

mod driver;
mod local;
mod overlay;
mod pass;
#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::time::Duration;

use serde_json::{Map, Value};
use tokio::sync::{broadcast, watch};
use uuid::Uuid;

use crate::auth::{Session, TokenStore, TokenWrite};
use crate::backoff::Backoff;
use crate::client::SyncApi;
use crate::conflicts::{ConflictInbox, ConflictRecord, ConflictStore, ResolutionAction};
use crate::error::{Result, SyncError};
use crate::outbox::{EnqueueOutcome, NewMutation, Outbox, OutboxEntry, OutboxQueue};
use crate::store::{ListQuery, Migration, PullBase, ResourceSpec, Store};
use crate::wire::{ConflictChoice, ErrorCode, MutationOp, PullResource, ResourceName};

pub use driver::{SyncHandle, SyncLoop, next_delay, sync_loop};
pub use overlay::{LocalPage, LocalRow};

/// Ids 300..=399.
pub const MIGRATIONS: &[Migration] = &[Migration {
    id: 300,
    module: "engine",
    name: "engine_state",
    sql: "CREATE TABLE engine_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE engine_draft_bases (
        resource TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (resource, id)
    ) STRICT;",
}];

/// Upper bound of push batches in one run (the rest waits for the next run).
pub const MAX_PUSH_BATCHES: usize = 100;

/// Upper bound of pull requests in one run; a pull still unfinished after
/// it fails the run.
pub const MAX_PULL_REQUESTS: usize = 10_000;

/// `Stale` answers per resource and run before the run fails.
pub const MAX_STALE_PAGES: usize = 3;

/// Server resets per resource and run before the run fails.
pub const MAX_SERVER_RESETS: usize = 2;

/// Consecutive `has_more` pages per resource that bring nothing and do not
/// move the cursor before the run fails.
pub const MAX_IDLE_PAGES: usize = 3;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Trigger {
    Startup,
    /// Online interval elapsed.
    Timer,
    /// Offline probe found the server again.
    Probe,
    /// OS reported a network change.
    NetworkChanged,
    Manual,
    /// Realtime event for a resource (the Reverb client comes with D3).
    Realtime(ResourceName),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncState {
    Idle,
    Syncing,
    Offline,
    /// Signed out, 401 after refresh, or deactivated. The outbox is kept
    /// (except after a deactivation wipe) until the user signs in again.
    AuthRequired,
    /// Last run failed with this code; next attempt after backoff.
    Failed(&'static str),
}

/// Observable engine status: state plus the counts the UI shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncStatus {
    pub state: SyncState,
    /// Outbox entries waiting or in flight.
    pub pending: usize,
    /// Open Conflict Inbox records.
    pub conflicts: usize,
    /// Entries the server rejected; the user retries or discards them.
    pub rejected: usize,
    /// Entries parked after repeated transient failures (outbox quarantine).
    pub quarantined: usize,
    /// Consecutive failed runs.
    pub failures: u32,
    /// `Retry-After` of the last failure.
    pub retry_after: Option<Duration>,
}

impl Default for SyncStatus {
    fn default() -> Self {
        Self {
            state: SyncState::Idle,
            pending: 0,
            conflicts: 0,
            rejected: 0,
            quarantined: 0,
            failures: 0,
            retry_after: None,
        }
    }
}

/// `ResourcesChanged`: invalidate `[resource, ...]` queries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourcesChanged {
    pub resources: Vec<ResourceName>,
}

/// Result of one run. `changed` drives `[resource, ...]` query invalidation.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SyncReport {
    pub pushed: usize,
    pub conflicts: usize,
    pub rejected: usize,
    pub rows_upserted: usize,
    pub rows_removed: usize,
    /// Pull pages answered `Stale` and requested again.
    pub stale_pages: usize,
    /// Pull requests sent.
    pub pull_requests: usize,
    pub changed: Vec<ResourceName>,
    /// A run was already in progress: this call only scheduled a follow-up.
    pub coalesced: bool,
}

impl SyncReport {
    fn touch(&mut self, resource: &ResourceName) {
        if !self.changed.contains(resource) {
            self.changed.push(resource.clone());
        }
    }
}

/// Answer of [`SyncEngine::sign_out`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SignOut {
    /// Tokens and local data are gone.
    Done,
    /// Nothing was changed: unsent work exists; call again with `force`.
    PendingWork { outbox: usize, conflicts: usize },
}

#[derive(Debug, Default)]
struct Gate {
    running: bool,
    queued: bool,
}

/// Frees the run slot when a run is cancelled or panics. A run that ends
/// normally frees it itself, in the same critical section that checks for
/// a follow-up, and disarms this guard. A follow-up already promised to a
/// coalesced caller is handed to the sync loop ([`SyncEngine::follow_up_requested`]).
struct Running<'a> {
    gate: &'a Mutex<Gate>,
    follow_up: &'a tokio::sync::Notify,
    armed: bool,
    /// The pass in progress is a follow-up promised to a coalesced caller:
    /// the debt stays until that pass completes.
    owed: bool,
}

impl Drop for Running<'_> {
    fn drop(&mut self) {
        if self.armed {
            let mut gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
            gate.running = false;
            if std::mem::take(&mut gate.queued) || self.owed {
                self.follow_up.notify_one();
            }
        }
    }
}

/// Settles state and change notifications of a pass whose future is
/// dropped before it finishes.
struct PassGuard<'a, A> {
    engine: &'a SyncEngine<A>,
    before: SyncState,
    done: bool,
}

impl<A> Drop for PassGuard<'_, A> {
    fn drop(&mut self) {
        if !self.done {
            self.engine.cancelled(self.before.clone());
        }
    }
}

type PendingPulls = HashMap<ResourceName, (PullBase, PullResource)>;

/// Test seams: points where a unit test can act in the middle of a step
/// (no-ops outside unit tests).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Hook {
    /// `run_once` decided whether to run again.
    GateDecided,
    /// `sign_out` counted the unsent work and has not wiped yet.
    SignOutCounted,
    /// A local read passed its access check and has not read yet.
    AccessChecked,
    /// A push answer passed its commit check and is not written yet.
    CommitChecked,
}

#[cfg(test)]
type HookFn = dyn Fn(Hook) + Send + Sync;

/// The sync engine of one profile. It owns local access: reads, writes and
/// outbox or conflict work go through its guarded methods. There is no raw
/// store, outbox, conflict or API accessor:
///
/// ```compile_fail
/// fn raw<A: keystone_sync::client::SyncApi>(e: &keystone_sync::engine::SyncEngine<A>) {
///     let _ = e.outbox();
/// }
/// ```
///
/// ```compile_fail
/// fn raw<A: keystone_sync::client::SyncApi>(e: &keystone_sync::engine::SyncEngine<A>) {
///     let _ = e.store();
/// }
/// ```
///
/// ```compile_fail
/// fn raw<A: keystone_sync::client::SyncApi>(e: &keystone_sync::engine::SyncEngine<A>) {
///     let _ = e.conflicts();
/// }
/// ```
///
/// ```compile_fail
/// fn raw<A: keystone_sync::client::SyncApi>(e: &keystone_sync::engine::SyncEngine<A>) {
///     let _ = e.api();
/// }
/// ```
///
/// The guarded ones are there (positive control of the blocks above):
///
/// ```no_run
/// fn guarded<A: keystone_sync::client::SyncApi>(e: &keystone_sync::engine::SyncEngine<A>) {
///     let _ = e.outbox_entries();
///     let _ = e.conflict_records();
///     let _ = e.status();
/// }
/// ```
pub struct SyncEngine<A> {
    api: A,
    store: Arc<Store>,
    outbox: Outbox,
    conflicts: ConflictStore,
    tokens: Arc<dyn TokenStore>,
    profile: String,
    specs: Vec<ResourceSpec>,
    pull_limit: Option<u32>,
    backoff: Backoff,
    gate: Mutex<Gate>,
    /// Held by a run and by sign-out.
    work: tokio::sync::Mutex<()>,
    /// Local data guard, never held across an await: reads, enqueues and
    /// answer commits share it; identity changes, wipes and sign-out take
    /// it exclusively.
    local: RwLock<()>,
    /// Last pull request per resource, with the base it was built from.
    pending_pulls: Mutex<PendingPulls>,
    /// Resources changed by the running pass and not announced yet.
    unreported: Mutex<Vec<ResourceName>>,
    failures: AtomicU32,
    status: watch::Sender<SyncStatus>,
    changes: broadcast::Sender<ResourcesChanged>,
    /// Signalled when a cancelled run leaves a promised follow-up behind.
    follow_up: tokio::sync::Notify,
    /// Process-wide session of the profile (sign-in gate).
    session: Arc<Session>,
    #[cfg(test)]
    hook: Mutex<Option<Arc<HookFn>>>,
}

impl<A> std::fmt::Debug for SyncEngine<A> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SyncEngine")
            .field("store", &self.store)
            .field("profile", &self.profile)
            .finish_non_exhaustive()
    }
}

impl<A: SyncApi> SyncEngine<A> {
    /// `tokens` and `profile` must be the token store and profile id the API
    /// client uses: the engine reads the sign-in generation and the
    /// deactivation mark from there and clears the tokens on sign-out.
    pub fn new(
        api: A,
        store: Arc<Store>,
        tokens: Arc<dyn TokenStore>,
        profile: impl Into<String>,
    ) -> Self {
        let profile = profile.into();
        let session = Session::shared(&profile, tokens.as_ref());
        Self {
            api,
            outbox: Outbox::new(store.clone()),
            conflicts: ConflictStore::new(store.clone()),
            store,
            tokens,
            profile,
            specs: Vec::new(),
            pull_limit: None,
            backoff: Backoff::default(),
            gate: Mutex::default(),
            work: tokio::sync::Mutex::new(()),
            local: RwLock::new(()),
            pending_pulls: Mutex::default(),
            unreported: Mutex::default(),
            failures: AtomicU32::new(0),
            status: watch::Sender::new(SyncStatus::default()),
            changes: broadcast::channel(64).0,
            follow_up: tokio::sync::Notify::new(),
            session,
            #[cfg(test)]
            hook: Mutex::default(),
        }
    }

    pub fn with_backoff(mut self, backoff: Backoff) -> Self {
        self.backoff = backoff;
        self
    }

    /// Local layouts (e.g. [`crate::store::specs_from_offline_manifest`]).
    /// A manifest resource without a spec here gets master-data defaults.
    /// The manifest's `read` and `source` always win.
    pub fn with_specs(mut self, specs: Vec<ResourceSpec>) -> Self {
        self.specs = specs;
        self
    }

    /// Pull page size; default the manifest's `pull_page_default`. Clamped
    /// to `1..=pull_page_max`.
    pub fn with_pull_limit(mut self, limit: u32) -> Self {
        self.pull_limit = Some(limit);
        self
    }

    /// One manifest → push → pull pass. When a run is already in progress
    /// this only schedules one follow-up run (whatever the number of calls)
    /// and returns at once with `coalesced: true`; the running call performs
    /// the follow-up before it returns.
    pub async fn run_once(&self, trigger: Trigger) -> Result<SyncReport> {
        if !self.enter_gate() {
            return Ok(SyncReport {
                coalesced: true,
                ..SyncReport::default()
            });
        }
        let mut running = Running {
            gate: &self.gate,
            follow_up: &self.follow_up,
            armed: true,
            owed: false,
        };
        let mut trigger = trigger;
        loop {
            let result = self.pass(trigger).await;
            // Checking for a follow-up and freeing the slot is one step: a
            // caller that finds the slot taken is always served.
            let again = {
                let mut gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
                if gate.queued {
                    gate.queued = false;
                    true
                } else {
                    gate.running = false;
                    false
                }
            };
            // The pass just finished paid any earlier debt; a new one starts now.
            running.owed = again;
            self.hook(Hook::GateDecided);
            if !again {
                running.armed = false;
                return result;
            }
            trigger = Trigger::Manual;
        }
    }

    /// Takes the single run slot, or records one follow-up run for the
    /// caller that holds it (`false`).
    fn enter_gate(&self) -> bool {
        let mut gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
        if gate.running {
            gate.queued = true;
            return false;
        }
        gate.running = true;
        gate.queued = false;
        true
    }

    /// Current status.
    pub fn status(&self) -> SyncStatus {
        self.status.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<SyncStatus> {
        self.status.subscribe()
    }

    pub fn subscribe_changes(&self) -> broadcast::Receiver<ResourcesChanged> {
        self.changes.subscribe()
    }

    /// Recounts outbox and conflicts into the published status.
    pub fn refresh_status(&self) -> Result<SyncStatus> {
        let counts = local::counts(&self.store)?;
        self.status.send_modify(|status| counts.apply(status));
        Ok(self.status())
    }

    /// Queues a local write. For updates, deletes and actions the current
    /// mirror row is kept as the draft's base, so the draft stays readable
    /// when retention or a reset removes the mirror row.
    ///
    /// Fails without queueing while the local data is not verified for the
    /// current sign-in (see the module docs) or when the resource is not in
    /// the manifest. Excluded with sign-out and wipes: a write is either
    /// counted by sign-out or refused, never silently deleted.
    pub fn enqueue(&self, mutation: NewMutation) -> Result<EnqueueOutcome> {
        let resource = mutation.resource.clone();
        let outcome = {
            let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
            // No sign-in completes between the check below and the work.
            let _sign_in = self.session.hold();
            self.check_access(&resource)?;
            if mutation.op != MutationOp::Create {
                local::save_base(&self.store, &resource, mutation.id)?;
            }
            self.outbox.enqueue_outcome(mutation)?
        };
        self.refresh_status()?;
        self.emit(vec![resource]);
        Ok(outcome)
    }

    /// Local list: mirror rows with pending drafts laid over them. Same
    /// access rule as [`SyncEngine::enqueue`].
    pub fn list(&self, resource: &ResourceName, query: &ListQuery) -> Result<LocalPage> {
        let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
        // No sign-in completes between the check below and the work.
        let _sign_in = self.session.hold();
        self.check_access(resource)?;
        self.hook(Hook::AccessChecked);
        overlay::list(&self.store, resource, query)
    }

    /// Local row, draft first. Same access rule as [`SyncEngine::enqueue`].
    pub fn get(&self, resource: &ResourceName, id: Uuid) -> Result<Option<LocalRow>> {
        let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
        // No sign-in completes between the check below and the work.
        let _sign_in = self.session.hold();
        self.check_access(resource)?;
        overlay::get(&self.store, resource, id)
    }

    /// Signs out the sign-in current at the call: removes its tokens, and
    /// mirror, outbox and conflicts. With unsent work (any outbox entry or
    /// open conflict) nothing happens unless `force`. Waits for a running
    /// pass and for token work of the profile (a refresh in flight cannot
    /// write tokens back afterwards); counting and wiping exclude
    /// [`SyncEngine::enqueue`]. Tokens of a sign-in made after the call
    /// stay ([`TokenStore::sign_out`] is a compare-and-set).
    pub async fn sign_out(&self, force: bool) -> Result<SignOut> {
        let generation = self.generation()?;
        let _work = self.work.lock().await;
        let _tokens = self.session.lock().await;
        let _local = self.local.write().unwrap_or_else(PoisonError::into_inner);
        // A sign-out whose cleanup failed earlier is only finished here.
        let retry = local::session(&self.store)?.wipe_pending;
        let counts = local::counts(&self.store)?;
        self.hook(Hook::SignOutCounted);
        let outbox = counts.pending + counts.rejected + counts.quarantined + counts.in_conflict;
        if !retry && !force && (outbox > 0 || counts.conflicts > 0) {
            return Ok(SignOut::PendingWork {
                outbox,
                conflicts: counts.conflicts,
            });
        }
        // Access closes first; the tokens go next; local data last. A failed
        // revoke changes nothing; a failed cleanup leaves the data closed
        // and is retried by the next sign-out or run.
        local::set_wipe_pending(&self.store, true)?;
        if let Err(error) = self
            .tokens
            .sign_out(&TokenWrite::new(), &self.profile, generation)
        {
            if !retry {
                let _ = local::set_wipe_pending(&self.store, false);
            }
            return Err(error);
        }
        // The local data is the signing-out user's (a later sign-in is not
        // verified yet, so it has none).
        self.wipe()?;
        self.set_state(SyncState::AuthRequired, None)?;
        Ok(SignOut::Done)
    }

    pub fn backoff(&self) -> &Backoff {
        &self.backoff
    }

    /// Outbox entries (every state), for the pending-work and quarantine
    /// views. Same verification rule as [`SyncEngine::enqueue`].
    pub fn outbox_entries(&self) -> Result<Vec<OutboxEntry>> {
        self.guarded(|| self.outbox.list())
    }

    /// Sends a rejected or quarantined entry again.
    pub fn retry(&self, key: Uuid) -> Result<()> {
        self.guarded(|| self.outbox.retry(key))?;
        self.refresh_status().map(|_| ())
    }

    /// Drops a rejected or quarantined entry.
    pub fn discard(&self, key: Uuid) -> Result<()> {
        self.guarded(|| self.outbox.discard(key))?;
        self.refresh_status().map(|_| ())
    }

    /// Open Conflict Inbox records.
    pub fn conflict_records(&self) -> Result<Vec<ConflictRecord>> {
        self.guarded(|| self.conflicts.list())
    }

    /// See [`ConflictInbox::resolve`]; an `Enqueue` action goes through
    /// [`SyncEngine::enqueue`].
    pub fn resolve_conflict(&self, key: Uuid, choice: ConflictChoice) -> Result<ResolutionAction> {
        let action = self.guarded(|| self.conflicts.resolve(key, choice))?;
        self.refresh_status()?;
        Ok(action)
    }

    /// See [`ConflictInbox::resolve_use_existing`].
    pub fn resolve_conflict_use_existing(
        &self,
        key: Uuid,
        candidate: Uuid,
    ) -> Result<ResolutionAction> {
        let action = self.guarded(|| self.conflicts.resolve_use_existing(key, candidate))?;
        self.refresh_status()?;
        Ok(action)
    }

    /// See [`ConflictInbox::resolve_merge`].
    pub fn resolve_conflict_merge(
        &self,
        key: Uuid,
        merged_payload: Map<String, Value>,
    ) -> Result<ResolutionAction> {
        let action = self.guarded(|| self.conflicts.resolve_merge(key, merged_payload))?;
        self.refresh_status()?;
        Ok(action)
    }

    /// Resolves when a follow-up run was promised to a coalesced caller but
    /// the run that owed it was cancelled; the sync loop then runs it.
    pub async fn follow_up_requested(&self) {
        self.follow_up.notified().await;
    }

    /// `f` under the local guard, for a verified sign-in only.
    fn guarded<T>(&self, f: impl FnOnce() -> Result<T>) -> Result<T> {
        let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
        // No sign-in completes between the check below and the work.
        let _sign_in = self.session.hold();
        self.check_verified()?;
        f()
    }

    /// One pass under the work lock, with state publication and the
    /// identity-loss rules applied to its error.
    async fn pass(&self, trigger: Trigger) -> Result<SyncReport> {
        let _work = self.work.lock().await;
        let before = self.status.borrow().state.clone();
        self.status
            .send_modify(|status| status.state = SyncState::Syncing);
        let mut guard = PassGuard {
            engine: self,
            before,
            done: false,
        };
        let mut report = SyncReport::default();
        let (generation, result) = match self.generation() {
            Ok(generation) => (
                Some(generation),
                self.pass_inner(&trigger, generation, &mut report).await,
            ),
            Err(error) => (None, Err(error)),
        };
        guard.done = true;
        self.unreported
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
        if !report.changed.is_empty() {
            self.emit(report.changed.clone());
        }
        let moved = |engine: &Self| {
            generation.is_some_and(|g| engine.generation().is_ok_and(|now| now != g))
        };
        match result {
            Ok(()) => {
                self.failures.store(0, Ordering::SeqCst);
                self.set_state(SyncState::Idle, None)?;
                if moved(self) {
                    self.queue_follow_up();
                }
                Ok(report)
            }
            Err(error) => {
                let state = self.on_error(&error)?;
                if moved(self) {
                    // Cut short by another sign-in: run again at once under
                    // it; that run publishes the state.
                    self.queue_follow_up();
                    return Err(error);
                }
                if matches!(state, SyncState::Failed(_)) {
                    self.failures.fetch_add(1, Ordering::SeqCst);
                }
                self.set_state(state, error.retry_after())?;
                Err(error)
            }
        }
    }

    /// State for `error`; runs the deactivation wipe for the current
    /// sign-in generation.
    fn on_error(&self, error: &SyncError) -> Result<SyncState> {
        let deactivated = matches!(
            error,
            SyncError::Api {
                code: ErrorCode::UserDeactivated,
                ..
            }
        );
        if !deactivated {
            return Ok(state_after_error(error));
        }
        let _local = self.local.write().unwrap_or_else(PoisonError::into_inner);
        // The client marks the record only when the 403 answered a call of
        // the current generation; a stale one leaves the mark unset.
        let record = self.tokens.load_record(&self.profile)?;
        if !record.deactivated {
            return Ok(SyncState::Failed(error.code()));
        }
        // The local data is the deactivated user's, whatever happens next.
        self.wipe()?;
        // Compare-and-set: tokens of a sign-in made after the mark was read
        // stay (the client already removed the deactivated ones).
        self.tokens
            .deactivate(&TokenWrite::new(), &self.profile, record.generation)?;
        Ok(SyncState::AuthRequired)
    }

    /// Local access rule of reads and enqueues; the caller holds `local`.
    fn check_access(&self, resource: &ResourceName) -> Result<()> {
        let session = self.check_verified()?;
        if !session.resources.contains(resource) {
            return Err(SyncError::Api {
                status: 403,
                code: ErrorCode::Forbidden,
                message: "resource is not in the offline manifest".to_owned(),
                fields: BTreeMap::new(),
                retry_after: None,
                redacted: None,
            });
        }
        Ok(())
    }

    /// The local data was verified by a manifest of the current sign-in
    /// generation, which is not deactivated. Returns that local session.
    fn check_verified(&self) -> Result<local::LocalSession> {
        let record = self.tokens.load_record(&self.profile)?;
        let session = local::session(&self.store)?;
        if record.deactivated
            || session.wipe_pending
            || session.generation != Some(record.generation)
        {
            return Err(SyncError::OfflineUnavailable(
                "local data is not verified for the current sign-in yet; sync first".to_owned(),
            ));
        }
        Ok(session)
    }

    /// Current sign-in generation of the profile.
    fn generation(&self) -> Result<u64> {
        Ok(self.tokens.load_record(&self.profile)?.generation)
    }

    /// Fails when another sign-in happened since `generation`.
    fn ensure_generation(&self, generation: u64) -> Result<()> {
        if self.generation()? == generation {
            Ok(())
        } else {
            Err(session_changed())
        }
    }

    fn queue_follow_up(&self) {
        self.gate
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .queued = true;
    }
}

impl<A> SyncEngine<A> {
    /// Removes mirror, outbox, conflicts and engine state; the caller holds
    /// `local` exclusively.
    fn wipe(&self) -> Result<()> {
        let names = local::wipe(&self.store)?;
        self.pending_pulls
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
        if !names.is_empty() {
            self.emit(names);
        }
        Ok(())
    }

    /// Marks `resource` changed in `report` and for a cancelled pass.
    fn touch(&self, report: &mut SyncReport, resource: &ResourceName) {
        report.touch(resource);
        let mut unreported = self
            .unreported
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if !unreported.contains(resource) {
            unreported.push(resource.clone());
        }
    }

    /// A pass was dropped midway: announce what it changed and leave
    /// `Syncing`. Outbox entries it left in flight go back to the queue at
    /// the start of the next pass.
    fn cancelled(&self, before: SyncState) {
        let names = std::mem::take(
            &mut *self
                .unreported
                .lock()
                .unwrap_or_else(PoisonError::into_inner),
        );
        if !names.is_empty() {
            self.emit(names);
        }
        let state = if before == SyncState::Syncing {
            SyncState::Idle
        } else {
            before
        };
        let counts = local::counts(&self.store);
        self.status.send_modify(|status| {
            status.state = state;
            if let Ok(counts) = &counts {
                counts.apply(status);
            }
        });
    }

    fn set_state(&self, state: SyncState, retry_after: Option<Duration>) -> Result<()> {
        let counts = local::counts(&self.store);
        let failures = self.failures.load(Ordering::SeqCst);
        self.status.send_modify(|status| {
            status.state = state;
            status.failures = failures;
            status.retry_after = retry_after;
            if let Ok(counts) = &counts {
                counts.apply(status);
            }
        });
        counts.map(|_| ())
    }

    fn emit(&self, resources: Vec<ResourceName>) {
        // No subscriber is not an error.
        let _ = self.changes.send(ResourcesChanged { resources });
    }

    #[cfg(test)]
    fn set_hook(&self, hook: impl Fn(Hook) + Send + Sync + 'static) {
        *self.hook.lock().unwrap_or_else(PoisonError::into_inner) = Some(Arc::new(hook));
    }

    #[cfg(test)]
    fn hook(&self, point: Hook) {
        let hook = self
            .hook
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        if let Some(hook) = hook {
            hook(point);
        }
    }

    #[cfg(not(test))]
    #[inline(always)]
    fn hook(&self, _point: Hook) {}
}

/// State after a failed run, by error.
pub fn state_after_error(error: &SyncError) -> SyncState {
    match error {
        SyncError::Network(_) | SyncError::NotSent(_) | SyncError::OfflineUnavailable(_) => {
            SyncState::Offline
        }
        SyncError::Api {
            code: ErrorCode::Unauthenticated | ErrorCode::UserDeactivated,
            ..
        } => SyncState::AuthRequired,
        other => SyncState::Failed(other.code()),
    }
}

/// Counts towards the outbox quarantine: the server answered with a
/// failure that resending later is expected to fix, or the answer was lost
/// (`Network`: the batch may have been applied; after the attempt limit
/// the user decides instead of the batch holding the queue forever), and so
/// was an unreadable answer (`Decode`). A request that was never sent
/// (`NotSent`) does not count.
fn is_transient(error: &SyncError) -> bool {
    match error {
        SyncError::Network(_) => true,
        // A 2xx answer that cannot be read: the batch may have been applied.
        SyncError::Decode(_) => true,
        SyncError::Api { status, code, .. } => {
            *status >= 500 || *status == 429 || *code == ErrorCode::IdempotencyInProgress
        }
        _ => false,
    }
}

/// A run's answer arrived, or its next call was due, after another sign-in.
fn session_changed() -> SyncError {
    SyncError::Api {
        status: 401,
        code: ErrorCode::Unauthenticated,
        message: "another sign-in happened during the sync run".to_owned(),
        fields: BTreeMap::new(),
        retry_after: None,
        redacted: None,
    }
}

/// An answer that breaks the protocol (rows outside the request, a pull
/// that does not progress).
fn invalid_answer(message: &str) -> SyncError {
    SyncError::Decode(<serde_json::Error as serde::de::Error>::custom(message))
}
