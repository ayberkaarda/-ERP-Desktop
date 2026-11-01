//! Offline writes: a [`LocalPlan::Write`] becomes a draft in the outbox.
//!
//! - The answer is `202` with the row as the user will see it (drafts laid
//!   over) and `meta.offline.pending`. A refusal of the engine
//!   (`DOCUMENT_LOCKED`, `SYNC_OFFLINE_WRITE_NOT_ALLOWED`) comes back in the
//!   server's error envelope: nothing is queued.
//! - `base_version` is the `version` of the request (the row the user edited;
//!   a newer local row must still conflict on the server), else the local
//!   row's. A row without a version is a local create, the first version the
//!   server will give it. A target this device does not hold cannot be
//!   based on anything and is not drafted.
//! - `depends_on` names the queued creates a payload refers to, so a document
//!   of a new party waits for that party.
//!
//! `Idempotency-Key`: the engine picks the outbox key of a draft, so a
//! repeat is recognised from what the key leaves behind. A create takes its
//! row id from the key ([`draft_id`]): the row already being there is the
//! repeat, also after the push and across restarts. Any other write is a
//! repeat while it is still the last write queued for its row; once that
//! write has been settled, a repeat is a new draft with the same content,
//! which the server checks against `base_version` like any other. Writes run
//! one at a time, so repeats racing each other queue one draft.

use std::sync::{Mutex, PoisonError};

use keystone_sync::SyncError;
use keystone_sync::outbox::{EnqueueOutcome, NewMutation, OutboxEntry, OutboxState};
use keystone_sync::wire::{MutationOp, ResourceName, Timestamp};
use serde_json::{Map, Value, json};
use time::OffsetDateTime;
use time::macros::format_description;
use uuid::Uuid;

use super::envelope::{self, OfflineMeta};
use super::local_read::row_json;
use super::{ApiCall, LocalOutcome};
use crate::commands::CommandResult;
use crate::dto::api::ApiResponseDto;
use crate::state::Engine;

const VALIDATION_ERROR: &str = "VALIDATION_ERROR";
const OFFLINE_UNAVAILABLE: &str = "OFFLINE_UNAVAILABLE";
const DEPENDENCY_FAILED: &str = "SYNC_DEPENDENCY_FAILED";

/// Check for a repeat and enqueue are one step.
static WRITES: Mutex<()> = Mutex::new(());

/// The fields of a [`super::LocalPlan::Write`].
#[derive(Debug, Clone, Copy)]
pub struct Target<'a> {
    pub resource: &'a ResourceName,
    pub op: MutationOp,
    pub action: Option<&'a str>,
    pub id: Option<Uuid>,
    pub parent_id: Option<Uuid>,
}

/// The request body as a mutation wants it.
#[derive(Debug)]
struct Draft {
    /// Without `id` and `version`.
    payload: Map<String, Value>,
    version: Option<u64>,
    id: Option<Uuid>,
}

/// Queues `target`, or answers why not.
pub fn write(engine: &Engine, target: &Target<'_>, call: &ApiCall) -> CommandResult<LocalOutcome> {
    let draft = match parse(target.op, call) {
        Ok(draft) => draft,
        Err(answer) => return Ok(LocalOutcome::Answer(answer)),
    };
    let _one_at_a_time = WRITES.lock().unwrap_or_else(PoisonError::into_inner);
    let entries = match engine.outbox_entries() {
        Ok(entries) => entries,
        Err(error) => return refusal(error),
    };
    if target.op == MutationOp::Create {
        create(engine, target, call, draft, &entries)
    } else {
        change(engine, target, call, draft, &entries)
    }
}

