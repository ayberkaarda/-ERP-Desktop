//! Durable conflict decisions. Writes are returned for the caller to enqueue.

use std::sync::Arc;

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::error::Result;
use crate::outbox::{NewMutation, cancel, ensure_unsealed, invalid};
use crate::store::{Migration, Store};
use crate::wire::{
    Conflict, ConflictChoice, ConflictCode, Mutation, MutationOp, Resolution, ResolutionChoice,
    ResolutionCode, ResourceName, ResourceRow, Timestamp,
};

pub const MIGRATIONS: &[Migration] = &[Migration {
    id: 200,
    module: "conflicts",
    name: "conflict_inbox",
    sql: "CREATE TABLE conflict_records (key TEXT PRIMARY KEY, record TEXT NOT NULL) STRICT;
    CREATE TABLE conflict_draft_resolutions (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE REFERENCES conflict_records(key) ON DELETE CASCADE
    ) STRICT;",
}];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConflictRecord {
    pub idempotency_key: Uuid,
    pub resource: ResourceName,
    pub id: Uuid,
    pub conflict: Conflict,
    pub local: Mutation,
    pub detected_at: Timestamp,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ResolutionAction {
    /// Enqueue atomically retires the original conflict for resolution writes.
    Enqueue(NewMutation),
    /// The server's answer as recorded with the conflict (`None`: deleted on
    /// the server). It is already applied to the mirror in the resolving
    /// transaction, version-checked: it never rolls a newer row back and
    /// never brings a removed row back. Callers must not write it to the
    /// mirror themselves; read the row back for the current state.
    TakeServer(Option<ResourceRow>),
    /// Bind the local draft to this selected existing row; fetch its mirror data.
    UseExisting(Uuid),
    Discard,
}

pub trait ConflictInbox {
    fn record(&self, record: ConflictRecord) -> Result<()>;
    fn list(&self) -> Result<Vec<ConflictRecord>>;
    fn count(&self) -> Result<usize>;
    fn resolve(&self, idempotency_key: Uuid, choice: ConflictChoice) -> Result<ResolutionAction>;
    fn resolve_use_existing(&self, key: Uuid, candidate: Uuid) -> Result<ResolutionAction>;
    /// Merge always requires the user's explicit field-level result.
    fn resolve_merge(
        &self,
        idempotency_key: Uuid,
        merged_payload: Map<String, Value>,
    ) -> Result<ResolutionAction>;
}

#[derive(Debug, Clone)]
pub struct ConflictStore {
    store: Arc<Store>,
}
impl ConflictStore {
    pub fn new(store: Arc<Store>) -> Self {
        Self { store }
    }
    pub fn store(&self) -> &Arc<Store> {
        &self.store
    }

    fn decide(
        &self,
        key: Uuid,
        choice: ConflictChoice,
        merged: Option<Map<String, Value>>,
    ) -> Result<ResolutionAction> {
        self.store.write(|tx| {
            ensure_unsealed(tx)?;
            let record = get(tx, key)?;
            if !allowed_choices(record.conflict.code).contains(&choice)
                || !record.conflict.choices.contains(&choice)
            {
                return Err(invalid("choice is not offered by this conflict"));
            }
            let local = &record.local;
            let mut draft = NewMutation {
                op: local.op,
                action: local.action.clone(),
                resource: local.resource.clone(),
                id: local.id,
                parent_id: local.parent_id,
                base_version: local.base_version,
                payload: local.payload.clone(),
                depends_on: local
                    .depends_on
                    .clone()
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|dep| *dep != key)
                    .collect(),
                occurred_at: Timestamp(tx.query_row(
                    "SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                    [],
                    |r| r.get(0),
                )?),
                resolution: None,
            };
            match choice {
                ConflictChoice::KeepMine | ConflictChoice::Merge => {
                    let code = match record.conflict.code {
                        ConflictCode::VersionConflict => {
                            draft.base_version = Some(
                                record
                                    .conflict
                                    .server_version
                                    .ok_or_else(|| invalid("missing server version"))?,
                            );
                            ResolutionCode::VersionConflict
                        }
                        ConflictCode::DuplicateRecord => ResolutionCode::DuplicateRecord,
                        ConflictCode::DocumentLocked => {
                            return Err(invalid("locked document cannot be overwritten"));
                        }
                    };
                    let wire_choice = if choice == ConflictChoice::Merge {
                        if local.op != MutationOp::Update {
                            return Err(invalid("merge requires update"));
                        }
                        let payload =
                            merged.ok_or_else(|| invalid("merge requires an explicit payload"))?;
                        if payload.is_empty() || payload.contains_key("version") {
                            return Err(invalid("invalid merged payload"));
                        }
                        draft.payload = payload;
                        ResolutionChoice::Merge
                    } else {
                        ResolutionChoice::KeepMine
                    };
                    draft.resolution = Some(Resolution {
                        resolves: key,
                        code,
                        choice: wire_choice,
                    });
                    // Keep the record until enqueue succeeds, so cancellation/crash is retryable.
                    Ok(ResolutionAction::Enqueue(draft))
                }
                ConflictChoice::SaveAsNewDraft => {
                    let reserved: Option<String> = tx
                        .query_row(
                            "SELECT id FROM conflict_draft_resolutions WHERE key=?1",
                            [key.to_string()],
                            |r| r.get(0),
                        )
                        .optional()?;
                    draft.id = match reserved {
                        Some(id) => Uuid::parse_str(&id)
                            .map_err(|_| invalid("invalid reserved draft id"))?,
                        None => Uuid::now_v7(),
                    };
                    draft.op = MutationOp::Create;
                    draft.action = None;
                    draft.base_version = None;
                    // Preserve server fields absent from a partial local update.
                    let mut payload = record
                        .conflict
                        .server_data
                        .as_ref()
                        .map(|r| r.fields.clone())
                        .unwrap_or_default();
                    payload.extend(draft.payload);
                    for field in [
                        "id",
                        "version",
                        "number",
                        "status",
                        "created_at",
                        "updated_at",
                        "sync_txid",
                    ] {
                        payload.remove(field);
                    }

                    draft.payload = payload;
                    tx.execute(
                        "INSERT OR IGNORE INTO conflict_draft_resolutions(id,key) VALUES (?1,?2)",
                        params![draft.id.to_string(), key.to_string()],
                    )?;
                    Ok(ResolutionAction::Enqueue(draft))
                }
                ConflictChoice::UseExisting => {
                    let candidates = record.conflict.candidates.as_deref().unwrap_or_default();
                    if candidates.len() != 1 {
                        return Err(invalid("select an existing candidate explicitly"));
                    }
                    use_existing(tx, &record, candidates[0])
                }
                ConflictChoice::TakeServer | ConflictChoice::Discard => {
                    if choice == ConflictChoice::TakeServer {
                        release_edges(tx, key, None)?;
                    }
                    cancel(tx, key, choice == ConflictChoice::TakeServer)?;
                    tx.execute(
                        "DELETE FROM conflict_records WHERE key=?1",
                        [key.to_string()],
                    )?;
                    if choice == ConflictChoice::Discard {
                        Ok(ResolutionAction::Discard)
                    } else {
                        Store::take_server_on(
                            tx,
                            &record.resource,
                            record.id,
                            record.conflict.server_data.as_ref(),
                            record.conflict.server_version,
                        )?;
                        Ok(ResolutionAction::TakeServer(record.conflict.server_data))
                    }
                }
            }
        })
    }
}

