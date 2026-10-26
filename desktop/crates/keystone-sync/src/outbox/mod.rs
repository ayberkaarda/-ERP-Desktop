//! Durable offline mutations and explicit dependency scheduling.
use std::collections::HashSet;
use std::sync::Arc;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::conflicts::{ConflictRecord, persist_record};
use crate::error::{Result, SyncError};
use crate::store::{Migration, Store};
use crate::wire::{
    Mutation, MutationOp, PushResult, PushStatus, Resolution, ResourceName, Timestamp,
};

pub const MIGRATIONS: &[Migration] = &[Migration {
    id: 100,
    module: "outbox",
    name: "outbox_queue",
    sql: "CREATE TABLE outbox_entries (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        mutation TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','in_flight','conflict','rejected','quarantined')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT
    ) STRICT;
    CREATE TABLE outbox_settled (key TEXT PRIMARY KEY, success INTEGER NOT NULL) STRICT;",
}, Migration {
    id: 101, module: "outbox", name: "retry_and_remaps",
    sql: "ALTER TABLE outbox_entries ADD COLUMN sent INTEGER NOT NULL DEFAULT 0;
    UPDATE outbox_entries SET sent=1 WHERE attempts>0 OR state!='pending';
    CREATE TABLE outbox_key_remaps(old_key TEXT PRIMARY KEY,new_key TEXT NOT NULL) STRICT;
    CREATE TABLE outbox_id_remaps(old_id TEXT PRIMARY KEY,new_id TEXT NOT NULL) STRICT;",
}];

pub const MAX_ATTEMPTS: u32 = 5;

#[derive(Debug, Clone, PartialEq)]
pub struct NewMutation {
    pub op: MutationOp,
    pub action: Option<String>,
    pub resource: ResourceName,
    pub id: Uuid,
    pub parent_id: Option<Uuid>,
    pub base_version: Option<u64>,
    pub payload: Map<String, Value>,
    pub depends_on: Vec<Uuid>,
    pub occurred_at: Timestamp,
    pub resolution: Option<Resolution>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum OutboxState {
    Pending,
    InFlight,
    Conflict,
    Rejected,
    Quarantined,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OutboxEntry {
    pub sent: bool,
    pub seq: i64,
    pub mutation: Mutation,
    pub state: OutboxState,
    pub attempts: u32,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct PushOutcome {
    pub applied: usize,
    pub conflicts: usize,
    pub rejected: usize,
    /// Successful results, including server rows, for the engine's mirror update.
    pub results: Vec<PushResult>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnqueueOutcome {
    Queued(Uuid),
    Cancelled(Uuid),
}

pub trait OutboxQueue {
    fn enqueue_outcome(&self, mutation: NewMutation) -> Result<EnqueueOutcome>;
    fn transient_failure(&self, key: Uuid) -> Result<()>;
    fn retry(&self, key: Uuid) -> Result<()>;
    fn discard(&self, key: Uuid) -> Result<()>;
    /// Cancellation is committed before this compatibility API returns an error.
    fn enqueue(&self, mutation: NewMutation) -> Result<Uuid> {
        match self.enqueue_outcome(mutation)? {
            EnqueueOutcome::Queued(key) => Ok(key),
            EnqueueOutcome::Cancelled(_) => Err(invalid("create cancelled by delete; no live key")),
        }
    }
    /// `max` is the manifest's push_batch_max; the wire ceiling is 500.
    fn next_batch(&self, max: usize) -> Result<Vec<Mutation>>;
    fn record_results(&self, results: &[PushResult]) -> Result<PushOutcome>;
    fn requeue_in_flight(&self) -> Result<usize>;
    fn pending_count(&self) -> Result<usize>;
}

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
    /// Includes rejected and quarantined entries for the user-facing queue.
    pub fn list(&self) -> Result<Vec<OutboxEntry>> {
        self.store.read(load)
    }
}

/// Inside the caller's write transaction: removes every outbox entry,
/// settled key and remap (sign-out and account wipes). Returns the number
/// of entries removed.
pub fn clear_on(tx: &Connection) -> Result<usize> {
    let removed = tx.execute("DELETE FROM outbox_entries", [])?;
    tx.execute_batch(
        "DELETE FROM outbox_settled;
         DELETE FROM outbox_key_remaps;
         DELETE FROM outbox_id_remaps;",
    )?;
    Ok(removed)
}

pub(crate) fn invalid(message: &str) -> SyncError {
    SyncError::Store(rusqlite::Error::InvalidParameterName(message.to_owned()))
}

pub(crate) fn load(conn: &Connection) -> Result<Vec<OutboxEntry>> {
    let mut stmt = conn.prepare("SELECT seq, mutation, state, attempts, last_error, sent FROM outbox_entries ORDER BY julianday(json_extract(mutation, '$.occurred_at')), seq")?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, u32>(3)?,
            r.get::<_, Option<String>>(4)?,
            r.get::<_, bool>(5)?,
        ))
    })?;
    let mut entries = Vec::new();
    for row in rows {
        let (seq, json, state, attempts, last_error, sent) = row?;
        let state = match state.as_str() {
            "pending" => OutboxState::Pending,
            "in_flight" => OutboxState::InFlight,
            "conflict" => OutboxState::Conflict,
            "rejected" => OutboxState::Rejected,
            "quarantined" => OutboxState::Quarantined,
            _ => return Err(invalid("invalid outbox state")),
        };
        entries.push(OutboxEntry {
            sent,
            seq,
            mutation: serde_json::from_str(&json)?,
            state,
            attempts,
            last_error,
        });
    }
    Ok(entries)
}

