//! Generic mirror: one table per resource, `data` holds the API Resource JSON.

use uuid::Uuid;

use super::Store;
use crate::error::{Result, SyncError};
use crate::wire::{Cursor, PullResourceResult, ResourceName, ResourceRow};

/// Counts for one applied pull page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AppliedPage {
    pub upserted: usize,
    pub removed: usize,
    pub reset: bool,
}

/// Local copy of pulled resources. Implemented by [`Store`].
pub trait MirrorStore {
    /// Stored cursor of `resource`; `None` before its first page.
    fn cursor(&self, resource: &ResourceName) -> Result<Option<Cursor>>;

    /// Applies one page in a single transaction: drops the local copy when
    /// `reset`, upserts `rows`, removes `tombstones`, stores `next_cursor`.
    fn apply_page(&self, page: &PullResourceResult) -> Result<AppliedPage>;

    /// Replaces one row, e.g. with `data` of an applied push result.
    fn put_row(&self, resource: &ResourceName, row: &ResourceRow) -> Result<()>;

    fn get_row(&self, resource: &ResourceName, id: Uuid) -> Result<Option<ResourceRow>>;

    fn remove_row(&self, resource: &ResourceName, id: Uuid) -> Result<bool>;
}

impl MirrorStore for Store {
    fn cursor(&self, _resource: &ResourceName) -> Result<Option<Cursor>> {
        Err(SyncError::NotImplemented("store::MirrorStore::cursor"))
    }

    fn apply_page(&self, _page: &PullResourceResult) -> Result<AppliedPage> {
        Err(SyncError::NotImplemented("store::MirrorStore::apply_page"))
    }

    fn put_row(&self, _resource: &ResourceName, _row: &ResourceRow) -> Result<()> {
        Err(SyncError::NotImplemented("store::MirrorStore::put_row"))
    }

    fn get_row(&self, _resource: &ResourceName, _id: Uuid) -> Result<Option<ResourceRow>> {
        Err(SyncError::NotImplemented("store::MirrorStore::get_row"))
    }

    fn remove_row(&self, _resource: &ResourceName, _id: Uuid) -> Result<bool> {
        Err(SyncError::NotImplemented("store::MirrorStore::remove_row"))
    }
}
