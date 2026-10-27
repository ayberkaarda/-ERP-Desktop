//! Generic mirror: one table per resource, `data` holds the API Resource JSON.
//!
//! Layout of a resource registered as `parties` (all names used quoted):
//! - `m_parties(k INTEGER PRIMARY KEY, id TEXT UNIQUE, version, data)`, plus
//!   one `f_<field>` `GENERATED ALWAYS AS (json_extract(data, '$.<field>'))
//!   VIRTUAL` column and `m_parties#f_<field>` index per indexed field;
//! - `m_parties#fts`, FTS5 (`unicode61 remove_diacritics 2`) over the folded
//!   search fields, `rowid` = `m_parties.k`;
//! - its rows in `store_resources` (spec JSON), `store_cursors` and
//!   `store_epochs` (bumped by every local reset).

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;
use uuid::Uuid;

use super::Store;
use super::fold::fold;
use super::retention;
use super::spec::{
    ResourceSpec, column_name, fts_name, index_name, invalid, json_path, table_name,
    validate_resource,
};
use crate::error::Result;
use crate::wire::{Cursor, PullResourceResult, ResourceName, ResourceRow, Timestamp};

/// Counts for one applied pull page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AppliedPage {
    pub upserted: usize,
    pub removed: usize,
    /// The local copy was dropped first: `reset` from the server, or the
    /// first page of a full download (base without a cursor).
    pub reset: bool,
}

/// What a pull request for one resource was built from. Take it with
/// [`MirrorStore::pull_base`] right before building the request and hand it
/// back to [`MirrorStore::apply_page`] with the response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullBase {
    /// Cursor sent in the request; `None` asks for a full download.
    pub cursor: Option<Cursor>,
    /// Local reset counter of the resource.
    pub epoch: u64,
}

/// Result of [`MirrorStore::apply_page`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageApply {
    Applied(AppliedPage),
    /// The resource moved since the request was built (another page was
    /// applied, or it was reset locally). Nothing was written; pull again
    /// from a fresh [`PullBase`].
    Stale,
}

/// Sync position of one resource.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceState {
    pub cursor: Cursor,
    /// `false` while a full download is still paging (`has_more`): the local
    /// copy is partial (see [`super::LocalCopy`]).
    pub complete: bool,
    /// UTC time of the last applied page, `YYYY-MM-DDTHH:MM:SS.SSSZ`.
    pub synced_at: String,
}

/// A `source: snapshot` resource as last fetched from its REST endpoint.
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub data: Value,
    /// Shown as "as of" when served offline.
    pub fetched_at: Timestamp,
}

/// Local copy of pulled resources. Implemented by [`Store`].
///
/// Callback rule (see [`Store::read`]): do not call these from inside a store
/// `read`/`write` callback, and never let such a callback wait on another
/// store call, on the same thread or another one. Same-thread nesting fails
/// fast; cross-thread waits fail after the lock timeout.
pub trait MirrorStore {
    /// Stored cursor of `resource`; `None` before its first page.
    fn cursor(&self, resource: &ResourceName) -> Result<Option<Cursor>>;

    /// Cursor and reset epoch to build the next pull request from.
    fn pull_base(&self, resource: &ResourceName) -> Result<PullBase>;

    /// Applies one page in a single transaction, only if the resource is
    /// still at `base` (checked in the same transaction): drops the local
    /// copy when `reset` or `base.cursor` is `None`, upserts `rows`, removes
    /// `tombstones`, stores `next_cursor`. Otherwise returns `Stale`.
    fn apply_page(&self, page: &PullResourceResult, base: &PullBase) -> Result<PageApply>;

    /// Replaces one row, e.g. with `data` of an applied push result.
    fn put_row(&self, resource: &ResourceName, row: &ResourceRow) -> Result<()>;

    fn get_row(&self, resource: &ResourceName, id: Uuid) -> Result<Option<ResourceRow>>;

    fn remove_row(&self, resource: &ResourceName, id: Uuid) -> Result<bool>;
}

impl MirrorStore for Store {
    fn cursor(&self, resource: &ResourceName) -> Result<Option<Cursor>> {
        Ok(self.resource_state(resource)?.map(|s| s.cursor))
    }

