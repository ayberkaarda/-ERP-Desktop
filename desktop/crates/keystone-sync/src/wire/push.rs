//! `POST /api/v1/sync/push` (`push.*.schema.json`).
//!
//! The conditional rules of the schema (e.g. `create` carries no
//! `base_version`, `conflict` excludes `version`) are not encoded in the
//! types; the fixture tests check the types against the schema.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

use super::{ApiError, Meta, ResourceName, ResourceRow, SchemaVersion, Timestamp};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PushRequest {
    pub schema_version: SchemaVersion,
    /// 1..=500, in outbox order.
    pub mutations: Vec<Mutation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mutation {
    /// UUIDv7, created with the outbox entry and reused on every retry.
    pub idempotency_key: Uuid,
    pub op: MutationOp,
    /// Present exactly when `op` is `action`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    pub resource: ResourceName,
    /// UUIDv7 of the target row.
    pub id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Uuid>,
    /// `None` for `create`; required otherwise.
    pub base_version: Option<u64>,
    /// update/action: exactly the top-level keys of `payload`. create/delete: empty.
    pub changed_fields: Vec<String>,
    pub occurred_at: Timestamp,
    /// REST request body without `version`. Empty object for `delete`.
    pub payload: Map<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depends_on: Option<Vec<Uuid>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolution: Option<Resolution>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MutationOp {
    Create,
    Update,
    Delete,
    Action,
}

/// Conflict Inbox decision, sent with a fresh idempotency key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Resolution {
    /// Idempotency key of the conflict result being resolved.
    pub resolves: Uuid,
    pub code: ResolutionCode,
    pub choice: ResolutionChoice,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResolutionCode {
    VersionConflict,
    DuplicateRecord,
}

/// `DUPLICATE_RECORD` accepts only `keep_mine`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionChoice {
    KeepMine,
    Merge,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PushResponse {
    pub data: PushData,
    pub meta: Meta,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PushData {
    /// One per mutation, same order as the request.
    pub results: Vec<PushResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PushResult {
    pub idempotency_key: Uuid,
    pub resource: ResourceName,
    pub id: Uuid,
    pub status: PushStatus,
    /// Served from the stored result. Always true for `duplicate`.
    pub replayed: bool,
    /// applied/duplicate, except deletes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    /// applied/duplicate: `Some(Some(row))`, or `Some(None)` for a delete.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "super::serde_util::double_option"
    )]
    pub data: Option<Option<ResourceRow>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merged_fields: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conflict: Option<Conflict>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ApiError>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PushStatus {
    Applied,
    Duplicate,
    Conflict,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Conflict {
    pub code: ConflictCode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub base_version: Option<u64>,
    pub server_version: Option<u64>,
    pub conflicting_fields: Vec<String>,
    /// `None` for `DUPLICATE_RECORD`.
    pub server_data: Option<ResourceRow>,
    /// `DUPLICATE_RECORD` only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidates: Option<Vec<Uuid>>,
    pub choices: Vec<ConflictChoice>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConflictCode {
    VersionConflict,
    DocumentLocked,
    DuplicateRecord,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictChoice {
    KeepMine,
    TakeServer,
    Merge,
    SaveAsNewDraft,
    Discard,
    UseExisting,
}
