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
//! - Identity: exhausted authentication closes local reads while retaining data.
//!   Company access loss and current-generation deactivation remove the mirror
//!   and seal pending work (deactivation deletes the outbox and conflicts too).
//!   Sealed work (company access loss only) can be reopened by the same
//!   identity after verification;
//!   a different identity wipes it before pushing. Deactivation clears tokens
//!   only for the marked generation (see [`crate::client::HttpClient`]).
//! - Sign-in generation: a run belongs to the generation
//!   ([`crate::auth::SessionRecord::generation`]) it started in. Its calls
//!   are bound to it ([`SyncApi::manifest_in`] and friends), answers are
//!   committed only while it is still current, and a run cut short by a
//!   new sign-in is followed by a run under the new one.
//! - Local access: [`SyncEngine::list`], [`SyncEngine::get`],
//!   [`SyncEngine::snapshot`], [`SyncEngine::enqueue`] and
//!   [`SyncEngine::put_snapshot`] answer only when the local data was
//!   verified by a manifest of the current generation (not deactivated, not
//!   sealed), and only for resources of that manifest. After another
//!   sign-in they fail with `OFFLINE_UNAVAILABLE` until a run has checked
//!   who signed in; a snapshot is stored only for the generation its answer
//!   was fetched in. Writes, sign-out and every wipe exclude each other.
//! - Session answer: [`SyncEngine::put_session_copy`] keeps the last
//!   `GET /auth/me` answer of a sign-in in `engine_meta` (the encrypted
//!   store, no token in it) and [`SyncEngine::session_copy`] gives it back
//!   under the same rule, for that sign-in, user and company only. Sign-out,
//!   every wipe, seal and close remove it; a run keeps it only for its own
//!   sign-in, user and company.
//! - Sign-out is persisted in stages bound to its generation: tokens of
//!   that generation are revoked before any local data goes, and a
//!   sign-out cut short is finished for that generation only (a later
//!   sign-in keeps its tokens). Just before the tokens go, the server is
//!   asked to end the sign-in, best effort and within
//!   [`SERVER_SIGN_OUT_TIMEOUT`]; the local sign-out never waits on more.
//! - Offline writes: [`SyncEngine::enqueue`] applies the resource's
//!   [`WritePolicy`] (offline manifest `write`) to the row the user sees,
//!   and closes while the compiled offline manifest
//!   ([`SyncEngine::offline_manifest_version`]) differs from the server's
//!   (`SyncStatus::manifest_mismatch`); reads go on.
//! - Tokens: the engine reads and writes them only through the profile's
//!   [`Session`], the same one its API client works in.
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
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::time::Duration;

use serde_json::{Map, Value};
use tokio::sync::{broadcast, watch};
use uuid::Uuid;

use crate::auth::{Session, TokenWrite};
use crate::backoff::{Backoff, RETRY_AFTER_MAX};
use crate::client::SyncApi;
use crate::conflicts::{ConflictInbox, ConflictRecord, ConflictStore, ResolutionAction};
use crate::error::refused;
use crate::error::{Result, SyncError};
use crate::outbox::{
    EnqueueOutcome, KeyedOutcome, NewMutation, Outbox, OutboxEntry, OutboxQueue, RequestKey,
    RequestRecord,
};
use crate::store::{
    ListQuery, Migration, OfflineManifest, PruneReport, PullBase, ResourceSpec, Snapshot, Store,
    WritePolicy,
};
use crate::wire::{
    ConflictChoice, ErrorCode, MutationOp, PullResource, ResourceName, Source, Timestamp,
};

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