    fn pull_base(&self, resource: &ResourceName) -> Result<PullBase> {
        self.read(|conn| read_snapshot(conn, |c| base_in(c, resource)))
    }

    /// Rows are applied before tombstones.
    fn apply_page(&self, page: &PullResourceResult, base: &PullBase) -> Result<PageApply> {
        let policy = self.retention();
        self.write(|tx| {
            if base_in(tx, &page.resource)? != *base {
                return Ok(PageApply::Stale);
            }
            let reg = ensure(tx, &page.resource)?;
            let prior = state_in(tx, &page.resource)?;
            let full_start = page.reset || base.cursor.is_none();
            if full_start {
                clear(tx, &reg)?;
            }
            let mut upserted = 0;
            for row in &page.rows {
                // A push answer may have advanced the row past this page on
                // the same base: an older version is skipped. Only a full
                // start replaces rows wholesale.
                if !full_start
                    && let Some(incoming) = row.version
                    && Self::get_row_on(tx, &page.resource, row.id)?
                        .and_then(|local| local.version)
                        .is_some_and(|known| incoming < known)
                {
                    continue;
                }
                upsert(tx, &reg, row)?;
                upserted += 1;
            }
            let mut removed = 0;
            for tombstone in &page.tombstones {
                let target = if tombstone.resource == page.resource {
                    Some(reg.clone())
                } else {
                    lookup(tx, &tombstone.resource)?
                };
                if let Some(target) = target
                    && delete(tx, &target, tombstone.id)?
                {
                    removed += 1;
                }
            }
            let complete = if full_start {
                !page.has_more
            } else {
                prior.is_some_and(|p| p.complete) || !page.has_more
            };
            save_cursor(tx, &page.resource, &page.next_cursor, complete)?;
            retention::count_writes(tx, page.rows.len() + page.tombstones.len(), &policy)?;
            Ok(PageApply::Applied(AppliedPage {
                upserted,
                removed,
                reset: full_start,
            }))
        })
    }

    fn put_row(&self, resource: &ResourceName, row: &ResourceRow) -> Result<()> {
        let policy = self.retention();
        self.write(|tx| {
            let reg = ensure(tx, resource)?;
            upsert(tx, &reg, row)?;
            retention::count_writes(tx, 1, &policy)
        })
    }

    fn get_row(&self, resource: &ResourceName, id: Uuid) -> Result<Option<ResourceRow>> {
        self.read(|conn| Store::get_row_on(conn, resource, id))
    }

    fn remove_row(&self, resource: &ResourceName, id: Uuid) -> Result<bool> {
        let policy = self.retention();
        self.write(|tx| {
            let Some(reg) = lookup(tx, resource)? else {
                return Ok(false);
            };
            let removed = delete(tx, &reg, id)?;
            retention::count_writes(tx, 1, &policy)?;
            Ok(removed)
        })
    }
}

/// Mirror administration and snapshots (internal API for the engine and the
/// D3 offline router).
impl Store {
    /// Tracks the local create separately from confirmed mirror rows, atomically
    /// with its outbox entry. Resets and tombstones invalidate this presence.
    pub(crate) fn seed_draft_on(tx: &Connection, resource: &ResourceName, id: Uuid) -> Result<()> {
        ensure(tx, resource)?;
        if Self::get_row_on(tx, resource, id)?.is_none() {
            tx.execute(
                "INSERT OR IGNORE INTO store_local_creates(resource, id) VALUES (?1, ?2)",
                params![resource.as_str(), id.to_string()],
            )?;
        }
        Ok(())
    }

    pub(crate) fn remove_draft_on(
        tx: &Connection,
        resource: &ResourceName,
        id: Uuid,
    ) -> Result<()> {
        tx.execute(
            "DELETE FROM store_local_creates WHERE resource=?1 AND id=?2",
            params![resource.as_str(), id.to_string()],
        )?;
        Ok(())
    }

