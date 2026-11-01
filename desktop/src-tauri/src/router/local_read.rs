//! Reads on this device: the [`LocalResolver`] of `api_request`.
//!
//! Rows and snapshots come through the engine, so every read is checked
//! against the sign-in, the seal and the manifest under one guard, and sees
//! pending drafts laid over the mirror. A read the local data may not answer
//! (a new sign-in nobody verified yet, a resource the user lost) is
//! [`LocalOutcome::Unsupported`]: online the server answers, offline it is
//! `OFFLINE_UNAVAILABLE`.
//!
//! Answers carry `meta.offline` ([`OfflineMeta`]). The [`Store`] knows the
//! state of a copy (complete or still downloading, and since when); it holds
//! no data the engine guards. A copy the store has nothing on can still show
//! rows through the engine: queued drafts of a resource never downloaded,
//! which count as partial.
//!
//! Snapshots are the whole answers of a `source: snapshot` resource:
//! [`save_snapshot`] keeps a successful one, [`narrowing`] tells which query
//! parameters make an answer something else.

use std::sync::Arc;

use keystone_sync::SyncError;
use keystone_sync::store::{Filter, ListQuery, LocalCopy, Store};
use keystone_sync::wire::{ResourceName, Timestamp};
use serde_json::{Map, Value};
use time::OffsetDateTime;
use time::macros::format_description;
use uuid::Uuid;

use super::envelope::{self, OfflineMeta};
use super::{ApiCall, LocalOutcome, LocalPlan, LocalResolver, local_write, query_map};
use crate::commands::CommandResult;
use crate::dto::api::ApiResponseDto;
use crate::state::Engine;

const NOT_FOUND: &str = "NOT_FOUND";

/// Answers from the mirror, the snapshots and the outbox.
#[derive(Debug, Clone, Copy, Default)]
pub struct LocalAnswers;

/// The read of a [`LocalPlan::Read`].
struct Read<'a> {
    store: Option<&'a Store>,
    resource: &'a ResourceName,
    parent_id: Option<Uuid>,
    partial: bool,
    stale: bool,
}

impl LocalResolver for LocalAnswers {
    fn local_copy(
        &self,
        engine: &Engine,
        store: Option<&Store>,
        resource: &ResourceName,
    ) -> CommandResult<LocalCopy> {
        if let Some(store) = store {
            let copy = store.local_copy(resource)?;
            if copy != LocalCopy::Missing {
                return Ok(copy);
            }
        }
        seen_copy(engine, resource)
    }

    fn resolve(
        &self,
        engine: &Engine,
        store: Option<&Store>,
        plan: &LocalPlan,
        call: &ApiCall,
    ) -> CommandResult<LocalOutcome> {
        match plan {
            LocalPlan::Read {
                resource,
                id,
                parent_id,
                partial,
                stale,
            } => {
                let read = Read {
                    store,
                    resource,
                    parent_id: *parent_id,
                    partial: *partial,
                    stale: *stale,
                };
                match id {
                    Some(id) => item(engine, &read, *id, call),
                    None => list(engine, &read, call),
                }
            }
            LocalPlan::Snapshot { resource } => snapshot(engine, resource, call),
            LocalPlan::Write {
                resource,
                op,
                action,
                id,
                parent_id,
            } => local_write::write(
                engine,
                &local_write::Target {
                    resource,
                    op: *op,
                    action: action.as_deref(),
                    id: *id,
                    parent_id: *parent_id,
                },
                call,
            ),
        }
    }

    fn replay(&self, engine: &Engine, call: &ApiCall) -> CommandResult<Option<ApiResponseDto>> {
        local_write::replay(engine, call)
    }
}

fn list(engine: &Engine, read: &Read<'_>, call: &ApiCall) -> CommandResult<LocalOutcome> {
    let spec = query_map::spec_of(read.resource);
    let mapped = spec.map(|spec| query_map::list_query(spec, &call.query));
    let mut mapped = match mapped {
        Some(Ok(mapped)) => mapped,
        Some(Err(unsupported_filters)) => {
            return Ok(LocalOutcome::Unsupported {
                unsupported_filters,
            });
        }
        None => return Ok(unsupported()),
    };
    if let Some(parent) = read.parent_id {
        let Some(field) = query_map::parent_field(read.resource.as_str()) else {
            return Ok(unsupported());
        };
        let parent = Filter::eq(field, parent.to_string());
        mapped.query.filters.push(parent);
    }
    let Some(page) = open(engine.list(read.resource, &mapped.query))? else {
        return Ok(unsupported());
    };
    let pending = !page.drafts.is_empty();
    let rows = page.rows.iter().map(row_json).collect::<Result<_, _>>()?;
    let per_page = u64::from(mapped.per_page);
    let body = envelope::paginated(rows, mapped.page, per_page, page.total);
    answer(body, read, pending)
}

