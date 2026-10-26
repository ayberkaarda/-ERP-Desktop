//! Conflict Inbox. No silent overwrite: every `conflict` push result waits
//! here for a user decision.

use std::sync::Arc;

use uuid::Uuid;

use crate::error::{Result, SyncError};
use crate::outbox::NewMutation;
use crate::store::{Migration, Store};
use crate::wire::{
    Conflict, ConflictChoice, ConflictCode, Mutation, ResourceName, ResourceRow, Timestamp,
};

/// Ids 200..=299.
pub const MIGRATIONS: &[Migration] = &[];

#[derive(Debug, Clone, PartialEq)]
pub struct ConflictRecord {
    /// Key of the conflicting push result; a resolution `resolves` it.
    pub idempotency_key: Uuid,
    pub resource: ResourceName,
    pub id: Uuid,
    pub conflict: Conflict,
    /// The local mutation that hit the conflict.
    pub local: Mutation,
    pub detected_at: Timestamp,
}

/// What the caller must do after a decision.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolutionAction {
    /// Enqueue this write (keep_mine / merge carry a `resolution`; save_as_new_draft does not).
    Enqueue(NewMutation),
    /// take_server / use_existing: replace the local row and drop the local write.
    TakeServer(Option<ResourceRow>),
    /// discard: drop the local write.
    Discard,
}

pub trait ConflictInbox {
    fn record(&self, record: ConflictRecord) -> Result<()>;

    fn list(&self) -> Result<Vec<ConflictRecord>>;

    fn count(&self) -> Result<usize>;

    /// Applies a user decision. Fails if `choice` is not offered by the conflict.
    fn resolve(&self, idempotency_key: Uuid, choice: ConflictChoice) -> Result<ResolutionAction>;
}

#[derive(Debug, Clone)]
pub struct ConflictStore {
    store: Arc<Store>,
}

impl ConflictStore {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &Arc<Store> {
        &self.store
    }
}

impl ConflictInbox for ConflictStore {
    fn record(&self, _record: ConflictRecord) -> Result<()> {
        Err(SyncError::NotImplemented("conflicts::record"))
    }

    fn list(&self) -> Result<Vec<ConflictRecord>> {
        Err(SyncError::NotImplemented("conflicts::list"))
    }

    fn count(&self) -> Result<usize> {
        Err(SyncError::NotImplemented("conflicts::count"))
    }

    fn resolve(&self, _idempotency_key: Uuid, _choice: ConflictChoice) -> Result<ResolutionAction> {
        Err(SyncError::NotImplemented("conflicts::resolve"))
    }
}

/// Choices the schema allows for each conflict code.
pub const fn allowed_choices(code: ConflictCode) -> &'static [ConflictChoice] {
    match code {
        ConflictCode::VersionConflict => &[
            ConflictChoice::KeepMine,
            ConflictChoice::TakeServer,
            ConflictChoice::Merge,
        ],
        ConflictCode::DocumentLocked => &[ConflictChoice::SaveAsNewDraft, ConflictChoice::Discard],
        ConflictCode::DuplicateRecord => &[
            ConflictChoice::UseExisting,
            ConflictChoice::KeepMine,
            ConflictChoice::Discard,
        ],
    }
}