/// How long [`SyncEngine::sign_out`] waits for the server to end the
/// sign-in (`POST /api/v1/auth/logout`) before it signs out locally anyway.
pub const SERVER_SIGN_OUT_TIMEOUT: Duration = Duration::from_secs(4);

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
    /// `Retry-After` of the last failure: no run starts before it passes.
    pub retry_after: Option<Duration>,
    /// The server's `offline_manifest_version` differs from the offline
    /// manifest compiled into the client: offline writes are closed (reads
    /// and online writes go on) until the versions match again.
    pub manifest_mismatch: bool,
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
            manifest_mismatch: false,
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
    /// Tokens and local data are gone. `server_revoked`: the server
    /// confirmed that the sign-in ended (or was already gone there), now or
    /// when this sign-out first asked it. `false`: not confirmed: the server
    /// could not be told within [`SERVER_SIGN_OUT_TIMEOUT`], refused, or no
    /// token of the sign-in was left to tell it with; its tokens may stay
    /// valid there until they expire or the device is signed out from
    /// another session.
    Done { server_revoked: bool },
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
    /// A sign-out revoked its tokens and has not wiped yet.
    SignOutRevoked,
    /// A local read passed its access check and has not read yet.
    AccessChecked,
    /// A push answer passed its commit check and is not written yet.
    CommitChecked,
    /// A failed pass found no other sign-in and has not published yet.
    FailureKept,
    /// A session answer passed its checks and is not written yet.
    SessionCopyChecked,
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
///
/// The engine works in the session of its API client and in no other: the
/// constructor takes no session, it is derived from the client
/// ([`SyncApi::session`]).
///
/// ```compile_fail
/// use std::sync::Arc;
/// use keystone_sync::auth::{MemoryTokenStore, Session};
/// use keystone_sync::client::HttpClient;
/// use keystone_sync::engine::SyncEngine;
/// use keystone_sync::store::Store;
/// fn build(client: HttpClient, db: Arc<Store>) {
///     let other = Session::shared("other", Arc::new(MemoryTokenStore::default()));
///     let _ = SyncEngine::new(client, db, other);
/// }
/// ```
///
/// ```no_run
/// use std::sync::Arc;
/// use keystone_sync::client::HttpClient;
/// use keystone_sync::engine::SyncEngine;
/// use keystone_sync::store::Store;
/// fn build(client: HttpClient, db: Arc<Store>) {
///     let _ = SyncEngine::new(client, db);
/// }
/// ```
pub struct SyncEngine<A> {
    api: A,
    store: Arc<Store>,
    outbox: Outbox,
    conflicts: ConflictStore,
    specs: Vec<ResourceSpec>,
    /// `manifest_version` of the compiled offline manifest, when given.
    offline_version: Option<u32>,
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
    /// End of the last failure's `Retry-After`: no pass starts before it.
    /// Set under the sign-in generation it belongs to.
    retry_not_before: Mutex<Option<(tokio::time::Instant, u64)>>,
    /// Wakes a run waiting on `retry_not_before` to re-evaluate it.
    retry_changed: tokio::sync::Notify,
    status: watch::Sender<SyncStatus>,
    /// Passes started so far (passes run one at a time, so the n-th pass to
    /// start is the n-th to end).
    started: AtomicU64,
    /// The number of the last pass that finished, set after it published
    /// its outcome. A pass cut short is not announced.
    passes: watch::Sender<u64>,
    changes: broadcast::Sender<ResourcesChanged>,
    /// Signalled when a cancelled run leaves a promised follow-up behind.
    follow_up: tokio::sync::Notify,
    /// Process-wide session of the profile: its token store handle, the
    /// profile id, the token lock and the sign-in gate.
    session: Arc<Session>,
    #[cfg(test)]
    hook: Mutex<Option<Arc<HookFn>>>,
}

impl<A> std::fmt::Debug for SyncEngine<A> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SyncEngine")
            .field("store", &self.store)
            .field("session", &self.session)
            .finish_non_exhaustive()
    }
}