    /// Applies a `take_server` answer inside the resolving transaction: a
    /// newer server row replaces the local one, a server delete removes it
    /// when the local row is not newer, and an absent row stays absent.
    /// Returns whether the mirror changed.
    pub(crate) fn take_server_on(
        tx: &Connection,
        resource: &ResourceName,
        id: Uuid,
        row: Option<&ResourceRow>,
        server_version: Option<u64>,
    ) -> Result<bool> {
        let Some(local) = Self::get_row_on(tx, resource, id)? else {
            return Ok(false);
        };
        let Some(reg) = lookup(tx, resource)? else {
            return Ok(false);
        };
        Ok(match row {
            Some(row)
                if row.id == id
                    && row.version.is_some_and(|version| {
                        local.version.is_some_and(|known| version > known)
                    }) =>
            {
                upsert(tx, &reg, row)?;
                true
            }
            None if server_version
                .is_some_and(|version| local.version.is_some_and(|known| known <= version)) =>
            {
                delete(tx, &reg, id)?
            }
            _ => false,
        })
    }

    /// Push answers may advance existing rows, but cannot resurrect absent rows.
    pub fn put_push_row(&self, resource: &ResourceName, row: &ResourceRow) -> Result<bool> {
        let policy = self.retention();
        self.write(|tx| {
            let Some(version) = row.version else {
                return Ok(false);
            };
            match Self::get_row_on(tx, resource, row.id)? {
                Some(local) if local.version.is_some_and(|known| known < version) => {}
                None if version > 0 && tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM store_local_creates WHERE resource=?1 AND id=?2)",
                    params![resource.as_str(), row.id.to_string()], |r| r.get::<_, bool>(0),
                )? => {}
                _ => return Ok(false),
            }
            let reg = ensure(tx, resource)?;
            upsert(tx, &reg, row)?;
            retention::count_writes(tx, 1, &policy)?;
            Ok(true)
        })
    }

    /// A delete answer cannot remove a row newer than the mutation's base.
    pub fn remove_push_row(
        &self,
        resource: &ResourceName,
        id: Uuid,
        base_version: Option<u64>,
    ) -> Result<bool> {
        let policy = self.retention();
        self.write(|tx| {
            let Some(base) = base_version else {
                return Ok(false);
            };
            let Some(local) = Self::get_row_on(tx, resource, id)? else {
                return Ok(false);
            };
            if !local.version.is_some_and(|known| known <= base) {
                return Ok(false);
            }
            let Some(reg) = lookup(tx, resource)? else {
                return Ok(false);
            };
            let removed = delete(tx, &reg, id)?;
            retention::count_writes(tx, usize::from(removed), &policy)?;
            Ok(removed)
        })
    }
    /// [`MirrorStore::get_row`] on a connection the caller already holds
    /// (inside a [`Store::read`] or [`Store::write`] callback, where calling
    /// back into the store is rejected).
    pub fn get_row_on(
        conn: &Connection,
        resource: &ResourceName,
        id: Uuid,
    ) -> Result<Option<ResourceRow>> {
        read_snapshot(conn, |conn| {
            let Some(reg) = lookup(conn, resource)? else {
                return Ok(None);
            };
            let data: Option<String> = conn
                .query_row(
                    &format!("SELECT data FROM \"{}\" WHERE id = ?1", reg.table),
                    [id.to_string()],
                    |r| r.get(0),
                )
                .optional()?;
            data.map(|d| decode_row(&d)).transpose()
        })
    }

    /// Creates or updates the tables of `spec`: adds missing generated
    /// columns and indexes, drops those no longer listed, (re)builds the FTS
    /// table when the search fields change. Rows are kept.
    pub fn register(&self, spec: &ResourceSpec) -> Result<()> {
        self.write(|tx| register_in(tx, spec).map(|_| ()))
    }

    /// [`Store::register`] for many specs in one transaction.
    pub fn register_all(&self, specs: &[ResourceSpec]) -> Result<()> {
        self.write(|tx| {
            for spec in specs {
                register_in(tx, spec)?;
            }
            Ok(())
        })
    }

    pub fn resource_spec(&self, resource: &ResourceName) -> Result<Option<ResourceSpec>> {
        self.read(|conn| Ok(lookup(conn, resource)?.map(|r| r.spec)))
    }

    /// Every registered spec, by resource name.
    pub fn resource_specs(&self) -> Result<Vec<ResourceSpec>> {
        self.read(|conn| {
            let mut stmt = conn.prepare("SELECT spec FROM store_resources ORDER BY resource")?;
            let specs = stmt
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            specs.iter().map(|s| Ok(serde_json::from_str(s)?)).collect()
        })
    }

    /// Row table name, `None` when the resource is not registered.
    pub fn mirror_table(&self, resource: &ResourceName) -> Result<Option<String>> {
        self.read(|conn| Ok(lookup(conn, resource)?.map(|r| r.table)))
    }

    pub fn resource_state(&self, resource: &ResourceName) -> Result<Option<ResourceState>> {
        self.read(|conn| state_in(conn, resource))
    }

    /// Drops the rows and the cursor of `resource`, so the next pull is a
    /// full download. Returns the number of rows removed.
    /// Pages requested before this call come back `Stale` (the epoch moves).
    pub fn reset_resource(&self, resource: &ResourceName) -> Result<usize> {
        self.write(|tx| {
            tx.execute(
                "DELETE FROM store_cursors WHERE resource = ?1",
                [resource.as_str()],
            )?;
            tx.execute(
                "INSERT INTO store_epochs (resource, epoch) VALUES (?1, 1)
                 ON CONFLICT(resource) DO UPDATE SET epoch = epoch + 1",
                [resource.as_str()],
            )?;
            match lookup(tx, resource)? {
                Some(reg) => clear(tx, &reg),
                None => Ok(0),
            }
        })
    }

    /// Number of local rows of `resource`.
    pub fn row_count(&self, resource: &ResourceName) -> Result<u64> {
        self.read(|conn| {
            read_snapshot(conn, |conn| match lookup(conn, resource)? {
                Some(reg) => {
                    let n: i64 = conn.query_row(
                        &format!("SELECT count(*) FROM \"{}\"", reg.table),
                        [],
                        |r| r.get(0),
                    )?;
                    Ok(u64::try_from(n).unwrap_or(0))
                }
                None => Ok(0),
            })
        })
    }

    /// Stores the latest snapshot of a `source: snapshot` resource.
    pub fn put_snapshot(
        &self,
        resource: &ResourceName,
        data: &Value,
        fetched_at: &Timestamp,
    ) -> Result<()> {
        validate_resource(resource)?;
        let text = serde_json::to_string(data)?;
        self.write(|tx| {
            tx.execute(
                "INSERT INTO store_snapshots (resource, data, fetched_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(resource) DO UPDATE SET data = excluded.data,
                     fetched_at = excluded.fetched_at",
                params![resource.as_str(), text, fetched_at.0],
            )?;
            Ok(())
        })
    }

    /// Removes the stored snapshot of `resource`; `true` when one existed.
    pub fn remove_snapshot(&self, resource: &ResourceName) -> Result<bool> {
        self.write(|tx| {
            Ok(tx.execute(
                "DELETE FROM store_snapshots WHERE resource = ?1",
                [resource.as_str()],
            )? > 0)
        })
    }

    /// Resources that have a stored snapshot, by name.
    pub fn snapshot_resources(&self) -> Result<Vec<ResourceName>> {
        self.read(|conn| {
            let mut stmt =
                conn.prepare("SELECT resource FROM store_snapshots ORDER BY resource")?;
            let names = stmt
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(names.into_iter().map(ResourceName).collect())
        })
    }

    /// Inside the caller's write transaction: drops every mirror row, cursor
    /// and snapshot, and bumps the epoch of every registered resource (pages
    /// requested before come back `Stale`). Registered specs stay. Returns
    /// the registered resources. Used for sign-out and account wipes.
    pub fn clear_mirror_on(tx: &Connection) -> Result<Vec<ResourceName>> {
        let registered = all_registered(tx)?;
        for reg in &registered {
            clear(tx, reg)?;
        }
        tx.execute_batch(
            "DELETE FROM store_cursors;
             DELETE FROM store_snapshots;
             INSERT INTO store_epochs (resource, epoch)
                 SELECT resource, 1 FROM store_resources WHERE true
                 ON CONFLICT(resource) DO UPDATE SET epoch = epoch + 1;",
        )?;
        Ok(registered.into_iter().map(|r| r.spec.resource).collect())
    }

    pub fn snapshot(&self, resource: &ResourceName) -> Result<Option<Snapshot>> {
        self.read(|conn| {
            let row: Option<(String, String)> = conn
                .query_row(
                    "SELECT data, fetched_at FROM store_snapshots WHERE resource = ?1",
                    [resource.as_str()],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            row.map(|(data, fetched_at)| {
                Ok(Snapshot {
                    data: serde_json::from_str(&data)?,
                    fetched_at: Timestamp(fetched_at),
                })
            })
            .transpose()
        })
    }
}