pub(crate) fn cancel(tx: &Transaction<'_>, key: Uuid, success: bool) -> Result<()> {
    tx.execute("DELETE FROM outbox_entries WHERE key=?1", [key.to_string()])?;
    tx.execute(
        "INSERT OR REPLACE INTO outbox_settled(key,success) VALUES (?1,?2)",
        params![key.to_string(), success],
    )?;
    Ok(())
}

fn dependencies(entry: &OutboxEntry, all: &[OutboxEntry]) -> Vec<Uuid> {
    let mut keys = entry.mutation.depends_on.clone().unwrap_or_default();
    // Same-row writes are implicit edges, even if the caller omitted depends_on.
    if entry.mutation.resolution.is_none() {
        keys.extend(
            all.iter()
                .filter(|other| {
                    (other.seq < entry.seq || other.mutation.resolution.is_some())
                        && other.mutation.resource == entry.mutation.resource
                        && other.mutation.id == entry.mutation.id
                        && other.seq != entry.seq
                        && !other
                            .mutation
                            .depends_on
                            .as_ref()
                            .is_some_and(|edges| edges.contains(&entry.mutation.idempotency_key))
                })
                .map(|e| e.mutation.idempotency_key),
        );
    }
    keys
}

fn reaches(start: Uuid, target: Uuid, all: &[OutboxEntry]) -> bool {
    let mut pending = vec![start];
    let mut seen = HashSet::new();
    while let Some(key) = pending.pop() {
        if key == target {
            return true;
        }
        if seen.insert(key)
            && let Some(entry) = all.iter().find(|e| e.mutation.idempotency_key == key)
        {
            pending.extend(dependencies(entry, all));
        }
    }
    false
}