fn item(engine: &Engine, read: &Read<'_>, id: Uuid, call: &ApiCall) -> CommandResult<LocalOutcome> {
    if !call.query.is_empty() {
        let unsupported_filters = call.query.iter().map(|(name, _)| name.clone()).collect();
        return Ok(LocalOutcome::Unsupported {
            unsupported_filters,
        });
    }
    let Some(found) = open(engine.get(read.resource, id))? else {
        return Ok(unsupported());
    };
    let found = match (found, read.parent_id) {
        (Some(local), Some(parent)) => {
            let Some(field) = query_map::parent_field(read.resource.as_str()) else {
                return Ok(unsupported());
            };
            let wanted = parent.to_string();
            let same = local.row.fields.get(field).and_then(Value::as_str);
            (same == Some(wanted.as_str())).then_some(local)
        }
        (found, _) => found,
    };
    match found {
        Some(local) => {
            let body = envelope::success(row_json(&local.row)?, Map::new());
            answer(body, read, local.draft)
        }
        None if local_write::deleted_here(engine, read.resource, id)? => Ok(not_found()),
        // Not on this device says nothing about the server: the copy is
        // unfinished, or the row left the document window.
        None if read.partial || windowed(read.resource) => Ok(unsupported()),
        None => Ok(not_found()),
    }
}

fn answer(body: Value, read: &Read<'_>, pending: bool) -> CommandResult<LocalOutcome> {
    let as_of = match read.store {
        Some(store) => store.resource_state(read.resource)?.map(|s| s.synced_at),
        None => None,
    };
    let offline = OfflineMeta {
        as_of,
        partial: read.partial,
        stale: read.stale,
        pending,
        unsupported_filters: Vec::new(),
    };
    Ok(LocalOutcome::Answer(envelope::local(
        200,
        envelope::with_offline(body, &offline),
    )))
}

/// What the engine shows of a resource the store has no copy of: a stored
/// snapshot, or rows that can only be part of one. Local data closed to this
/// sign-in shows nothing.
fn seen_copy(engine: &Engine, resource: &ResourceName) -> CommandResult<LocalCopy> {
    let Some(snapshot) = open(engine.snapshot(resource))? else {
        return Ok(LocalCopy::Missing);
    };
    if snapshot.is_some() {
        return Ok(LocalCopy::Complete);
    }
    let probe = ListQuery {
        limit: Some(1),
        ..ListQuery::default()
    };
    Ok(match open(engine.list(resource, &probe))? {
        Some(page) if page.total > 0 => LocalCopy::Partial,
        _ => LocalCopy::Missing,
    })
}

/// Names in `query` that make an answer of a snapshot resource anything
/// but its first page.
pub fn narrowing(query: &[(String, String)]) -> Vec<String> {
    query
        .iter()
        .filter(|(name, value)| match name.as_str() {
            "per_page" => false,
            "page" => value != "1",
            _ => true,
        })
        .map(|(name, _)| name.clone())
        .collect()
}

/// The stored answer of a `source: snapshot` resource.
fn snapshot(
    engine: &Engine,
    resource: &ResourceName,
    call: &ApiCall,
) -> CommandResult<LocalOutcome> {
    let unsupported_filters = narrowing(&call.query);
    if !unsupported_filters.is_empty() {
        return Ok(LocalOutcome::Unsupported {
            unsupported_filters,
        });
    }
    let Some(Some(snapshot)) = open(engine.snapshot(resource))? else {
        return Ok(unsupported());
    };
    let body = if snapshot.data.get("data").is_some() {
        snapshot.data
    } else {
        envelope::success(snapshot.data, Map::new())
    };
    let offline = OfflineMeta {
        as_of: Some(snapshot.fetched_at.0),
        stale: true,
        ..OfflineMeta::default()
    };
    Ok(LocalOutcome::Answer(envelope::local(
        200,
        envelope::with_offline(body, &offline),
    )))
}

/// Keeps `body`, an answer of `resource` fetched in sign-in `generation`,
/// as of now. The engine refuses it for any other sign-in or for local
/// data that is sealed or not verified.
pub fn save_snapshot(
    engine: &Arc<Engine>,
    resource: &ResourceName,
    body: &Value,
    generation: u64,
) -> CommandResult<()> {
    let fetched_at = Timestamp(timestamp()?);
    Ok(engine.put_snapshot(resource, body, &fetched_at, generation)?)
}

/// UTC time with milliseconds: the wire `timestamp` allows up to six digits.
pub(super) fn timestamp() -> CommandResult<String> {
    let format =
        format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");
    OffsetDateTime::now_utc()
        .format(&format)
        .map_err(|_| SyncError::InvalidRequest("the clock cannot be read".to_owned()).into())
}

/// `None` when the local data is closed to this sign-in or this resource.
pub(super) fn open<T>(result: Result<T, SyncError>) -> CommandResult<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(error) if matches!(error.code(), "OFFLINE_UNAVAILABLE" | "FORBIDDEN") => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn unsupported() -> LocalOutcome {
    LocalOutcome::Unsupported {
        unsupported_filters: Vec::new(),
    }
}

fn not_found() -> LocalOutcome {
    LocalOutcome::Answer(envelope::local(
        404,
        envelope::error(NOT_FOUND, "this record does not exist on this device", None),
    ))
}

fn windowed(resource: &ResourceName) -> bool {
    query_map::spec_of(resource).is_some_and(|spec| spec.window.is_some())
}

pub(super) fn row_json(row: &keystone_sync::wire::ResourceRow) -> Result<Value, SyncError> {
    Ok(serde_json::to_value(row)?)
}

#[cfg(test)]
mod tests;
