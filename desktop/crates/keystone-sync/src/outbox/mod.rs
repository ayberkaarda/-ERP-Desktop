//! Outbox of offline drafts waiting for `POST /sync/push`.
//!
//! Contract for the implementation:
//! - entries keep enqueue order; `depends_on` edges are explicit, never
//!   inferred from payload text;
//! - coalescing: create+update -> create, create+delete -> both dropped;
//! - the idempotency key is created once per entry and reused on retries;
//! - dependants of a failed entry are settled by the server's
//!   `SYNC_DEPENDENCY_FAILED` result, not dropped locally.

use std::sync::Arc;

use serde_json::{Map, Value};
use uuid::Uuid;

use crate::error::{Result, SyncError};
use crate::store::{Migration, Store};
use crate::wire::{Mutation, MutationOp, PushResult, ResourceName, Timestamp};

/// Ids 100..=199.
pub const MIGRATIONS: &[Migration] = &[];

/// A draft write before it gets an idempotency key.
#[derive(Debug, Clone, PartialEq)]
pub struct NewMutation {
    pub op: MutationOp,
    /// Set exactly when `op` is `Action`.
    pub action: Option<String>,
    pub resource: ResourceName,
    /// UUIDv7 of the target row (new rows get theirs on the client).
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    /// Local row version; `None` for `Create`.
    pub base_version: Option<u64>,
    pub payload: Map<String, Value>,
    /// Idempotency keys of entries that must be applied first.
    pub depends_on: Vec<Uuid>,
    pub occurred_at: Timestamp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OutboxState {
    Pending,
    InFlight,
    /// Waiting in the Conflict Inbox.
    Conflict,
    /// Permanent server rejection; kept until the user dismisses it.
    Rejected,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OutboxEntry {
    pub seq: i64,
    pub mutation: Mutation,
    pub state: OutboxState,
    pub attempts: u32,
}

/// What `record_results` did with one push response.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PushOutcome {
    pub applied: usize,
    pub conflicts: usize,
    pub rejected: usize,
}

pub trait OutboxQueue {
    /// Stores a draft write, applying the coalescing rules. Returns its idempotency key.
    fn enqueue(&self, mutation: NewMutation) -> Result<Uuid>;

    /// Up to `max` pending entries in send order, marked in flight.
    fn next_batch(&self, max: usize) -> Result<Vec<Mutation>>;

    /// Settles in-flight entries from push results (same order as sent).
    /// Applied/duplicate entries are removed; conflicts and rejections stay.
    fn record_results(&self, results: &[PushResult]) -> Result<PushOutcome>;

    /// Returns in-flight entries to pending after a failed request.
    fn requeue_in_flight(&self) -> Result<usize>;

    fn pending_count(&self) -> Result<usize>;
}

/// SQLite-backed outbox on the shared store.
#[derive(Debug, Clone)]
pub struct Outbox {
    store: Arc<Store>,
}

impl Outbox {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }

    pub fn store(&self) -> &Arc<Store> {
        &self.store
    }
}

impl OutboxQueue for Outbox {
    fn enqueue(&self, _mutation: NewMutation) -> Result<Uuid> {
        Err(SyncError::NotImplemented("outbox::enqueue"))
    }

    fn next_batch(&self, _max: usize) -> Result<Vec<Mutation>> {
        Err(SyncError::NotImplemented("outbox::next_batch"))
    }

    fn record_results(&self, _results: &[PushResult]) -> Result<PushOutcome> {
        Err(SyncError::NotImplemented("outbox::record_results"))
    }

    fn requeue_in_flight(&self) -> Result<usize> {
        Err(SyncError::NotImplemented("outbox::requeue_in_flight"))
    }

    fn pending_count(&self) -> Result<usize> {
        Err(SyncError::NotImplemented("outbox::pending_count"))
    }
}

/// `changed_fields` for a mutation: the payload's top-level keys, sorted,
/// for update/action; empty for create/delete.
pub fn changed_fields(op: MutationOp, payload: &Map<String, Value>) -> Vec<String> {
    match op {
        MutationOp::Update | MutationOp::Action => {
            let mut keys: Vec<String> = payload.keys().cloned().collect();
            keys.sort();
            keys
        }
        MutationOp::Create | MutationOp::Delete => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changed_fields_follow_the_op() {
        let mut payload = Map::new();
        payload.insert("notes".into(), Value::Null);
        payload.insert("lines".into(), Value::Array(Vec::new()));
        assert_eq!(
            changed_fields(MutationOp::Update, &payload),
            ["lines", "notes"]
        );
        assert!(changed_fields(MutationOp::Create, &payload).is_empty());
    }
}