/// A registered resource as stored in `store_resources`.
#[derive(Debug, Clone)]
pub(crate) struct Registered {
    pub table: String,
    /// FTS table, when the spec has search fields.
    pub fts: Option<String>,
    pub spec: ResourceSpec,
}

pub(crate) fn lookup(conn: &Connection, resource: &ResourceName) -> Result<Option<Registered>> {
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT table_name, spec FROM store_resources WHERE resource = ?1",
            [resource.as_str()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    row.map(|(table, spec)| {
        let spec: ResourceSpec = serde_json::from_str(&spec)?;
        Ok(Registered {
            fts: (!spec.search.is_empty()).then(|| fts_name(&table)),
            table,
            spec,
        })
    })
    .transpose()
}

pub(crate) fn all_registered(conn: &Connection) -> Result<Vec<Registered>> {
    let mut stmt = conn.prepare("SELECT resource FROM store_resources ORDER BY resource")?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut out = Vec::with_capacity(names.len());
    for name in names {
        if let Some(reg) = lookup(conn, &ResourceName(name))? {
            out.push(reg);
        }
    }
    Ok(out)
}

/// Registered entry of `resource`, registering master-data defaults first
/// when the resource is new (pages may arrive before the manifest is read).
fn ensure(tx: &Connection, resource: &ResourceName) -> Result<Registered> {
    match lookup(tx, resource)? {
        Some(reg) => Ok(reg),
        None => register_in(tx, &ResourceSpec::new(resource.clone())),
    }
}

fn register_in(tx: &Connection, spec: &ResourceSpec) -> Result<Registered> {
    spec.validate()?;
    let previous = lookup(tx, &spec.resource)?;
    let table = match &previous {
        Some(reg) => reg.table.clone(),
        None => {
            let table = table_name(&spec.resource);
            let taken: Option<String> = tx
                .query_row(
                    "SELECT resource FROM store_resources WHERE table_name = ?1",
                    [&table],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(other) = taken {
                return Err(invalid(format!(
                    "{} maps to table {table}, already used by {other}",
                    spec.resource
                )));
            }
            table
        }
    };

    tx.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS \"{table}\" (
            k INTEGER PRIMARY KEY,
            id TEXT NOT NULL UNIQUE,
            version INTEGER,
            data TEXT NOT NULL
        );"
    ))?;

    let existing: Vec<String> = {
        let mut stmt =
            tx.prepare("SELECT name FROM pragma_table_xinfo(?1) WHERE substr(name, 1, 2) = 'f_'")?;
        stmt.query_map([&table], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?
    };
    let wanted: Vec<(String, &str)> = spec
        .index_fields()
        .into_iter()
        .map(|f| (column_name(f), f))
        .collect();
    for column in &existing {
        if !wanted.iter().any(|(c, _)| c == column) {
            tx.execute_batch(&format!(
                "DROP INDEX IF EXISTS \"{}\";
                 ALTER TABLE \"{table}\" DROP COLUMN \"{column}\";",
                index_name(&table, column)
            ))?;
        }
    }
    for (column, field) in &wanted {
        check_owner(tx, &index_name(&table, column), &table)?;
        if !existing.contains(column) {
            tx.execute_batch(&format!(
                "ALTER TABLE \"{table}\" ADD COLUMN \"{column}\"
                     GENERATED ALWAYS AS (json_extract(data, '{}')) VIRTUAL;",
                json_path(field)
            ))?;
        }
        tx.execute_batch(&format!(
            "CREATE INDEX IF NOT EXISTS \"{}\" ON \"{table}\" (\"{column}\");",
            index_name(&table, column)
        ))?;
    }

    let fts = fts_name(&table);
    check_owner(tx, &fts, &fts)?;
    let fts_exists: bool = tx.query_row(
        "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [&fts],
        |r| r.get(0),
    )?;
    let search_changed = previous
        .as_ref()
        .is_none_or(|p| p.spec.search != spec.search);
    if spec.search.is_empty() {
        tx.execute_batch(&format!("DROP TABLE IF EXISTS \"{fts}\";"))?;
    } else if !fts_exists || search_changed {
        tx.execute_batch(&format!(
            "DROP TABLE IF EXISTS \"{fts}\";
             CREATE VIRTUAL TABLE \"{fts}\" USING fts5(
                 body, tokenize = 'unicode61 remove_diacritics 2'
             );"
        ))?;
        rebuild_fts(tx, &table, &fts, &spec.search)?;
    }

    tx.execute(
        "INSERT INTO store_resources (resource, table_name, spec) VALUES (?1, ?2, ?3)
         ON CONFLICT(resource) DO UPDATE SET spec = excluded.spec",
        params![spec.resource.as_str(), table, serde_json::to_string(spec)?],
    )?;
    Ok(Registered {
        fts: (!spec.search.is_empty()).then_some(fts),
        table,
        spec: spec.clone(),
    })
}