impl OutboxQueue for Outbox {
    fn enqueue_outcome(&self, mut draft: NewMutation) -> Result<EnqueueOutcome> {
        self.store.write(|tx| {
            if draft.id.get_version_num() != 7
                || draft.payload.contains_key("version")
                || (draft.op == MutationOp::Create) != draft.base_version.is_none()
                || draft.base_version == Some(0)
                || (draft.op == MutationOp::Action) != draft.action.is_some()
                || (draft.op == MutationOp::Delete && !draft.payload.is_empty())
                || (matches!(draft.op, MutationOp::Update | MutationOp::Action)
                    && draft.payload.is_empty())
            {
                return Err(invalid("invalid mutation body"));
            }
            let all = load(tx)?;
            let original = draft.clone();
            remap_draft(tx, &mut draft)?;
            let mut deps = draft.depends_on.clone();
            for dep in &mut deps {
                let mut seen = HashSet::new();
                loop {
                    if !seen.insert(*dep) {
                        return Err(invalid("dependency remap cycle"));
                    }
                    let mapped: Option<String> = tx
                        .query_row(
                            "SELECT new_key FROM outbox_key_remaps WHERE old_key=?1",
                            [dep.to_string()],
                            |r| r.get(0),
                        )
                        .optional()?;
                    match mapped {
                        Some(mapped) => {
                            *dep = Uuid::parse_str(&mapped)
                                .map_err(|_| invalid("invalid dependency remap"))?
                        }
                        None => break,
                    }
                }
            }
            if draft != original {
                for entry in &all {
                    if entry.mutation.op == MutationOp::Create
                        && (draft.id == entry.mutation.id
                            || draft.parent_id == Some(entry.mutation.id)
                            || draft
                                .payload
                                .values()
                                .any(|v| references_id(v, entry.mutation.id)))
                    {
                        deps.push(entry.mutation.idempotency_key);
                    }
                }
            }
            deps.sort();
            deps.dedup();
            if deps.len() > 50 {
                return Err(invalid("too many dependencies"));
            }
            for key in &deps {
                let dead = all.iter().any(|e| {
                    e.mutation.idempotency_key == *key
                        && (matches!(e.state, OutboxState::Rejected | OutboxState::Quarantined)
                            || e.last_error.as_deref() == Some("SYNC_DEPENDENCY_FAILED"))
                }) || tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM outbox_settled WHERE key=?1 AND success=0)",
                    [key.to_string()],
                    |r| r.get::<_, bool>(0),
                )?;
                if dead {
                    return Err(invalid("dependency failed or cancelled"));
                }
                let known = all.iter().any(|e| e.mutation.idempotency_key == *key)
                    || tx.query_row(
                        "SELECT EXISTS(SELECT 1 FROM outbox_settled WHERE key=?1)",
                        [key.to_string()],
                        |r| r.get::<_, bool>(0),
                    )?;
                if !known {
                    return Err(invalid("unknown dependency"));
                }
            }
            // Only the last write to a row can coalesce, and only before its first send.
            let previous = all
                .iter()
                .filter(|e| e.mutation.resource == draft.resource && e.mutation.id == draft.id)
                .max_by_key(|e| e.seq);
            if draft.resolution.is_none()
                && let Some(old) = previous.filter(|e| {
                    e.state == OutboxState::Pending
                        && !e.sent
                        && e.mutation.resolution.is_none()
                        && e.mutation.parent_id == draft.parent_id
                })
            {
                let pair = (old.mutation.op, draft.op);
                if matches!(pair, (MutationOp::Create, MutationOp::Delete)) {
                    cancel(tx, old.mutation.idempotency_key, false)?;
                    return Ok(EnqueueOutcome::Cancelled(old.mutation.idempotency_key));
                }
                if matches!(
                    pair,
                    (MutationOp::Create, MutationOp::Update)
                        | (MutationOp::Update, MutationOp::Update)
                        | (MutationOp::Update, MutationOp::Delete)
                ) {
                    let mut merged = old.mutation.clone();
                    let old_key = merged.idempotency_key;
                    // A later independent prerequisite is valid; a path back is a cycle.
                    if deps.iter().any(|key| reaches(*key, old_key, &all)) {
                        return Err(invalid("coalescing would create a dependency cycle"));
                    }
                    let mut edges = merged.depends_on.take().unwrap_or_default();
                    edges.extend(deps);
                    edges.sort();
                    edges.dedup();
                    if edges.len() > 50 {
                        return Err(invalid("too many dependencies"));
                    }
                    merged.depends_on = (!edges.is_empty()).then_some(edges);
                    if draft.op == MutationOp::Delete {
                        merged.op = MutationOp::Delete;
                        merged.payload.clear();
                    } else {
                        merged.payload.extend(draft.payload);
                    }
                    merged.changed_fields = changed_fields(merged.op, &merged.payload);
                    tx.execute(
                        "UPDATE outbox_entries SET mutation=?1 WHERE key=?2",
                        params![serde_json::to_string(&merged)?, old_key.to_string()],
                    )?;
                    return Ok(EnqueueOutcome::Queued(old_key));
                }
            }
            let key = Uuid::now_v7();
            let mutation = Mutation {
                idempotency_key: key,
                op: draft.op,
                action: draft.action,
                resource: draft.resource,
                id: draft.id,
                parent_id: draft.parent_id,
                base_version: draft.base_version,
                changed_fields: changed_fields(draft.op, &draft.payload),
                occurred_at: draft.occurred_at,
                payload: draft.payload,
                depends_on: (!deps.is_empty()).then_some(deps),
                resolution: draft.resolution,
            };
            if let Some(resolution) = mutation.resolution {
                let old = all
                    .iter()
                    .find(|e| {
                        e.mutation.idempotency_key == resolution.resolves
                            && e.state == OutboxState::Conflict
                    })
                    .ok_or_else(|| invalid("resolution does not address an active conflict"))?;
                if old.mutation.id != mutation.id || old.mutation.resource != mutation.resource {
                    return Err(invalid("resolution target differs"));
                }
                crate::conflicts::validate_resolution(tx, &mutation)?;
                if mutation.depends_on.as_ref().is_some_and(|edges| {
                    edges
                        .iter()
                        .any(|dep| reaches(*dep, resolution.resolves, &all))
                }) {
                    return Err(invalid("resolution would create a dependency cycle"));
                }
                // Replace explicit edges before deleting the old entry. Never alter sent bodies.
                for entry in &all {
                    if entry.state == OutboxState::Pending && !entry.sent {
                        let mut rewritten = entry.mutation.clone();
                        if let Some(edges) = &mut rewritten.depends_on {
                            for edge in edges {
                                if *edge == resolution.resolves {
                                    *edge = key;
                                }
                            }
                        }
                        tx.execute(
                            "UPDATE outbox_entries SET mutation=?1 WHERE key=?2",
                            params![
                                serde_json::to_string(&rewritten)?,
                                rewritten.idempotency_key.to_string()
                            ],
                        )?;
                    }
                }
                cancel(tx, resolution.resolves, false)?;
                tx.execute(
                    "DELETE FROM conflict_records WHERE key=?1",
                    [resolution.resolves.to_string()],
                )?;
            }
            crate::conflicts::complete_draft(tx, &mutation)?;
            tx.execute(
                "INSERT INTO outbox_entries(key,mutation,state) VALUES (?1,?2,'pending')",
                params![key.to_string(), serde_json::to_string(&mutation)?],
            )?;
            Ok(EnqueueOutcome::Queued(key))
        })
    }

    fn next_batch(&self, max: usize) -> Result<Vec<Mutation>> {
        self.store.write(|tx| {
            let all = load(tx)?;
            let mut done = HashSet::new();
            let mut stmt = tx.prepare("SELECT key FROM outbox_settled WHERE success=1")?;
            for key in stmt.query_map([], |r| r.get::<_, String>(0))? {
                let key = key?;
                let key = Uuid::parse_str(&key).map_err(|_| invalid("invalid settled key"))?;
                done.insert(key);
            }
            let mut batch = Vec::new();
            // Emit only acknowledged prerequisites. A parent and its dependants use
            // successive batches so a conflict never leaks dependent writes to the server.
            for entry in &all {
                if batch.len() >= max.min(500) { break; }
                if entry.state != OutboxState::Pending || entry.last_error.as_deref() == Some("SYNC_DEPENDENCY_FAILED") { continue; }
                let deps = dependencies(entry, &all);
                if deps.iter().all(|key| done.contains(key)) {
                    tx.execute("UPDATE outbox_entries SET state='in_flight',sent=1 WHERE key=?1", [entry.mutation.idempotency_key.to_string()])?;
                    batch.push(entry.mutation.clone());
                } else {
                    let mut failed = false;
                    for key in &deps {
                        failed |= all.iter().any(|e| e.mutation.idempotency_key == *key && (matches!(e.state, OutboxState::Rejected | OutboxState::Quarantined) || e.last_error.as_deref() == Some("SYNC_DEPENDENCY_FAILED")));
                        failed |= tx.query_row("SELECT EXISTS(SELECT 1 FROM outbox_settled WHERE key=?1 AND success=0)", [key.to_string()], |r| r.get::<_, bool>(0))?;
                    }
                    if failed {
                        tx.execute("UPDATE outbox_entries SET last_error='SYNC_DEPENDENCY_FAILED' WHERE key=?1", [entry.mutation.idempotency_key.to_string()])?;
                    }
                }
            }
            Ok(batch)
        })
    }

    fn record_results(&self, results: &[PushResult]) -> Result<PushOutcome> {
        self.store.write(|tx| {
            let all = load(tx)?;
            let mut seen = HashSet::new();
            let mut outcome = PushOutcome::default();
            for result in results {
                if !seen.insert(result.idempotency_key) {
                    return Err(invalid("duplicate result key"));
                }
                let entry = all
                    .iter()
                    .find(|e| {
                        e.mutation.idempotency_key == result.idempotency_key
                            && e.state == OutboxState::InFlight
                    })
                    .ok_or_else(|| invalid("result is not in flight"))?;
                if entry.mutation.resource != result.resource || entry.mutation.id != result.id {
                    return Err(invalid("result target differs"));
                }
                match result.status {
                    PushStatus::Applied | PushStatus::Duplicate => {
                        cancel(tx, result.idempotency_key, true)?;
                        outcome.applied += 1;
                        outcome.results.push(result.clone());
                    }
                    PushStatus::Conflict => {
                        let conflict = result
                            .conflict
                            .clone()
                            .ok_or_else(|| invalid("missing conflict body"))?;
                        let detected_at = Timestamp(tx.query_row(
                            "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                            [],
                            |r| r.get(0),
                        )?);
                        persist_record(
                            tx,
                            &ConflictRecord {
                                idempotency_key: result.idempotency_key,
                                resource: result.resource.clone(),
                                id: result.id,
                                conflict,
                                local: entry.mutation.clone(),
                                detected_at,
                            },
                        )?;
                        tx.execute(
                            "UPDATE outbox_entries SET state='conflict' WHERE key=?1",
                            [result.idempotency_key.to_string()],
                        )?;
                        outcome.conflicts += 1;
                    }
                    PushStatus::Rejected => {
                        let error = result
                            .error
                            .as_ref()
                            .ok_or_else(|| invalid("missing rejection body"))?;
                        tx.execute(
                            "UPDATE outbox_entries SET state='rejected',last_error=?1 WHERE key=?2",
                            params![error.code.as_str(), result.idempotency_key.to_string()],
                        )?;
                        outcome.rejected += 1;
                    }
                }
            }
            Ok(outcome)
        })
    }

    /// Crash/transport recovery does not count mutation failures.
    fn requeue_in_flight(&self) -> Result<usize> {
        self.store.write(|tx| {
            Ok(tx.execute(
                "UPDATE outbox_entries SET state='pending' WHERE state='in_flight'",
                [],
            )?)
        })
    }
    /// Call only for a sent mutation that received a transient failure.
    fn transient_failure(&self, key: Uuid) -> Result<()> {
        self.store.write(|tx| {
            if tx.execute("UPDATE outbox_entries SET attempts=attempts+1,state=CASE WHEN attempts+1>=?1 THEN 'quarantined' ELSE 'pending' END,last_error='NETWORK_ERROR' WHERE key=?2 AND state='in_flight'", params![MAX_ATTEMPTS,key.to_string()])? != 1 { return Err(invalid("mutation is not in flight")); }
            Ok(())
        })
    }
    fn retry(&self, key: Uuid) -> Result<()> {
        self.store.write(|tx| {
            if tx.execute("UPDATE outbox_entries SET state='pending',attempts=0,last_error=NULL WHERE key=?1 AND state IN ('rejected','quarantined')", [key.to_string()])? != 1 { return Err(invalid("entry is not retryable")); }
            tx.execute("UPDATE outbox_entries SET last_error=NULL WHERE last_error='SYNC_DEPENDENCY_FAILED'", [])?;
            Ok(())
        })
    }
    fn discard(&self, key: Uuid) -> Result<()> {
        self.store.write(|tx| {
            let all = load(tx)?;
            if !all.iter().any(|e| e.mutation.idempotency_key == key && matches!(e.state, OutboxState::Rejected | OutboxState::Quarantined)) { return Err(invalid("entry is not discardable")); }
            for entry in &all {
                if entry.mutation.idempotency_key != key && reaches(entry.mutation.idempotency_key,key,&all) {
                    tx.execute("UPDATE outbox_entries SET last_error='SYNC_DEPENDENCY_FAILED' WHERE key=?1", [entry.mutation.idempotency_key.to_string()])?;
                }
            }
            cancel(tx,key,false)
        })
    }
    fn pending_count(&self) -> Result<usize> {
        self.store.read(|conn| {
            Ok(conn.query_row(
                "SELECT count(*) FROM outbox_entries WHERE state='pending'",
                [],
                |r| r.get::<_, i64>(0),
            )? as usize)
        })
    }
}

