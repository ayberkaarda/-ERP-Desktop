//! Sync status, outbox entries and Conflict Inbox records as the webview
//! sees them (`sync_status`, `outbox_list`, `conflicts_list`, and the
//! `status` payload of `engine-event`).

use keystone_sync::conflicts::ConflictRecord;
use keystone_sync::engine::{SyncState, SyncStatus};
use keystone_sync::outbox::{OutboxEntry, OutboxState};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;
use uuid::Uuid;

/// [`SyncStatus`] of the active profile's engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct StatusDto {
    /// `idle`, `syncing`, `offline`, `auth_required` or `failed`.
    pub state: String,
    /// Code of the last failure when `state` is `failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[ts(type = "number")]
    pub pending: usize,
    #[ts(type = "number")]
    pub conflicts: usize,
    #[ts(type = "number")]
    pub rejected: usize,
    #[ts(type = "number")]
    pub quarantined: usize,
    pub failures: u32,
    /// Whole seconds before the next run may start (`Retry-After`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub retry_after: Option<u64>,
    /// Offline writes are closed until the offline manifests match again.
    pub manifest_mismatch: bool,
}

impl From<&SyncStatus> for StatusDto {
    fn from(status: &SyncStatus) -> Self {
        let (state, error_code) = match &status.state {
            SyncState::Idle => ("idle", None),
            SyncState::Syncing => ("syncing", None),
            SyncState::Offline => ("offline", None),
            SyncState::AuthRequired => ("auth_required", None),
            SyncState::Failed(code) => ("failed", Some((*code).to_owned())),
        };
        Self {
            state: state.to_owned(),
            error_code,
            pending: status.pending,
            conflicts: status.conflicts,
            rejected: status.rejected,
            quarantined: status.quarantined,
            failures: status.failures,
            retry_after: status
                .retry_after
                .map(|wait| wait.as_secs() + u64::from(wait.subsec_nanos() > 0)),
            manifest_mismatch: status.manifest_mismatch,
        }
    }
}

/// One outbox entry (a queued local write).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct OutboxEntryDto {
    /// Key for `outbox_retry` / `outbox_discard`.
    pub idempotency_key: Uuid,
    pub resource: String,
    pub id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Uuid>,
    /// `create`, `update`, `delete` or `action`.
    pub op: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    /// `pending`, `in_flight`, `conflict`, `rejected` or `quarantined`.
    pub state: String,
    pub attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    pub occurred_at: String,
    #[ts(type = "Record<string, unknown>")]
    pub payload: Map<String, Value>,
}

impl From<&OutboxEntry> for OutboxEntryDto {
    fn from(entry: &OutboxEntry) -> Self {
        let m = &entry.mutation;
        Self {
            idempotency_key: m.idempotency_key,
            resource: m.resource.0.clone(),
            id: m.id,
            parent_id: m.parent_id,
            op: wire_name(&m.op),
            action: m.action.clone(),
            state: match entry.state {
                OutboxState::Pending => "pending",
                OutboxState::InFlight => "in_flight",
                OutboxState::Conflict => "conflict",
                OutboxState::Rejected => "rejected",
                OutboxState::Quarantined => "quarantined",
            }
            .to_owned(),
            attempts: entry.attempts,
            last_error: entry.last_error.clone(),
            occurred_at: m.occurred_at.0.clone(),
            payload: m.payload.clone(),
        }
    }
}

/// One open Conflict Inbox record.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct ConflictDto {
    /// Key for `conflicts_resolve`.
    pub idempotency_key: Uuid,
    pub resource: String,
    pub id: Uuid,
    /// `VERSION_CONFLICT`, `DOCUMENT_LOCKED` or `DUPLICATE_RECORD`.
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[ts(type = "number | null")]
    pub base_version: Option<u64>,
    #[ts(type = "number | null")]
    pub server_version: Option<u64>,
    pub conflicting_fields: Vec<String>,
    /// The server row (`null` for a duplicate or a row deleted there).
    #[ts(type = "unknown")]
    pub server_data: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub candidates: Option<Vec<Uuid>>,
    /// Choices the server allows, as `conflicts_resolve` takes them.
    pub choices: Vec<String>,
    /// The local draft's operation and payload.
    pub local_op: String,
    #[ts(type = "Record<string, unknown>")]
    pub local_payload: Map<String, Value>,
    pub detected_at: String,
}

impl From<&ConflictRecord> for ConflictDto {
    fn from(record: &ConflictRecord) -> Self {
        let c = &record.conflict;
        Self {
            idempotency_key: record.idempotency_key,
            resource: record.resource.0.clone(),
            id: record.id,
            code: wire_name(&c.code),
            message: c.message.clone(),
            base_version: c.base_version,
            server_version: c.server_version,
            conflicting_fields: c.conflicting_fields.clone(),
            server_data: serde_json::to_value(&c.server_data).unwrap_or(Value::Null),
            candidates: c.candidates.clone(),
            choices: c.choices.iter().map(wire_name).collect(),
            local_op: wire_name(&record.local.op),
            local_payload: record.local.payload.clone(),
            detected_at: record.detected_at.0.clone(),
        }
    }
}

/// A user decision on a conflict.
#[derive(Debug, Clone, PartialEq, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(deny_unknown_fields)]
pub struct ConflictResolveDto {
    pub idempotency_key: Uuid,
    /// One of the record's `choices`.
    pub choice: String,
    /// `use_existing`: the chosen candidate row.
    #[serde(default)]
    #[ts(optional)]
    pub candidate: Option<Uuid>,
    /// `merge`: the merged payload.
    #[serde(default)]
    #[ts(type = "Record<string, unknown>", optional)]
    pub merged: Option<Map<String, Value>>,
}

/// What a resolution did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct ResolutionDto {
    /// `queued` (a new draft goes to the server), `take_server`,
    /// `use_existing` or `discard`.
    pub action: String,
}

/// The serde name of a wire enum value (`snake_case` or
/// `SCREAMING_SNAKE_CASE`, as the contract spells it).
pub(crate) fn wire_name<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(Value::String(name)) => name,
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn status_names_and_counts() {
        let status = SyncStatus {
            state: SyncState::Failed("SERVER_ERROR"),
            pending: 2,
            conflicts: 1,
            rejected: 0,
            quarantined: 3,
            failures: 4,
            retry_after: Some(Duration::from_millis(1500)),
            manifest_mismatch: true,
        };
        assert_eq!(
            serde_json::to_value(StatusDto::from(&status)).unwrap(),
            serde_json::json!({
                "state": "failed", "error_code": "SERVER_ERROR", "pending": 2,
                "conflicts": 1, "rejected": 0, "quarantined": 3, "failures": 4,
                "retry_after": 2, "manifest_mismatch": true
            })
        );
        let idle = StatusDto::from(&SyncStatus::default());
        assert_eq!((idle.state.as_str(), idle.error_code), ("idle", None));
        let auth = SyncStatus {
            state: SyncState::AuthRequired,
            ..SyncStatus::default()
        };
        assert_eq!(StatusDto::from(&auth).state, "auth_required");
    }
}
