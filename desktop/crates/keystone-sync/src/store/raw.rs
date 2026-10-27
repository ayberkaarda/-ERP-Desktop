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

use super::{ListPage, ListQuery, Store};
use crate::conflicts::ConflictStore;
use crate::error::Result;
use crate::outbox::{Outbox, OutboxEntry};
use crate::wire::{ResourceName, ResourceRow};

pub use super::mirror::MirrorStore;

/// Every raw trait: `use keystone_sync::store::raw::prelude::*;`.
pub mod prelude {
    pub use super::{MirrorStore, RawConflictStore, RawOutbox, RawStore};
}

/// Raw SQL and mirror administration on a [`Store`].
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
