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
//!   session and `limit`) while the resource has not moved.
//! - Identity: `UNAUTHENTICATED` keeps everything ([`SyncState::AuthRequired`]);
//!   a different user or company in the manifest wipes local data before
//!   anything is pushed; `USER_DEACTIVATED` wipes mirror, outbox, conflicts
//!   and tokens only when the token store recorded it for the current
//!   sign-in generation (see [`crate::client::HttpClient`]).
//! - State is published through [`SyncEngine::subscribe`]; changed resources
//!   through [`SyncEngine::subscribe_changes`].
//!
//! Store calls are synchronous SQLite work run inline on the calling task.

mod driver;
mod local;
mod overlay;
mod pass;

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tokio::sync::{broadcast, watch};
use uuid::Uuid;

use crate::auth::TokenStore;
use crate::backoff::Backoff;
use crate::client::SyncApi;
use crate::conflicts::ConflictStore;
use crate::error::{Result, SyncError};
use crate::outbox::{EnqueueOutcome, NewMutation, Outbox, OutboxQueue};
use crate::store::{ListQuery, Migration, PullBase, ResourceSpec, Store};
use crate::wire::{ErrorCode, MutationOp, PullResource, ResourceName};

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

/// Upper bound of pull requests in one run.
pub const MAX_PULL_REQUESTS: usize = 10_000;

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

/// Clears `running` even when the run panics.
struct Running<'a>(&'a Mutex<Gate>);

impl Drop for Running<'_> {
    fn drop(&mut self) {
        let mut gate = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        gate.running = false;
        gate.queued = false;
    }
}

type PendingPulls = HashMap<ResourceName, (PullBase, PullResource)>;

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
    /// Last pull request per resource, with the base it was built from.
    pending_pulls: Mutex<PendingPulls>,
    failures: AtomicU32,
    status: watch::Sender<SyncStatus>,
    changes: broadcast::Sender<ResourcesChanged>,
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
    /// client uses: the engine reads the deactivation mark from there and
    /// clears the tokens on sign-out and deactivation.
    pub fn new(
        api: A,
        store: Arc<Store>,
        tokens: Arc<dyn TokenStore>,
        profile: impl Into<String>,
    ) -> Self {
        Self {
            api,
            outbox: Outbox::new(store.clone()),
            conflicts: ConflictStore::new(store.clone()),
            store,
            tokens,
            profile: profile.into(),
            specs: Vec::new(),
            pull_limit: None,
            backoff: Backoff::default(),
            gate: Mutex::default(),
            work: tokio::sync::Mutex::new(()),
            pending_pulls: Mutex::default(),
            failures: AtomicU32::new(0),
            status: watch::Sender::new(SyncStatus::default()),
            changes: broadcast::channel(64).0,
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
        {
            let mut gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
            if gate.running {
                gate.queued = true;
                return Ok(SyncReport {
                    coalesced: true,
                    ..SyncReport::default()
                });
            }
            gate.running = true;
            gate.queued = false;
        }
        let _running = Running(&self.gate);
        let mut trigger = trigger;
        loop {
            let result = self.pass(trigger).await;
            let again = {
                let mut gate = self.gate.lock().unwrap_or_else(PoisonError::into_inner);
                std::mem::take(&mut gate.queued)
            };
            if !again {
                return result;
            }
            trigger = Trigger::Manual;
        }
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
    pub fn enqueue(&self, mutation: NewMutation) -> Result<EnqueueOutcome> {
        let resource = mutation.resource.clone();
        if mutation.op != MutationOp::Create {
            local::save_base(&self.store, &resource, mutation.id)?;
        }
        let outcome = self.outbox.enqueue_outcome(mutation)?;
        self.refresh_status()?;
        self.emit(vec![resource]);
        Ok(outcome)
    }

    /// Local list: mirror rows with pending drafts laid over them.
    pub fn list(&self, resource: &ResourceName, query: &ListQuery) -> Result<LocalPage> {
        overlay::list(&self.store, resource, query)
    }

    /// Local row, draft first.
    pub fn get(&self, resource: &ResourceName, id: Uuid) -> Result<Option<LocalRow>> {
        overlay::get(&self.store, resource, id)
    }

    /// Signs out: removes tokens, mirror, outbox and conflicts. With unsent
    /// work (any outbox entry or open conflict) nothing happens unless
    /// `force`. Waits for a running pass.
    pub async fn sign_out(&self, force: bool) -> Result<SignOut> {
        let _work = self.work.lock().await;
        let counts = local::counts(&self.store)?;
        let outbox = counts.pending + counts.rejected + counts.quarantined + counts.in_conflict;
        if !force && (outbox > 0 || counts.conflicts > 0) {
            return Ok(SignOut::PendingWork {
                outbox,
                conflicts: counts.conflicts,
            });
        }
        self.wipe()?;
        self.tokens.clear(&self.profile)?;
        self.set_state(SyncState::AuthRequired, None)?;
        Ok(SignOut::Done)
    }

    pub fn api(&self) -> &A {
        &self.api
    }

    pub fn store(&self) -> &Arc<Store> {
        &self.store
    }

    pub fn outbox(&self) -> &Outbox {
        &self.outbox
    }

    pub fn conflicts(&self) -> &ConflictStore {
        &self.conflicts
    }

    pub fn backoff(&self) -> &Backoff {
        &self.backoff
    }

    /// One pass under the work lock, with state publication and the
    /// identity-loss rules applied to its error.
    async fn pass(&self, trigger: Trigger) -> Result<SyncReport> {
        let _work = self.work.lock().await;
        self.status
            .send_modify(|status| status.state = SyncState::Syncing);
        let mut report = SyncReport::default();
        let result = self.pass_inner(&trigger, &mut report).await;
        if !report.changed.is_empty() {
            self.emit(report.changed.clone());
        }
        match result {
            Ok(()) => {
                self.failures.store(0, Ordering::SeqCst);
                self.set_state(SyncState::Idle, None)?;
                Ok(report)
            }
            Err(error) => {
                let state = self.on_error(&error)?;
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
        // The client marks the record only when the 403 answered a call of
        // the current generation; a stale one leaves the mark unset.
        let record = self.tokens.load_record(&self.profile)?;
        if !record.deactivated {
            return Ok(SyncState::Failed(error.code()));
        }
        self.wipe()?;
        self.tokens.clear(&self.profile)?;
        Ok(SyncState::AuthRequired)
    }

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
}

/// State after a failed run, by error.
pub fn state_after_error(error: &SyncError) -> SyncState {
    match error {
        SyncError::Network(_) | SyncError::OfflineUnavailable(_) => SyncState::Offline,
        SyncError::Api {
            code: ErrorCode::Unauthenticated | ErrorCode::UserDeactivated,
            ..
        } => SyncState::AuthRequired,
        other => SyncState::Failed(other.code()),
    }
}

/// Transient for push accounting: the batch may or may not have been
/// applied, and resending it later is expected to work.
fn is_transient(error: &SyncError) -> bool {
    match error {
        SyncError::Network(_) => true,
        SyncError::Api { status, code, .. } => {
            *status >= 500 || *status == 429 || *code == ErrorCode::IdempotencyInProgress
        }
        _ => false,
    }
}