fn rebuild_fts(tx: &Connection, table: &str, fts: &str, fields: &[String]) -> Result<()> {
    let mut select = tx.prepare(&format!("SELECT k, data FROM \"{table}\""))?;
    let rows = select
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut insert = tx.prepare(&format!(
        "INSERT INTO \"{fts}\" (rowid, body) VALUES (?1, ?2)"
    ))?;
    for (k, data) in rows {
        let value: Value = serde_json::from_str(&data)?;
        insert.execute(params![k, search_text(fields, &value)])?;
    }
    Ok(())
}

/// Folded values of `fields` in `data`, space separated.
pub(crate) fn search_text(fields: &[String], data: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    for field in fields {
        let mut node = Some(data);
        for seg in field.split('.') {
            node = node.and_then(|n| n.get(seg));
        }
        match node {
            Some(Value::Array(items)) => items.iter().for_each(|v| push_scalar(&mut parts, v)),
            Some(v) => push_scalar(&mut parts, v),
            None => {}
        }
    }
    fold(&parts.join(" "))
}

fn push_scalar(parts: &mut Vec<String>, value: &Value) {
    match value {
        Value::String(s) => parts.push(s.clone()),
        Value::Number(n) => parts.push(n.to_string()),
        _ => {}
    }
}

fn upsert(tx: &Connection, reg: &Registered, row: &ResourceRow) -> Result<()> {
    Store::remove_draft_on(tx, &reg.spec.resource, row.id)?;
    let value = serde_json::to_value(row)?;
    let version = row
        .version
        .map(i64::try_from)
        .transpose()
        .map_err(|_| invalid(format!("{}: version out of range", row.id)))?;
    let k: i64 = tx.query_row(
        &format!(
            "INSERT INTO \"{}\" (id, version, data) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET version = excluded.version, data = excluded.data
             RETURNING k",
            reg.table
        ),
        params![row.id.to_string(), version, value.to_string()],
        |r| r.get(0),
    )?;
    if let Some(fts) = &reg.fts {
        tx.execute(&format!("DELETE FROM \"{fts}\" WHERE rowid = ?1"), [k])?;
        tx.execute(
            &format!("INSERT INTO \"{fts}\" (rowid, body) VALUES (?1, ?2)"),
            params![k, search_text(&reg.spec.search, &value)],
        )?;
    }
    Ok(())
}

