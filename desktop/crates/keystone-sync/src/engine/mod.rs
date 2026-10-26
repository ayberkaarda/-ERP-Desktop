//! Sync loop: push the outbox, then pull every manifest resource.
//!
//! One run at a time. Triggers coalesce: a trigger that arrives during a run
//! schedules exactly one follow-up run. A run never overwrites a local draft
//! silently; conflicting results go to the Conflict Inbox.

use crate::backoff::Backoff;
use crate::client::SyncApi;
use crate::conflicts::ConflictInbox;
use crate::error::{Result, SyncError};
use crate::outbox::OutboxQueue;
use crate::store::{Migration, MirrorStore};
use crate::wire::{ErrorCode, ResourceName};

/// Ids 300..=399.
pub const MIGRATIONS: &[Migration] = &[];

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
    /// Realtime event for a resource.
    Realtime(ResourceName),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncState {
    Idle,
    Syncing,
    Offline,
    /// 401 after refresh: outbox is kept until the user signs in again.
    AuthRequired,
    /// Last run failed; next attempt after backoff.
    Failed(&'static str),
}

/// Result of one run. `changed` drives `[resource, ...]` query invalidation.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SyncReport {
    pub pushed: usize,
    pub conflicts: usize,
    pub rejected: usize,
    pub rows_upserted: usize,
    pub rows_removed: usize,
    pub changed: Vec<ResourceName>,
}

pub struct SyncEngine<A, M, O, C> {
    api: A,
    mirror: M,
    outbox: O,
    conflicts: C,
    backoff: Backoff,
}

impl<A, M, O, C> SyncEngine<A, M, O, C>
where
    A: SyncApi,
    M: MirrorStore + Send + Sync,
    O: OutboxQueue + Send + Sync,
    C: ConflictInbox + Send + Sync,
{
    pub fn new(api: A, mirror: M, outbox: O, conflicts: C) -> Self {
        Self {
            api,
            mirror,
            outbox,
            conflicts,
            backoff: Backoff::default(),
        }
    }

    pub fn with_backoff(mut self, backoff: Backoff) -> Self {
        self.backoff = backoff;
        self
    }

    /// One push-then-pull pass.
    pub async fn run_once(&self, _trigger: Trigger) -> Result<SyncReport> {
        Err(SyncError::NotImplemented("engine::run_once"))
    }

    pub fn api(&self) -> &A {
        &self.api
    }

    pub fn mirror(&self) -> &M {
        &self.mirror
    }

    pub fn outbox(&self) -> &O {
        &self.outbox
    }

    pub fn conflicts(&self) -> &C {
        &self.conflicts
    }

    pub fn backoff(&self) -> &Backoff {
        &self.backoff
    }
}

/// State after a failed run, by error.
pub fn state_after_error(error: &SyncError) -> SyncState {
    match error {
        SyncError::Network(_) | SyncError::OfflineUnavailable(_) => SyncState::Offline,
        SyncError::Api {
            code: ErrorCode::Unauthenticated,
            ..
        } => SyncState::AuthRequired,
        other => SyncState::Failed(other.code()),
    }
}