/// Whether the last queued write of the row deletes it.
pub fn deleted_here(engine: &Engine, resource: &ResourceName, id: Uuid) -> CommandResult<bool> {
    let entries = match engine.outbox_entries() {
        Ok(entries) => entries,
        Err(error) if error.code() == OFFLINE_UNAVAILABLE => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    Ok(last_write(&entries, resource, id).is_some_and(|e| e.mutation.op == MutationOp::Delete))
}

fn create(
    engine: &Engine,
    target: &Target<'_>,
    call: &ApiCall,
    draft: Draft,
    entries: &[OutboxEntry],
) -> CommandResult<LocalOutcome> {
    let key = call.header("idempotency-key");
    let id = draft
        .id
        .or_else(|| key.map(|key| draft_id(target.resource, key)))
        .unwrap_or_else(Uuid::now_v7);
    let existing = match engine.get(target.resource, id) {
        Ok(existing) => existing,
        Err(error) => return refusal(error),
    };
    if let Some(existing) = existing {
        if key.is_none() {
            return Ok(invalid("id", "this id cannot be used for a new record"));
        }
        let create = entries.iter().find(|e| {
            e.mutation.op == MutationOp::Create
                && e.mutation.id == id
                && &e.mutation.resource == target.resource
        });
        if create.is_some_and(|e| !holds(&e.mutation.payload, &draft.payload)) {
            return Ok(LocalOutcome::Answer(envelope::local(
                422,
                envelope::error(
                    "IDEMPOTENCY_KEY_REUSED",
                    "this idempotency key was used for another request",
                    None,
                ),
            )));
        }
        let data = row_json(&existing.row)?;
        return Ok(LocalOutcome::Answer(queued(data, existing.draft)));
    }
    enqueue(engine, target, id, None, draft.payload, entries)
}

fn change(
    engine: &Engine,
    target: &Target<'_>,
    call: &ApiCall,
    draft: Draft,
    entries: &[OutboxEntry],
) -> CommandResult<LocalOutcome> {
    let Some(id) = target.id else {
        return Ok(unavailable("this record is not on this device"));
    };
    let current = match engine.get(target.resource, id) {
        Ok(current) => current,
        Err(error) => return refusal(error),
    };
    if call.header("idempotency-key").is_some()
        && last_write(entries, target.resource, id).is_some_and(|last| {
            last.mutation.op == target.op
                && last.mutation.action.as_deref() == target.action
                && holds(&last.mutation.payload, &draft.payload)
        })
    {
        return pending(engine, target.resource, id);
    }
    let Some(current) = current else {
        if last_write(entries, target.resource, id)
            .is_some_and(|last| last.mutation.op == MutationOp::Delete)
        {
            return Ok(LocalOutcome::Answer(envelope::local(
                404,
                envelope::error("NOT_FOUND", "this record is deleted on this device", None),
            )));
        }
        return Ok(unavailable("this record is not on this device"));
    };
    let base = draft
        .version
        .or(current.row.version)
        .or(current.draft.then_some(1));
    let Some(base) = base else {
        return Ok(unavailable("this record has no version on this device"));
    };
    enqueue(engine, target, id, Some(base), draft.payload, entries)
}

fn enqueue(
    engine: &Engine,
    target: &Target<'_>,
    id: Uuid,
    base_version: Option<u64>,
    payload: Map<String, Value>,
    entries: &[OutboxEntry],
) -> CommandResult<LocalOutcome> {
    let depends_on = prerequisites(entries, id, &payload);
    let mutation = NewMutation {
        op: target.op,
        action: target.action.map(str::to_owned),
        resource: target.resource.clone(),
        id,
        parent_id: target.parent_id,
        base_version,
        payload,
        depends_on,
        occurred_at: Timestamp(now()?),
        resolution: None,
    };
    match engine.enqueue(mutation) {
        Ok(EnqueueOutcome::Queued(_)) => pending(engine, target.resource, id),
        // The create was never sent: nothing is left to do.
        Ok(EnqueueOutcome::Cancelled(_)) => Ok(LocalOutcome::Answer(envelope::local(
            200,
            envelope::with_offline(
                envelope::success(Value::Null, Map::new()),
                &OfflineMeta::default(),
            ),
        ))),
        Err(error) => refusal(error),
    }
}

/// `202` with the row as it reads now (`null` once deleted).
fn pending(engine: &Engine, resource: &ResourceName, id: Uuid) -> CommandResult<LocalOutcome> {
    let data = match engine.get(resource, id)? {
        Some(local) => row_json(&local.row)?,
        None => Value::Null,
    };
    Ok(LocalOutcome::Answer(queued(data, true)))
}

fn queued(data: Value, pending: bool) -> ApiResponseDto {
    let offline = OfflineMeta {
        pending,
        ..OfflineMeta::default()
    };
    envelope::local(
        202,
        envelope::with_offline(envelope::success(data, Map::new()), &offline),
    )
}

/// A refusal of the engine in the server's envelope; other failures have no
/// answer.
fn refusal(error: SyncError) -> CommandResult<LocalOutcome> {
    let code = error.code();
    match error {
        SyncError::Api {
            status,
            message,
            fields,
            ..
        } => {
            let fields = (!fields.is_empty()).then(|| {
                fields
                    .into_iter()
                    .map(|(name, messages)| (name, json!(messages)))
                    .collect()
            });
            Ok(LocalOutcome::Answer(envelope::local(
                status,
                envelope::error(code, &message, fields),
            )))
        }
        SyncError::OfflineUnavailable(message) => Ok(unavailable(&message)),
        error => Err(error.into()),
    }
}

fn unavailable(message: &str) -> LocalOutcome {
    LocalOutcome::Answer(envelope::local(
        503,
        envelope::error(OFFLINE_UNAVAILABLE, message, None),
    ))
}

fn invalid(field: &str, message: &str) -> LocalOutcome {
    LocalOutcome::Answer(invalid_body(Some(field), message))
}

fn invalid_body(field: Option<&str>, message: &str) -> ApiResponseDto {
    let fields = field.map(|field| {
        let mut fields = Map::new();
        fields.insert(field.to_owned(), json!([message]));
        fields
    });
    envelope::local(422, envelope::error(VALIDATION_ERROR, message, fields))
}

/// Reads the request. The checks are the ones the outbox would fail on with
/// a store error, answered here as the validation errors they are.
fn parse(op: MutationOp, call: &ApiCall) -> Result<Draft, ApiResponseDto> {
    let body = match call.json_body() {
        Some(Ok(Value::Object(body))) => Some(body),
        None if op == MutationOp::Delete => None,
        Some(Ok(_) | Err(_)) if op == MutationOp::Delete => None,
        _ => return Err(invalid_body(None, "the body must be a JSON object")),
    };
    let mut payload = body.unwrap_or_default();
    let version = match payload.remove("version") {
        Some(value) => Some(version_of(value.as_u64())?),
        None => match call.query.iter().find(|(name, _)| name == "version") {
            Some((_, value)) => Some(version_of(value.parse().ok())?),
            None => None,
        },
    };
    let id = match payload.remove("id") {
        Some(value) if op == MutationOp::Create => Some(client_id(&value)?),
        _ => None,
    };
    if op == MutationOp::Delete {
        payload.clear();
    } else if op != MutationOp::Create && payload.is_empty() {
        return Err(invalid_body(None, "the body has nothing to change"));
    }
    Ok(Draft {
        payload,
        version,
        id,
    })
}

fn version_of(value: Option<u64>) -> Result<u64, ApiResponseDto> {
    value
        .filter(|version| *version > 0)
        .ok_or_else(|| invalid_body(Some("version"), "the version must be a positive integer"))
}

/// A lowercase canonical UUIDv7, as `ClientKey` on the server wants it.
fn client_id(value: &Value) -> Result<Uuid, ApiResponseDto> {
    value
        .as_str()
        .and_then(|text| {
            Uuid::try_parse(text)
                .ok()
                .filter(|id| id.get_version_num() == 7 && id.to_string() == text)
        })
        .ok_or_else(|| invalid_body(Some("id"), "this id cannot be used for a new record"))
}

/// Row id of a create repeated under `key`: FNV-1a over resource and key
/// (fixed for good: it must give the same id after an update of the app),
/// with the bits of a UUIDv7.
fn draft_id(resource: &ResourceName, key: &str) -> Uuid {
    const OFFSET: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
    const PRIME: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;
    let bytes = resource.as_str().bytes().chain([0]).chain(key.bytes());
    let hash = bytes.fold(OFFSET, |hash, byte| {
        (hash ^ u128::from(byte)).wrapping_mul(PRIME)
    });
    let versioned = (hash & !(0xf << 76)) | (0x7 << 76);
    Uuid::from_u128((versioned & !(0b11 << 62)) | (0b10 << 62))
}

fn last_write<'a>(
    entries: &'a [OutboxEntry],
    resource: &ResourceName,
    id: Uuid,
) -> Option<&'a OutboxEntry> {
    entries
        .iter()
        .filter(|e| e.mutation.id == id && &e.mutation.resource == resource)
        .max_by_key(|e| e.seq)
}

