//! Raw access for this crate's integration tests (`raw-store` feature).
//!
//! The same calls the crate uses internally, without the engine's access
//! checks: SQL on the store, the outbox and Conflict Inbox on a store, and
//! mirror writes. The shell never enables the feature, so for it these do
//! not exist (see the crate docs). Bring the traits into scope and call the
//! usual names: `store.read(..)`, `Outbox::new(store)`, `store.put_row(..)`.

use std::sync::Arc;

use rusqlite::{Connection, Transaction};
use uuid::Uuid;

use serde_json::Value;

use super::{ListPage, ListQuery, PruneReport, ResourceSpec, Snapshot, Store};
use crate::conflicts::ConflictStore;
use crate::error::Result;
use crate::outbox::{Outbox, OutboxEntry};
use crate::wire::{ResourceName, ResourceRow, Timestamp};

pub use super::mirror::MirrorStore;

/// Every raw trait: `use keystone_sync::store::raw::prelude::*;`.
pub mod prelude {
    pub use super::{MirrorStore, RawConflictStore, RawOutbox, RawStore};
}

/// Raw SQL, mirror administration, snapshots and retention on a [`Store`].
pub trait RawStore {
    fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T>;
    fn write<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T>;
    fn list(&self, resource: &ResourceName, query: &ListQuery) -> Result<ListPage>;
    fn put_push_row(&self, resource: &ResourceName, row: &ResourceRow) -> Result<bool>;
    fn remove_push_row(
        &self,
        resource: &ResourceName,
        id: Uuid,
        base_version: Option<u64>,
    ) -> Result<bool>;
    fn reset_resource(&self, resource: &ResourceName) -> Result<usize>;
    fn register(&self, spec: &ResourceSpec) -> Result<()>;
    fn register_all(&self, specs: &[ResourceSpec]) -> Result<()>;
    fn put_snapshot(
        &self,
        resource: &ResourceName,
        data: &Value,
        fetched_at: &Timestamp,
    ) -> Result<()>;
    fn remove_snapshot(&self, resource: &ResourceName) -> Result<bool>;
    fn snapshot(&self, resource: &ResourceName) -> Result<Option<Snapshot>>;
    fn snapshot_resources(&self) -> Result<Vec<ResourceName>>;
    fn prune(&self) -> Result<PruneReport>;
    fn prune_at(&self, today: &str) -> Result<PruneReport>;
}

impl RawStore for Store {
    fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        Store::read(self, f)
    }
    fn write<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        Store::write(self, f)
    }
    fn list(&self, resource: &ResourceName, query: &ListQuery) -> Result<ListPage> {
        Store::list(self, resource, query)
    }
    fn put_push_row(&self, resource: &ResourceName, row: &ResourceRow) -> Result<bool> {
        Store::put_push_row(self, resource, row)
    }
    fn remove_push_row(
        &self,
        resource: &ResourceName,
        id: Uuid,
        base_version: Option<u64>,
    ) -> Result<bool> {
        Store::remove_push_row(self, resource, id, base_version)
    }
    fn reset_resource(&self, resource: &ResourceName) -> Result<usize> {
        Store::reset_resource(self, resource)
    }
    fn register(&self, spec: &ResourceSpec) -> Result<()> {
        Store::register(self, spec)
    }
    fn register_all(&self, specs: &[ResourceSpec]) -> Result<()> {
        Store::register_all(self, specs)
    }
    fn put_snapshot(
        &self,
        resource: &ResourceName,
        data: &Value,
        fetched_at: &Timestamp,
    ) -> Result<()> {
        Store::put_snapshot(self, resource, data, fetched_at)
    }
    fn remove_snapshot(&self, resource: &ResourceName) -> Result<bool> {
        Store::remove_snapshot(self, resource)
    }
    fn snapshot(&self, resource: &ResourceName) -> Result<Option<Snapshot>> {
        Store::snapshot(self, resource)
    }
    fn snapshot_resources(&self) -> Result<Vec<ResourceName>> {
        Store::snapshot_resources(self)
    }
    fn prune(&self) -> Result<PruneReport> {
        Store::prune(self)
    }
    fn prune_at(&self, today: &str) -> Result<PruneReport> {
        Store::prune_at(self, today)
    }
}

/// An [`Outbox`] straight on a store.
pub trait RawOutbox: Sized {
    fn new(store: Arc<Store>) -> Self;
    fn list(&self) -> Result<Vec<OutboxEntry>>;
}

impl RawOutbox for Outbox {
    fn new(store: Arc<Store>) -> Self {
        Outbox::new(store)
    }
    fn list(&self) -> Result<Vec<OutboxEntry>> {
        Outbox::list(self)
    }
}

/// A [`ConflictStore`] straight on a store.
pub trait RawConflictStore: Sized {
    fn new(store: Arc<Store>) -> Self;
}

impl RawConflictStore for ConflictStore {
    fn new(store: Arc<Store>) -> Self {
        ConflictStore::new(store)
    }
}

/// [`Store`] mirror wipe inside the caller's write transaction.
pub fn clear_mirror_on(tx: &Connection) -> Result<Vec<ResourceName>> {
    Store::clear_mirror_on(tx)
}

/// Outbox wipe inside the caller's write transaction.
pub fn clear_outbox_on(tx: &Connection) -> Result<usize> {
    crate::outbox::clear_on(tx)
}

/// Conflict Inbox wipe inside the caller's write transaction.
pub fn clear_conflicts_on(tx: &Connection) -> Result<usize> {
    crate::conflicts::clear_on(tx)
}