impl<A: SyncApi> SyncEngine<A> {
    /// The engine works in the session of `api` ([`SyncApi::session`]): it
    /// reads the sign-in generation and the deactivation mark through it
    /// and revokes the tokens on sign-out through it, so engine and client
    /// are never over different stores or profiles.
    pub fn new(api: A, store: Arc<Store>) -> Self {
        let session = api.session().clone();
        Self {
            api,
            outbox: Outbox::new(store.clone()),
            conflicts: ConflictStore::new(store.clone()),
            store,
            specs: Vec::new(),
            offline_version: None,
            pull_limit: None,
            backoff: Backoff::default(),
            gate: Mutex::default(),
            work: tokio::sync::Mutex::new(()),
            local: RwLock::new(()),
            pending_pulls: Mutex::default(),
            unreported: Mutex::default(),
            failures: AtomicU32::new(0),
            retry_not_before: Mutex::default(),
            retry_changed: tokio::sync::Notify::new(),
            status: watch::Sender::new(SyncStatus::default()),
            started: AtomicU64::new(0),
            passes: watch::Sender::new(0),
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

    /// Specs and content version of the compiled offline manifest
    /// ([`crate::store::offline_manifest`]). The version is compared with
    /// every sync manifest (`SyncStatus::manifest_mismatch`).
    /// The status shows a mismatch stored by an earlier run at once, so an
    /// offline start warns before any manifest arrives.
    pub fn with_offline_manifest(mut self, manifest: OfflineManifest) -> Self {
        self.specs = manifest.specs;
        self.offline_version = Some(manifest.manifest_version);
        // A store failure leaves `false`; `enqueue` reads the store itself.
        if let Ok(session) = local::session(&self.store) {
            let mismatch = self.mismatch(session.offline_manifest_version);
            self.status
                .send_modify(|status| status.manifest_mismatch = mismatch);
        }
        self
    }

    /// `manifest_version` of the compiled offline manifest; `None` when
    /// the engine was built from specs alone (no version check).
    pub fn offline_manifest_version(&self) -> Option<u32> {
        self.offline_version
    }

    /// Offline write rules of `resource` from the compiled specs. `None`:
    /// no spec or a spec without rules (the server decides alone).
    pub fn write_policy(&self, resource: &ResourceName) -> Option<WritePolicy> {
        self.specs
            .iter()
            .find(|s| &s.resource == resource)
            .and_then(|s| s.write.clone())
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
    /// the follow-up before it returns. A pass never starts before the
    /// `Retry-After` of the last failed run (at most [`RETRY_AFTER_MAX`])
    /// has passed: the call waits for it, while `status()` shows the
    /// failure and its `retry_after`.
    pub async fn run_once(&self, trigger: Trigger) -> Result<SyncReport> {
        if !self.enter_gate() {
            // A run waiting out a `Retry-After` checks whether it still
            // applies (this caller may come from another sign-in).
            self.retry_changed.notify_waiters();
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
            // Every pass, whatever its trigger (manual, realtime, network,
            // follow-up), waits out the last `Retry-After`; callers that
            // arrive meanwhile are coalesced into the follow-up.
            self.wait_retry_after().await;
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

    /// The number of the last pass that finished. It moves after the pass
    /// has published its outcome in [`Self::status`]; a pass cut short is not
    /// announced. Compared with [`Self::passes_started`] taken before a
    /// trigger, it tells the verdict of a pass that began after the trigger
    /// from one that was already running.
    pub fn subscribe_passes(&self) -> watch::Receiver<u64> {
        self.passes.subscribe()
    }

    /// The number of passes started so far, a running one included.
    pub fn passes_started(&self) -> u64 {
        self.started.load(Ordering::SeqCst)
    }

    /// Recounts outbox and conflicts into the published status.
    pub fn refresh_status(&self) -> Result<SyncStatus> {
        let counts = local::counts(&self.store)?;
        let mismatch = self.mismatch(local::session(&self.store)?.offline_manifest_version);
        self.status.send_modify(|status| {
            counts.apply(status);
            status.manifest_mismatch = mismatch;
        });
        Ok(self.status())
    }

    /// Queues a local write. For updates, deletes and actions the current
    /// mirror row is kept as the draft's base, so the draft stays readable
    /// when retention or a reset removes the mirror row.
    ///
    /// Fails without queueing while the local data is not verified for the
    /// current sign-in (see the module docs) or when the resource is not in
    /// the manifest. Refused with the server's codes: while the offline
    /// manifest versions differ (`SYNC_OFFLINE_WRITE_NOT_ALLOWED`), and when
    /// the resource's [`WritePolicy`] rejects the draft for the row as the
    /// user sees it (`DOCUMENT_LOCKED` for a document that is no longer a
    /// draft, `SYNC_OFFLINE_WRITE_NOT_ALLOWED` otherwise). Excluded with sign-out and wipes: a write is either
    /// counted by sign-out or refused, never silently deleted.
    pub fn enqueue(&self, mutation: NewMutation) -> Result<EnqueueOutcome> {
        let resource = mutation.resource.clone();
        let outcome = {
            let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
            // No sign-in completes between the check below and the work.
            let _sign_in = self.session.hold();
            let session = self.check_access(&resource)?;
            self.prepare_draft(&session, &mutation)?;
            self.outbox.enqueue_outcome(mutation)?
        };
        self.refresh_status()?;
        self.emit(vec![resource]);
        Ok(outcome)
    }

    /// [`SyncEngine::enqueue`] of a request carrying an `Idempotency-Key`:
    /// the key is recorded with the draft, and a key already recorded queues
    /// nothing ([`KeyedOutcome::Repeat`]) whatever became of the draft: the
    /// record outlives the outbox entry, and the row may be locked by now. A
    /// key used for another request is refused (`IDEMPOTENCY_KEY_REUSED`).
    pub fn enqueue_keyed(&self, mutation: NewMutation, key: &RequestKey) -> Result<KeyedOutcome> {
        let resource = mutation.resource.clone();
        let outcome = {
            let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
            // No sign-in completes between the check below and the work.
            let _sign_in = self.session.hold();
            let session = self.check_access(&resource)?;
            if let Some(record) = self.outbox.request_record(key)? {
                return Ok(KeyedOutcome::Repeat(record));
            }
            self.prepare_draft(&session, &mutation)?;
            self.outbox.enqueue_keyed(mutation, key)?
        };
        if matches!(outcome, KeyedOutcome::New(_)) {
            self.refresh_status()?;
            self.emit(vec![resource]);
        }
        Ok(outcome)
    }

    /// What `key` was used for, online or offline, without queueing. Same
    /// verification rule as [`SyncEngine::enqueue`]; records go with every
    /// wipe, so another user or company finds nothing.
    pub fn request_record(&self, key: &RequestKey) -> Result<Option<RequestRecord>> {
        self.guarded(|| self.outbox.request_record(key))
    }

    /// The checks of a draft, and its base. The caller holds `local` and
    /// the sign-in.
    fn prepare_draft(&self, session: &local::LocalSession, mutation: &NewMutation) -> Result<()> {
        if self.mismatch(session.offline_manifest_version) {
            return Err(refused(
                ErrorCode::SyncOfflineWriteNotAllowed,
                "the offline manifest differs from the server; offline writes are closed",
            ));
        }
        let resource = &mutation.resource;
        if let Some(policy) = self.write_policy(resource) {
            let current = match mutation.op {
                MutationOp::Create => None,
                _ => overlay::get(&self.store, resource, mutation.id)?,
            };
            policy.check(mutation, current.as_ref().map(|r| &r.row.fields))?;
        }
        if mutation.op != MutationOp::Create {
            local::save_base(&self.store, resource, mutation.id)?;
        }
        Ok(())
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

    /// Stored snapshot of a `source: snapshot` resource (the offline answer
    /// of its REST endpoint). Same access rule as [`SyncEngine::list`]:
    /// only while the local data is verified for the current sign-in, so a
    /// new sign-in (another user included) reads nothing until a run has
    /// checked who it is, and a sealed store serves nothing. The check and
    /// the read happen with sign-ins held off.
    pub fn snapshot(&self, resource: &ResourceName) -> Result<Option<Snapshot>> {
        let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
        // No sign-in completes between the check below and the work.
        let _sign_in = self.session.hold();
        self.check_access(resource)?;
        self.hook(Hook::AccessChecked);
        self.store.snapshot(resource)
    }

    /// Stores `data`, the online answer of a `source: snapshot` resource,
    /// fetched at `fetched_at` by a call bound to sign-in `generation`
    /// (e.g. [`crate::client::HttpClient::proxy_in`], or the generation read
    /// before an unbound call). Refused unwritten when another sign-in
    /// happened since (`UNAUTHENTICATED`: the answer may be another user's),
    /// while the local data is not verified for the current sign-in or is
    /// sealed (`OFFLINE_UNAVAILABLE`), for a resource outside the manifest
    /// (`FORBIDDEN`) and for one the manifest does not mark `snapshot`
    /// (`INVALID_REQUEST`). Excluded with sign-out and wipes like
    /// [`SyncEngine::enqueue`].
    pub fn put_snapshot(
        &self,
        resource: &ResourceName,
        data: &Value,
        fetched_at: &Timestamp,
        generation: u64,
    ) -> Result<()> {
        let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
        // No sign-in completes between the checks below and the write.
        let _sign_in = self.session.hold();
        self.ensure_generation(generation)?;
        self.check_access(resource)?;
        let source = self.store.resource_spec(resource)?.map(|spec| spec.source);
        if source != Some(Source::Snapshot) {
            return Err(SyncError::InvalidRequest(
                "the resource is not a snapshot resource of the manifest".to_owned(),
            ));
        }
        self.store.put_snapshot(resource, data, fetched_at)
    }

    /// Keeps `body`, a `200` answer of `GET /api/v1/auth/me` fetched by a
    /// call bound to sign-in `generation`, as of `fetched_at`, for an
    /// offline start ([`SyncEngine::session_copy`]). `fetched_at` is the time
    /// the request was sent, so the copy is never shown fresher than it is.
    /// It replaces the copy kept before, except one of the same sign-in
    /// fetched later: an older answer arriving last leaves it (`Ok(false)`;
    /// check and write are one transaction). Refused unwritten when another sign-in happened since
    /// (`UNAUTHENTICATED`), when the sign-in has no tokens, is deactivated or
    /// is being signed out (`OFFLINE_UNAVAILABLE`), and when the body is not
    /// a `{data: {user: {id}, companies, permissions}}` answer or carries a
    /// credential (a key naming a token, password or secret, or a token of
    /// this sign-in) (`INVALID_REQUEST`). It is bound to that sign-in, its
    /// user and the company of this engine's client. Excluded with sign-out
    /// and wipes like [`SyncEngine::enqueue`]: a sign-out either removes it
    /// or comes first and refuses it.
    pub fn put_session_copy(
        &self,
        body: &Value,
        fetched_at: &Timestamp,
        generation: u64,
    ) -> Result<bool> {
        let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
        // No sign-in completes between the checks below and the write.
        let _sign_in = self.session.hold();
        self.ensure_generation(generation)?;
        let record = self.session.record()?;
        let tokens = match &record.tokens {
            Some(tokens) if !record.deactivated => tokens,
            _ => return Err(not_signed_in()),
        };
        if local::pending_sign_out(&self.store)?.is_some() {
            return Err(not_signed_in());
        }
        let user_id = session_user(body)?;
        if carries_credential(
            body,
            &[tokens.access_token.expose(), tokens.refresh_token.expose()],
        ) {
            return Err(SyncError::InvalidRequest(
                "the session answer carries a credential; it is not kept".to_owned(),
            ));
        }
        let Some(company_id) = self.api.company_id() else {
            return Err(SyncError::InvalidRequest(
                "the client has no company; the session answer is not kept".to_owned(),
            ));
        };
        self.hook(Hook::SessionCopyChecked);
        local::offer_session_copy(
            &self.store,
            &local::StoredSessionCopy {
                format: 0,
                generation,
                user_id,
                company_id,
                fetched_at: fetched_at.0.clone(),
                body: body.clone(),
            },
        )
    }

    /// The kept `GET /auth/me` answer ([`SyncEngine::put_session_copy`]),
    /// for an offline start. Only while the local data is verified for the
    /// current sign-in (same rule as [`SyncEngine::list`]: not deactivated,
    /// not sealed, not being signed out), the sign-in still has tokens, and
    /// the copy was fetched in that same sign-in, for the user and company
    /// the local data belongs to and for this engine's company. `Ok(None)`:
    /// no such copy.
    ///
    /// The permissions in it are the last ones the server sent, possibly
    /// old. That is safe for writes: every queued draft is authorized again
    /// on push against the user's current permissions
    /// (docs/SYNC-PROTOCOL.md, push step 3 "Manifest ve izin", and step 4
    /// Policy), and online requests are authorized by the server as usual.
    pub fn session_copy(&self) -> Result<Option<SessionCopy>> {
        let _local = self.local.read().unwrap_or_else(PoisonError::into_inner);
        // No sign-in completes between the checks below and the read.
        let _sign_in = self.session.hold();
        let session = self.check_verified()?;
        self.hook(Hook::AccessChecked);
        let record = self.session.record()?;
        if record.tokens.is_none() {
            return Err(not_signed_in());
        }
        let Some(copy) = local::session_copy(&self.store)? else {
            return Ok(None);
        };
        let identity = session.identity.as_deref();
        let matches = copy.generation == record.generation
            && identity.and_then(identity_user) == Some(copy.user_id)
            && identity.and_then(identity_company) == Some(copy.company_id)
            && self.api.company_id() == Some(copy.company_id);
        Ok(matches.then_some(SessionCopy {
            data: copy.body,
            fetched_at: Timestamp(copy.fetched_at),
        }))
    }

    /// Retention prune of the verified local data (window and size, see
    /// [`crate::store::RetentionPolicy`]);
    /// excluded with sign-out and wipes.
    pub fn prune(&self) -> Result<PruneReport> {
        self.guarded(|| self.store.prune())
    }

    /// Signs out the sign-in current at the call: removes its tokens, and
    /// mirror, outbox and conflicts. With unsent work (any outbox entry or
    /// open conflict) nothing happens unless `force`. Waits for a running
    /// pass and for token work of the profile (a refresh in flight cannot
    /// write tokens back afterwards); counting and wiping exclude
    /// [`SyncEngine::enqueue`]. Tokens of a sign-in made after the call
    /// stay ([`TokenStore::sign_out`] is a compare-and-set).
    ///
    /// The sign-out is persisted in stages bound to the generation it
    /// began in ([`local::PendingSignOut`]): access closes first, the
    /// tokens of that generation go next, the local data last. A sign-out
    /// cut short earlier (failed revoke or cleanup, process gone) is
    /// finished by the next sign-out or run from the stage it reached, for
    /// its own generation: a sign-in made since keeps its tokens.
    ///
    /// Once the sign-out goes ahead (no unsent work, or `force`) and access
    /// is closed, and before the tokens go, the server is asked to end the
    /// sign-in with them ([`SyncEngine::end_server_session`]): at most
    /// [`SERVER_SIGN_OUT_TIMEOUT`], never retried later, and whatever it
    /// answers the local sign-out follows. `server_revoked` reports it.
    pub async fn sign_out(&self, force: bool) -> Result<SignOut> {
        let generation = self.generation()?;
        let _work = self.work.lock().await;
        let _tokens = self.session.lock().await;
        let (pending, fresh) = {
            let _local = self.local.write().unwrap_or_else(PoisonError::into_inner);
            let unfinished = local::pending_sign_out(&self.store)?;
            let counts = local::counts(&self.store)?;
            self.hook(Hook::SignOutCounted);
            let outbox = counts.pending + counts.rejected + counts.quarantined + counts.in_conflict;
            if unfinished.is_none() && !force && (outbox > 0 || counts.conflicts > 0) {
                return Ok(SignOut::PendingWork {
                    outbox,
                    conflicts: counts.conflicts,
                });
            }
            match unfinished {
                Some(pending) => (pending, false),
                None => {
                    let pending = local::PendingSignOut {
                        generation,
                        stage: local::SignOutStage::Revoke,
                        server_ended: false,
                    };
                    local::set_pending_sign_out(&self.store, Some(pending))?;
                    (pending, true)
                }
            }
        };
        // `local` is free while the server is asked: the open sign-out keeps
        // access closed, and the work and session locks keep runs, refreshes
        // and sign-ins out.
        let pending = self.with_server_answer(pending).await;
        let _local = self.local.write().unwrap_or_else(PoisonError::into_inner);
        self.finish_sign_out(pending, fresh)?;
        self.set_state(SyncState::AuthRequired, None, None)?;
        Ok(SignOut::Done {
            server_revoked: pending.server_ended,
        })
    }

    /// `pending` with what the server said about its sign-in: asked now
    /// while its tokens are still here ([`SyncEngine::end_server_session`]),
    /// or, past the revoke, what was recorded when it was asked. The caller
    /// holds the session lock and not `local`.
    async fn with_server_answer(&self, pending: local::PendingSignOut) -> local::PendingSignOut {
        if pending.stage != local::SignOutStage::Revoke {
            return pending;
        }
        local::PendingSignOut {
            server_ended: self.end_server_session(pending.generation).await,
            ..pending
        }
    }

    /// Asks the server to end sign-in `generation` with its tokens. The
    /// caller holds the session lock, so the tokens read here are the ones
    /// the revoke removes. `true` only when the server confirmed within
    /// [`SERVER_SIGN_OUT_TIMEOUT`], or when the account is marked
    /// deactivated: the server answered `USER_DEACTIVATED` to this sign-in,
    /// deleting the access token it was sent with and refusing every
    /// refresh while the account stays deactivated.
    ///
    /// Nothing is sent, and the answer is `false`, when no token of
    /// `generation` is left here: they belong to a later sign-in (another
    /// user's leaves this one's device signed in on the server), or they
    /// were dropped without the server saying the sign-in ended (a refresh
    /// whose answer was lost leaves a new pair there). Whether the server
    /// still holds a live token is then unknown.
    async fn end_server_session(&self, generation: u64) -> bool {
        let Ok(record) = self.session.record() else {
            return false;
        };
        if record.generation != generation {
            return false;
        }
        if record.deactivated {
            return true;
        }
        let Some(tokens) = record.tokens else {
            return false;
        };
        tokio::time::timeout(SERVER_SIGN_OUT_TIMEOUT, self.api.end_session(&tokens))
            .await
            .unwrap_or(false)
    }

    /// Runs the stages of `pending` that are left: the compare-and-set
    /// revoke of its generation (a later sign-in keeps its tokens; the
    /// revoked generation's are gone either way), then the wipe of the
    /// local data, which is the signing-out user's (no later sign-in was
    /// verified while the sign-out was open). A `fresh` sign-out whose
    /// revoke fails changed nothing and is forgotten; any other failure
    /// leaves the sign-out open, so access stays closed and the next
    /// sign-out or run finishes it. The caller holds the session lock and
    /// `local` exclusively.
    fn finish_sign_out(&self, pending: local::PendingSignOut, fresh: bool) -> Result<()> {
        if pending.stage == local::SignOutStage::Revoke {
            if let Err(error) = self.session.store().sign_out(
                &TokenWrite::new(),
                self.session.profile(),
                pending.generation,
            ) {
                if fresh {
                    let _ = local::set_pending_sign_out(&self.store, None);
                }
                return Err(error);
            }
            local::set_pending_sign_out(
                &self.store,
                Some(local::PendingSignOut {
                    stage: local::SignOutStage::Wipe,
                    ..pending
                }),
            )?;
            self.hook(Hook::SignOutRevoked);
        }
        self.wipe()
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

    /// One pass ([`Self::published_pass`]), counted once its outcome is out.
    async fn pass(&self, trigger: Trigger) -> Result<SyncReport> {
        // Passes run one at a time (the run gate): numbers follow the order.
        let number = self.started.fetch_add(1, Ordering::SeqCst) + 1;
        let result = self.published_pass(trigger).await;
        self.passes.send_replace(number);
        result
    }

    /// From `Offline`, the server answered: the pass shows as syncing now.
    fn reached(&self) {
        self.status.send_if_modified(|status| {
            let offline = status.state == SyncState::Offline;
            if offline {
                status.state = SyncState::Syncing;
            }
            offline
        });
    }

    /// One pass under the work lock, with state publication and the
    /// identity-loss rules applied to its error.
    async fn published_pass(&self, trigger: Trigger) -> Result<SyncReport> {
        let _work = self.work.lock().await;
        let before = self.status.borrow().state.clone();
        // Offline stays offline until the server answers ([`Self::reached`]):
        // a probe that fails never shows as syncing.
        if before != SyncState::Offline {
            self.status
                .send_modify(|status| status.state = SyncState::Syncing);
        }
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
                self.set_state(SyncState::Idle, None, None)?;
                if moved(self) {
                    self.queue_follow_up();
                }
                Ok(report)
            }
            Err(error) => {
                let state = self.on_error(&error, generation)?;
                if moved(self) {
                    // Cut short by another sign-in: run again at once under
                    // it; that run publishes the state.
                    self.queue_follow_up();
                    return Err(error);
                }
                if matches!(state, SyncState::Failed(_)) {
                    self.failures.fetch_add(1, Ordering::SeqCst);
                }
                self.hook(Hook::FailureKept);
                // The limit belongs to the sign-in that sent the request.
                self.set_state(state, error.retry_after(), generation)?;
                Err(error)
            }
        }
    }

    /// Applies identity-loss rules only while the failing generation is
    /// current. The generation is confirmed again with sign-ins held off and
    /// the rule runs under that same hold, so a sign-in completing after the
    /// check cannot be hit by a stale answer. Any final `UNAUTHENTICATED` of
    /// that generation closes local reads, also after a successful refresh
    /// whose retried request was refused again.
    fn on_error(&self, error: &SyncError, generation: Option<u64>) -> Result<SyncState> {
        let _local = self.local.write().unwrap_or_else(PoisonError::into_inner);
        // Cheap first look without blocking sign-ins.
        if generation != Some(self.session.record()?.generation) {
            return Ok(state_after_error(error));
        }
        let _sign_in = self.session.hold();
        let record = self.session.record()?;
        if generation != Some(record.generation) {
            return Ok(state_after_error(error));
        }
        match error {
            SyncError::Api {
                code: ErrorCode::Unauthenticated,
                ..
            } => {
                local::close(&self.store)?;
            }
            SyncError::Api {
                code: ErrorCode::CompanyForbidden,
                ..
            } => {
                // The answer concerns the company the request was sent for;
                // local data of another company stays.
                let local = local::session(&self.store)?;
                if local
                    .identity
                    .as_deref()
                    .and_then(identity_company)
                    .is_some_and(|company| self.api.company_id() == Some(company))
                {
                    self.seal(false)?;
                }
            }
            SyncError::Api {
                code: ErrorCode::UserDeactivated,
                ..
            } if record.deactivated => {
                self.seal(true)?;
                // CAS preserves tokens from any later sign-in.
                self.session.store().deactivate(
                    &TokenWrite::new(),
                    self.session.profile(),
                    record.generation,
                )?;
                return Ok(SyncState::AuthRequired);
            }
            _ => {}
        }
        Ok(state_after_error(error))
    }
    /// Whether the server's offline manifest version (from the last
    /// manifest) differs from the compiled one.
    fn mismatch(&self, server: Option<u32>) -> bool {
        matches!((self.offline_version, server), (Some(local), Some(server)) if local != server)
    }

    /// Local access rule of reads and enqueues; the caller holds `local`.
    /// Returns the verified local session.
    fn check_access(&self, resource: &ResourceName) -> Result<local::LocalSession> {
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
        Ok(session)
    }

    /// The local data was verified by a manifest of the current sign-in
    /// generation, which is not deactivated. Returns that local session.
    fn check_verified(&self) -> Result<local::LocalSession> {
        let record = self.session.record()?;
        let session = local::session(&self.store)?;
        if record.deactivated
            || session.sign_out.is_some()
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
        Ok(self.session.record()?.generation)
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

    /// Removes server data. Pending work is sealed (company access loss) or
    /// deleted too (`drop_work`, deactivation).
    fn seal(&self, drop_work: bool) -> Result<()> {
        let names = local::seal(&self.store, drop_work)?;
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

    /// Sleeps until the last failure's `Retry-After` has passed. The limit
    /// belongs to the sign-in it was set under: after another sign-in it no
    /// longer applies. Re-evaluated whenever the limit changes or a caller
    /// is coalesced into this run (it may come from a new sign-in).
    async fn wait_retry_after(&self) {
        loop {
            let changed = self.retry_changed.notified();
            tokio::pin!(changed);
            // Registered before the read: no change is missed in between.
            changed.as_mut().enable();
            let limit = *self
                .retry_not_before
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            let Some((at, generation)) = limit else {
                return;
            };
            if tokio::time::Instant::now() >= at
                || self.session.record().ok().map(|r| r.generation) != Some(generation)
            {
                return;
            }
            tokio::select! {
                () = tokio::time::sleep_until(at) => {}
                () = &mut changed => {}
            }
        }
    }

    /// Publishes `state`; `retry_after` also sets the earliest start of the
    /// next pass for `generation`, the sign-in whose request got it (`None`
    /// lifts it), and wakes a waiting run to re-evaluate. The limit is
    /// dropped when another sign-in has completed since: compared and
    /// written with sign-ins held off.
    fn set_state(
        &self,
        state: SyncState,
        retry_after: Option<Duration>,
        generation: Option<u64>,
    ) -> Result<()> {
        {
            let _sign_in = self.session.hold();
            let current = self.session.record().ok().map(|r| r.generation);
            let limit = match (retry_after, generation) {
                (Some(wait), Some(g)) if current == Some(g) => {
                    Some((tokio::time::Instant::now() + wait.min(RETRY_AFTER_MAX), g))
                }
                _ => None,
            };
            *self
                .retry_not_before
                .lock()
                .unwrap_or_else(PoisonError::into_inner) = limit;
        }
        self.retry_changed.notify_waiters();
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

/// Company of a local `user_id:company_id` identity.
fn identity_company(identity: &str) -> Option<Uuid> {
    identity
        .rsplit_once(':')
        .and_then(|(_, company)| Uuid::parse_str(company).ok())
}

/// User of a local `user_id:company_id` identity.
fn identity_user(identity: &str) -> Option<Uuid> {
    identity
        .split_once(':')
        .and_then(|(user, _)| Uuid::parse_str(user).ok())
}

/// The kept `GET /auth/me` answer of the current sign-in, see
/// [`SyncEngine::session_copy`].
#[derive(Clone, PartialEq)]
pub struct SessionCopy {
    /// The whole answer body, `{data: {user, companies, permissions}}`.
    pub data: Value,
    /// When it was fetched.
    pub fetched_at: Timestamp,
}

/// The body (user data) is never printed.
impl std::fmt::Debug for SessionCopy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SessionCopy")
            .field("fetched_at", &self.fetched_at)
            .finish_non_exhaustive()
    }
}

/// The local data is closed to the current sign-in.
fn not_signed_in() -> SyncError {
    SyncError::OfflineUnavailable("there is no live sign-in for the session answer".to_owned())
}

/// `data.user.id` of a `GET /auth/me` answer that has the shape the web
/// reads (`user` with an id, `companies` list, `permissions` map).
fn session_user(body: &Value) -> Result<Uuid> {
    let data = body.get("data");
    let user = data
        .and_then(|d| d.get("user"))
        .and_then(|u| u.get("id"))
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    let shaped = data.is_some_and(|d| {
        d.get("companies").is_some_and(Value::is_array)
            && d.get("permissions").is_some_and(Value::is_object)
    });
    match user {
        Some(user) if shaped => Ok(user),
        _ => Err(SyncError::InvalidRequest(
            "the session answer has an unexpected shape; it is not kept".to_owned(),
        )),
    }
}

/// Whether `value` holds a key that names a credential, or a string that
/// contains one of `secrets` (empty ones ignored).
fn carries_credential(value: &Value, secrets: &[&str]) -> bool {
    match value {
        Value::Object(map) => map.iter().any(|(key, value)| {
            let key = key.to_ascii_lowercase();
            ["token", "password", "secret"]
                .iter()
                .any(|word| key.contains(word) && !is_flag(&key))
                || carries_credential(value, secrets)
        }),
        Value::Array(items) => items.iter().any(|item| carries_credential(item, secrets)),
        Value::String(text) => secrets
            .iter()
            .any(|secret| !secret.is_empty() && text.contains(secret)),
        _ => false,
    }
}

/// Keys of `GET /auth/me` that name a credential but only flag it.
fn is_flag(key: &str) -> bool {
    matches!(key, "must_change_password")
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