/// Inside the caller's write transaction: removes every conflict record
/// and reserved draft id (sign-out and account wipes). Returns the number
/// of records removed.
pub fn clear_on(tx: &Connection) -> Result<usize> {
    tx.execute("DELETE FROM conflict_draft_resolutions", [])?;
    Ok(tx.execute("DELETE FROM conflict_records", [])?)
}

pub(crate) fn complete_draft(tx: &Transaction<'_>, mutation: &Mutation) -> Result<()> {
    let old: Option<String> = tx
        .query_row(
            "SELECT key FROM conflict_draft_resolutions WHERE id=?1",
            [mutation.id.to_string()],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(old) = old {
        let key = Uuid::parse_str(&old).map_err(|_| invalid("invalid draft conflict key"))?;
        let record = get(tx, key)?;
        if mutation.op != MutationOp::Create
            || mutation.resource != record.resource
            || mutation.resolution.is_some()
        {
            return Err(invalid("invalid new draft target"));
        }
        release_edges_to(
            tx,
            key,
            Some((record.id, mutation.id)),
            Some(mutation.idempotency_key),
        )?;
        cancel(tx, key, true)?;
        tx.execute("DELETE FROM conflict_records WHERE key=?1", [old])?;
    }
    Ok(())
}

// Sent bodies remain immutable; all unsent identity references follow replacements.
fn release_edges(tx: &Transaction<'_>, key: Uuid, replacement: Option<(Uuid, Uuid)>) -> Result<()> {
    release_edges_to(tx, key, replacement, None)
}

fn release_edges_to(
    tx: &Transaction<'_>,
    key: Uuid,
    replacement: Option<(Uuid, Uuid)>,
    prerequisite: Option<Uuid>,
) -> Result<()> {
    if let Some((old, new)) = replacement {
        // Resolve the destination before insertion to reject alias cycles atomically.
        let mut probe = NewMutation {
            op: MutationOp::Create,
            action: None,
            resource: get(tx, key)?.resource,
            id: new,
            parent_id: None,
            base_version: None,
            payload: Map::new(),
            depends_on: vec![],
            occurred_at: Timestamp(String::new()),
            resolution: None,
        };
        crate::outbox::remap_draft(tx, &mut probe)?;
        if probe.id == old {
            return Err(invalid("identity remap cycle"));
        }
        tx.execute(
            "INSERT INTO outbox_id_remaps(old_id,new_id) VALUES (?1,?2)",
            params![old.to_string(), probe.id.to_string()],
        )?;
    }
    if let Some(new_key) = prerequisite {
        tx.execute(
            "INSERT INTO outbox_key_remaps(old_key,new_key) VALUES (?1,?2)",
            params![key.to_string(), new_key.to_string()],
        )?;
    }
    let entries = crate::outbox::load(tx)?;
    for entry in entries {
        if entry.sent || entry.state != crate::outbox::OutboxState::Pending {
            continue;
        }
        let mut mutation = entry.mutation;
        let explicit = mutation
            .depends_on
            .as_ref()
            .is_some_and(|edges| edges.contains(&key));
        let identity = replacement.is_some_and(|(old, _)| {
            mutation.id == old
                || mutation.parent_id == Some(old)
                || mutation
                    .payload
                    .values()
                    .any(|v| crate::outbox::references_id(v, old))
        });
        if let Some((old, new)) = replacement {
            if mutation.id == old {
                mutation.id = new;
            }
            if mutation.parent_id == Some(old) {
                mutation.parent_id = Some(new);
            }
            for value in mutation.payload.values_mut() {
                replace_id(value, old, new);
            }
        }
        if let Some(edges) = &mut mutation.depends_on {
            edges.retain(|dep| *dep != key);
        }
        if let Some(new_key) = prerequisite
            && (explicit || identity)
        {
            mutation
                .depends_on
                .get_or_insert_with(Vec::new)
                .push(new_key);
        }
        if mutation
            .depends_on
            .as_ref()
            .is_some_and(|edges| edges.is_empty())
        {
            mutation.depends_on = None;
        }
        tx.execute("UPDATE outbox_entries SET mutation=?1,last_error=CASE WHEN ?3 THEN NULL ELSE last_error END WHERE key=?2",
            params![serde_json::to_string(&mutation)?,mutation.idempotency_key.to_string(),explicit || identity])?;
    }
    Ok(())
}

pub(crate) fn replace_id(value: &mut Value, old: Uuid, new: Uuid) {
    match value {
        Value::String(text) if Uuid::parse_str(text).ok() == Some(old) => *text = new.to_string(),
        Value::Array(values) => {
            for value in values {
                replace_id(value, old, new);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                replace_id(value, old, new);
            }
        }
        _ => {}
    }
}

fn use_existing(
    tx: &Transaction<'_>,
    record: &ConflictRecord,
    candidate: Uuid,
) -> Result<ResolutionAction> {
    if record.conflict.code != ConflictCode::DuplicateRecord
        || !record
            .conflict
            .choices
            .contains(&ConflictChoice::UseExisting)
        || !record
            .conflict
            .candidates
            .as_ref()
            .is_some_and(|ids| ids.contains(&candidate))
    {
        return Err(invalid("candidate is not offered by this conflict"));
    }
    release_edges(tx, record.idempotency_key, Some((record.id, candidate)))?;
    cancel(tx, record.idempotency_key, true)?;
    tx.execute(
        "DELETE FROM conflict_records WHERE key=?1",
        [record.idempotency_key.to_string()],
    )?;
    Ok(ResolutionAction::UseExisting(candidate))
}

pub(crate) fn persist_record(tx: &Transaction<'_>, record: &ConflictRecord) -> Result<()> {
    if record.idempotency_key != record.local.idempotency_key
        || record.id != record.local.id
        || record.resource != record.local.resource
    {
        return Err(invalid("conflict and local target differ"));
    }
    tx.execute("INSERT INTO conflict_records(key,record) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET record=excluded.record", params![record.idempotency_key.to_string(), serde_json::to_string(record)?])?;
    Ok(())
}

fn get(conn: &Connection, key: Uuid) -> Result<ConflictRecord> {
    let json: String = conn.query_row(
        "SELECT record FROM conflict_records WHERE key=?1",
        [key.to_string()],
        |r| r.get(0),
    )?;
    Ok(serde_json::from_str(&json)?)
}

pub(crate) fn validate_resolution(conn: &Connection, mutation: &Mutation) -> Result<()> {
    let resolution = mutation
        .resolution
        .ok_or_else(|| invalid("missing resolution"))?;
    let record = get(conn, resolution.resolves)?;
    let expected = match record.conflict.code {
        ConflictCode::VersionConflict => ResolutionCode::VersionConflict,
        ConflictCode::DuplicateRecord => ResolutionCode::DuplicateRecord,
        ConflictCode::DocumentLocked => {
            return Err(invalid("locked document has no wire resolution"));
        }
    };
    let choice = match resolution.choice {
        ResolutionChoice::KeepMine => ConflictChoice::KeepMine,
        ResolutionChoice::Merge => ConflictChoice::Merge,
    };
    if expected != resolution.code
        || !record.conflict.choices.contains(&choice)
        || (expected == ResolutionCode::DuplicateRecord && choice != ConflictChoice::KeepMine)
        || (expected == ResolutionCode::VersionConflict
            && mutation.base_version != record.conflict.server_version)
        || (choice == ConflictChoice::KeepMine
            && (mutation.payload != record.local.payload
                || mutation.op != record.local.op
                || mutation.action != record.local.action
                || mutation.parent_id != record.local.parent_id))
        || (choice == ConflictChoice::Merge && mutation.op != MutationOp::Update)
    {
        return Err(invalid("invalid conflict resolution"));
    }
    Ok(())
}

impl ConflictInbox for ConflictStore {
    fn record(&self, record: ConflictRecord) -> Result<()> {
        self.store.write(|tx| persist_record(tx, &record))
    }
    fn list(&self) -> Result<Vec<ConflictRecord>> {
        self.store.read(|conn| {
            ensure_unsealed(conn)?;
            let mut stmt = conn.prepare("SELECT record FROM conflict_records ORDER BY julianday(json_extract(record,'$.detected_at')), key")?;
            let mut records = Vec::new();
            for row in stmt.query_map([], |r| r.get::<_, String>(0))? { records.push(serde_json::from_str(&row?)?); }
            Ok(records)
        })
    }
    fn count(&self) -> Result<usize> {
        self.store.read(|conn| {
            Ok(
                conn.query_row("SELECT count(*) FROM conflict_records", [], |r| {
                    r.get::<_, i64>(0)
                })? as usize,
            )
        })
    }
    fn resolve(&self, key: Uuid, choice: ConflictChoice) -> Result<ResolutionAction> {
        self.decide(key, choice, None)
    }
    fn resolve_use_existing(&self, key: Uuid, candidate: Uuid) -> Result<ResolutionAction> {
        self.store.write(|tx| {
            ensure_unsealed(tx)?;
            use_existing(tx, &get(tx, key)?, candidate)
        })
    }
    fn resolve_merge(
        &self,
        key: Uuid,
        merged_payload: Map<String, Value>,
    ) -> Result<ResolutionAction> {
        self.decide(key, ConflictChoice::Merge, Some(merged_payload))
    }
}

pub const fn allowed_choices(code: ConflictCode) -> &'static [ConflictChoice] {
    match code {
        ConflictCode::VersionConflict => &[
            ConflictChoice::KeepMine,
            ConflictChoice::TakeServer,
            ConflictChoice::Merge,
        ],
        ConflictCode::DocumentLocked => &[ConflictChoice::SaveAsNewDraft, ConflictChoice::Discard],
        ConflictCode::DuplicateRecord => &[
            ConflictChoice::UseExisting,
            ConflictChoice::KeepMine,
            ConflictChoice::Discard,
        ],
    }
}