/// `queued` has every field of `payload` with the same value.
fn holds(queued: &Map<String, Value>, payload: &Map<String, Value>) -> bool {
    payload
        .iter()
        .all(|(field, value)| queued.get(field) == Some(value))
}

/// Keys of the queued creates `payload` refers to. A create that failed is
/// not one: the outbox refuses an edge to it, and the server refuses a
/// reference to a row that never came.
fn prerequisites(entries: &[OutboxEntry], id: Uuid, payload: &Map<String, Value>) -> Vec<Uuid> {
    entries
        .iter()
        .filter(|e| {
            e.mutation.op == MutationOp::Create
                && e.mutation.id != id
                && matches!(
                    e.state,
                    OutboxState::Pending | OutboxState::InFlight | OutboxState::Conflict
                )
                && e.last_error.as_deref() != Some(DEPENDENCY_FAILED)
                && payload.values().any(|v| references(v, e.mutation.id))
        })
        .map(|e| e.mutation.idempotency_key)
        .collect()
}

fn references(value: &Value, id: Uuid) -> bool {
    match value {
        Value::String(text) => Uuid::try_parse(text) == Ok(id),
        Value::Array(values) => values.iter().any(|v| references(v, id)),
        Value::Object(values) => values.values().any(|v| references(v, id)),
        _ => false,
    }
}

fn now() -> CommandResult<String> {
    let format =
        format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");
    OffsetDateTime::now_utc()
        .format(&format)
        .map_err(|_| SyncError::InvalidRequest("the clock cannot be read".to_owned()).into())
}

#[cfg(test)]
mod tests;