pub(crate) fn delete(tx: &Connection, reg: &Registered, id: Uuid) -> Result<bool> {
    Store::remove_draft_on(tx, &reg.spec.resource, id)?;
    let k: Option<i64> = tx
        .query_row(
            &format!("DELETE FROM \"{}\" WHERE id = ?1 RETURNING k", reg.table),
            [id.to_string()],
            |r| r.get(0),
        )
        .optional()?;
    if let (Some(k), Some(fts)) = (k, &reg.fts) {
        tx.execute(&format!("DELETE FROM \"{fts}\" WHERE rowid = ?1"), [k])?;
    }
    Ok(k.is_some())
}

/// Deletes the rows whose `k` is returned by `select_keys` (a `SELECT k ...`).
pub(crate) fn delete_where(
    tx: &Connection,
    reg: &Registered,
    select_keys: &str,
    params: impl rusqlite::Params + Clone,
) -> Result<usize> {
    if let Some(fts) = &reg.fts {
        tx.execute(
            &format!("DELETE FROM \"{fts}\" WHERE rowid IN ({select_keys})"),
            params.clone(),
        )?;
    }
    Ok(tx.execute(
        &format!("DELETE FROM \"{}\" WHERE k IN ({select_keys})", reg.table),
        params,
    )?)
}

