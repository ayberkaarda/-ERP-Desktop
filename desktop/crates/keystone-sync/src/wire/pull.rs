//! `POST /api/v1/sync/pull` (`pull.*.schema.json`) and `tombstone.schema.json`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{Cursor, Meta, ResourceName, ResourceRow, SchemaVersion, Timestamp, Xid8};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullRequest {
    pub schema_version: SchemaVersion,
    /// At least one; a resource may appear only once.
    pub resources: Vec<PullResource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PullResource {
    pub resource: ResourceName,
    /// `None`: first (full) download of the resource.
    pub cursor: Option<Cursor>,
    /// 1..=1000; server default is `limits.pull_page_default`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PullResponse {
    pub data: PullData,
    pub meta: Meta,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PullData {
    /// Every row in this response has `sync_txid < horizon`.
    pub horizon: Xid8,
    pub server_time: Timestamp,
    /// Same order as the request.
    pub resources: Vec<PullResourceResult>,
}

/// One page for one resource. `reset_reason` is present exactly when `reset`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PullResourceResult {
    pub resource: ResourceName,
    pub rows: Vec<ResourceRow>,
    pub tombstones: Vec<Tombstone>,
    pub next_cursor: Cursor,
    pub has_more: bool,
    /// Drop the local copy, then apply `rows` as page one of a full download.
    pub reset: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_reason: Option<ResetReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResetReason {
    CursorExpired,
    VisibilityChanged,
    SchemaChanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tombstone {
    pub resource: ResourceName,
    pub id: Uuid,
    /// Absent, explicit `null`, or the parent id for child resources.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "super::serde_util::double_option"
    )]
    pub parent_id: Option<Option<Uuid>>,
    pub sync_txid: Xid8,
    pub deleted_at: Timestamp,
    pub reason: TombstoneReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TombstoneReason {
    Deleted,
    SoftDeleted,
    OutOfScope,
}