pub fn changed_fields(op: MutationOp, payload: &Map<String, Value>) -> Vec<String> {
    match op {
        MutationOp::Update | MutationOp::Action => {
            let mut keys: Vec<_> = payload.keys().cloned().collect();
            keys.sort();
            keys
        }
        MutationOp::Create | MutationOp::Delete => Vec::new(),
    }
}

pub(crate) fn remap_draft(conn: &Connection, draft: &mut NewMutation) -> Result<()> {
    let mut stmt = conn.prepare("SELECT old_id,new_id FROM outbox_id_remaps")?;
    let pairs = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for _ in 0..=pairs.len() {
        let before = draft.clone();
        for (old, new) in &pairs {
            let old = Uuid::parse_str(old).map_err(|_| invalid("invalid remap"))?;
            let new = Uuid::parse_str(new).map_err(|_| invalid("invalid remap"))?;
            if draft.id == old {
                draft.id = new;
            }
            if draft.parent_id == Some(old) {
                draft.parent_id = Some(new);
            }
            for value in draft.payload.values_mut() {
                crate::conflicts::replace_id(value, old, new);
            }
        }
        if *draft == before {
            return Ok(());
        }
    }
    Err(invalid("identity remap cycle"))
}
pub(crate) fn references_id(value: &Value, id: Uuid) -> bool {
    match value {
        Value::String(text) => Uuid::parse_str(text).ok() == Some(id),
        Value::Array(values) => values.iter().any(|v| references_id(v, id)),
        Value::Object(values) => values.values().any(|v| references_id(v, id)),
        _ => false,
    }
}