fn clear(tx: &Connection, reg: &Registered) -> Result<usize> {
    tx.execute(
        "DELETE FROM store_local_creates WHERE resource=?1",
        [reg.spec.resource.as_str()],
    )?;
    if let Some(fts) = &reg.fts {
        tx.execute_batch(&format!("DELETE FROM \"{fts}\";"))?;
    }
    Ok(tx.execute(&format!("DELETE FROM \"{}\"", reg.table), [])?)
}

fn state_in(conn: &Connection, resource: &ResourceName) -> Result<Option<ResourceState>> {
    let row: Option<(String, bool, String)> = conn
        .query_row(
            "SELECT cursor, complete, synced_at FROM store_cursors WHERE resource = ?1",
            [resource.as_str()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    row.map(|(cursor, complete, synced_at)| {
        Ok(ResourceState {
            cursor: serde_json::from_str(&cursor)?,
            complete,
            synced_at,
        })
    })
    .transpose()
}

fn save_cursor(
    tx: &Connection,
    resource: &ResourceName,
    cursor: &Cursor,
    complete: bool,
) -> Result<()> {
    tx.execute(
        "INSERT INTO store_cursors (resource, cursor, complete, synced_at)
         VALUES (?1, ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(resource) DO UPDATE SET cursor = excluded.cursor,
             complete = excluded.complete, synced_at = excluded.synced_at",
        params![resource.as_str(), serde_json::to_string(cursor)?, complete],
    )?;
    Ok(())
}

pub(crate) fn decode_row(data: &str) -> Result<ResourceRow> {
    Ok(serde_json::from_str(data)?)
}

fn base_in(conn: &Connection, resource: &ResourceName) -> Result<PullBase> {
    let epoch: Option<i64> = conn
        .query_row(
            "SELECT epoch FROM store_epochs WHERE resource = ?1",
            [resource.as_str()],
            |r| r.get(0),
        )
        .optional()?;
    Ok(PullBase {
        cursor: state_in(conn, resource)?.map(|s| s.cursor),
        epoch: epoch.and_then(|e| u64::try_from(e).ok()).unwrap_or(0),
    })
}

/// Runs `f` inside a savepoint, so several statements read one snapshot.
/// Works on a bare reader (starts a read transaction) and nested inside a
/// caller's transaction.
pub(crate) fn read_snapshot<T>(
    conn: &Connection,
    f: impl FnOnce(&Connection) -> Result<T>,
) -> Result<T> {
    conn.execute_batch("SAVEPOINT keystone_read;")?;
    let value = f(conn);
    // Read-only work: releasing is enough, also after an error.
    conn.execute_batch("RELEASE keystone_read;")?;
    value
}

/// Fails when `name` already exists in the schema for another table.
fn check_owner(tx: &Connection, name: &str, owner: &str) -> Result<()> {
    let found: Option<String> = tx
        .query_row(
            "SELECT tbl_name FROM sqlite_master WHERE name = ?1",
            [name],
            |r| r.get(0),
        )
        .optional()?;
    match found {
        Some(other) if other != owner => Err(invalid(format!(
            "schema name {name:?} belongs to {other:?}, not {owner:?}"
        ))),
        _ => Ok(()),
    }
}
