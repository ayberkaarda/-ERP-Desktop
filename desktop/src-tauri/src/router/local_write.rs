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
//! `Idempotency-Key`: the key is recorded with the draft in one transaction
//! ([`Engine::enqueue_keyed`]) and the record outlives the outbox entry, so
//! a repeat queues nothing and reaches no server, offline or after the push
//! ([`replay`]). It answers with the first status and the row as it reads
//! now, not with a copy of the first answer: `pending` must not outlive the
//! draft. The same key on another request is `IDEMPOTENCY_KEY_REUSED`.

use keystone_sync::SyncError;
use keystone_sync::outbox::{
    EnqueueOutcome, KeyedOutcome, NewMutation, OutboxEntry, OutboxState, RequestKey, RequestRecord,
};
use keystone_sync::wire::{MutationOp, ResourceName, Timestamp};
use serde_json::{Map, Value, json};
use uuid::Uuid;

use super::envelope::{self, OfflineMeta};
use super::local_read::{open, row_json, timestamp};
use super::{ApiCall, LocalOutcome};
use crate::commands::CommandResult;
use crate::dto::api::ApiResponseDto;
use crate::state::Engine;

const VALIDATION_ERROR: &str = "VALIDATION_ERROR";
const OFFLINE_UNAVAILABLE: &str = "OFFLINE_UNAVAILABLE";
const DEPENDENCY_FAILED: &str = "SYNC_DEPENDENCY_FAILED";

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

/// The answer to a repeat of `call`: `None` when its key is unknown here,
/// or local data is closed to this sign-in.
pub fn replay(engine: &Engine, call: &ApiCall) -> CommandResult<Option<ApiResponseDto>> {
    let Some(key) = request_key(call) else {
        return Ok(None);
    };
    match engine.request_record(&key) {
        Ok(Some(record)) => repeat_answer(engine, &record).map(Some),
        Ok(None) => Ok(None),
        Err(error) if error.code() == "IDEMPOTENCY_KEY_REUSED" => match refusal(error)? {
            LocalOutcome::Answer(answer) => Ok(Some(answer)),
            LocalOutcome::Unsupported { .. } => Ok(None),
        },
        Err(error) => open(Err(error)),
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
    let id = draft.id.unwrap_or_else(Uuid::now_v7);
    if draft.id.is_some() {
        match engine.get(target.resource, id) {
            Ok(Some(_)) => return Ok(invalid("id", "this id cannot be used for a new record")),
            Ok(None) => {}
            Err(error) => return refusal(error),
        }
    }
    enqueue(engine, target, call, id, None, draft.payload, entries)
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
    let payload = draft.payload;
    enqueue(engine, target, call, id, Some(base), payload, entries)
}

fn enqueue(
    engine: &Engine,
    target: &Target<'_>,
    call: &ApiCall,
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
        occurred_at: Timestamp(timestamp()?),
        resolution: None,
    };
    let outcome = match request_key(call) {
        Some(key) => engine.enqueue_keyed(mutation, &key),
        None => engine.enqueue(mutation).map(KeyedOutcome::New),
    };
    let answer = match outcome {
        Ok(KeyedOutcome::New(EnqueueOutcome::Queued(_))) => {
            queued(row_data(engine, target.resource, id)?, true)
        }
        Ok(KeyedOutcome::New(EnqueueOutcome::Cancelled(_))) => cancelled(),
        Ok(KeyedOutcome::Repeat(record)) => repeat_answer(engine, &record)?,
        Err(error) => return refusal(error),
    };
    Ok(LocalOutcome::Answer(answer))
}

fn repeat_answer(engine: &Engine, record: &RequestRecord) -> CommandResult<ApiResponseDto> {
    if record.cancelled {
        return Ok(cancelled());
    }
    let entries = engine.outbox_entries()?;
    let pending = last_write(&entries, &record.resource, record.id).is_some();
    Ok(queued(
        row_data(engine, &record.resource, record.id)?,
        pending,
    ))
}

/// The row as it reads now, `null` once it is gone.
fn row_data(engine: &Engine, resource: &ResourceName, id: Uuid) -> CommandResult<Value> {
    Ok(match engine.get(resource, id)? {
        Some(local) => row_json(&local.row)?,
        None => Value::Null,
    })
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

/// The delete of a create that was never sent: nothing is left to do.
fn cancelled() -> ApiResponseDto {
    envelope::local(
        200,
        envelope::with_offline(
            envelope::success(Value::Null, Map::new()),
            &OfflineMeta::default(),
        ),
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

/// The `Idempotency-Key` of `call` with a digest of the request: method,
/// path, query and body, JSON object keys in sorted order.
fn request_key(call: &ApiCall) -> Option<RequestKey> {
    let key = call.header("idempotency-key")?;
    let mut request = format!("{:?} {}\n", call.method, call.path);
    for (name, value) in &call.query {
        request.push_str(&format!("{name}={value}\n"));
    }
    match call.json_body() {
        Some(Ok(body)) => canonical(&body, &mut request),
        _ => request.push_str(&String::from_utf8_lossy(
            call.body.as_deref().unwrap_or_default(),
        )),
    }
    Some(RequestKey {
        key: key.to_owned(),
        fingerprint: format!("{:032x}", fnv1a(request.as_bytes())),
    })
}

fn canonical(value: &Value, out: &mut String) {
    match value {
        Value::Object(fields) => {
            let mut names: Vec<&String> = fields.keys().collect();
            names.sort();
            out.push('{');
            for name in names {
                out.push_str(&Value::from(name.as_str()).to_string());
                out.push(':');
                canonical(&fields[name], out);
                out.push(',');
            }
            out.push('}');
        }
        Value::Array(values) => {
            out.push('[');
            for value in values {
                canonical(value, out);
                out.push(',');
            }
            out.push(']');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

/// FNV-1a, 128 bits: tells requests apart, nobody attacks their own outbox.
fn fnv1a(bytes: &[u8]) -> u128 {
    const OFFSET: u128 = 0x6c62_272e_07bb_0142_62b8_2175_6295_c58d;
    const PRIME: u128 = 0x0000_0000_0100_0000_0000_0000_0000_013b;
    bytes.iter().fold(OFFSET, |hash, byte| {
        (hash ^ u128::from(*byte)).wrapping_mul(PRIME)
    })
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

#[cfg(test)]
mod tests;
