//! Engine tables (`engine_meta`, `engine_draft_bases`), counts and wipes.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

use super::SyncStatus;
use crate::error::Result;
use crate::store::Store;
use crate::wire::{ResourceName, ResourceRow};

/// `engine_meta` keys: the `user_id:company_id` the local data belongs to,
/// the sign-in generation whose manifest confirmed it, and the manifest's
/// resources (JSON array).
const IDENTITY: &str = "identity";
const GENERATION: &str = "generation";
const RESOURCES: &str = "resources";
/// Set while a sign-out has revoked (or is revoking) the tokens and the
/// local data still has to go; access stays closed meanwhile.
const WIPE_PENDING: &str = "wipe_pending";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct Counts {
    /// `pending` + `in_flight`.
    pub pending: usize,
    /// Outbox entries in state `conflict`.
    pub in_conflict: usize,
    pub rejected: usize,
    pub quarantined: usize,
    /// Conflict Inbox records.
    pub conflicts: usize,
}

impl Counts {
    pub fn apply(&self, status: &mut SyncStatus) {
        status.pending = self.pending;
        status.conflicts = self.conflicts;
        status.rejected = self.rejected;
        status.quarantined = self.quarantined;
    }
}

fn to_usize(n: i64) -> usize {
    usize::try_from(n).unwrap_or(0)
}

pub(super) fn counts(store: &Store) -> Result<Counts> {
    store.read(|conn| {
        let mut counts = Counts::default();
        let mut stmt = conn.prepare("SELECT state, count(*) FROM outbox_entries GROUP BY state")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?;
        for row in rows {
            let (state, n) = row?;
            let n = to_usize(n);
            match state.as_str() {
                "pending" | "in_flight" => counts.pending += n,
                "conflict" => counts.in_conflict += n,
                "rejected" => counts.rejected += n,
                "quarantined" => counts.quarantined += n,
                _ => {}
            }
        }
        counts.conflicts =
            to_usize(conn.query_row("SELECT count(*) FROM conflict_records", [], |r| r.get(0))?);
        Ok(counts)
    })
}

/// Keeps the current mirror row of `(resource, id)` as a draft base.
pub(super) fn save_base(store: &Store, resource: &ResourceName, id: Uuid) -> Result<()> {
    store.write(|tx| {
        if let Some(row) = Store::get_row_on(tx, resource, id)? {
            tx.execute(
                "INSERT INTO engine_draft_bases (resource, id, data) VALUES (?1, ?2, ?3)
                 ON CONFLICT(resource, id) DO UPDATE SET data = excluded.data",
                params![
                    resource.as_str(),
                    id.to_string(),
                    serde_json::to_string(&row)?
                ],
            )?;
        }
        Ok(())
    })
}

/// Saved base of a draft, when there is one.
pub(super) fn base_on(
    conn: &Connection,
    resource: &ResourceName,
    id: Uuid,
) -> Result<Option<ResourceRow>> {
    let data: Option<String> = conn
        .query_row(
            "SELECT data FROM engine_draft_bases WHERE resource = ?1 AND id = ?2",
            params![resource.as_str(), id.to_string()],
            |r| r.get(0),
        )
        .optional()?;
    data.map(|d| Ok(serde_json::from_str(&d)?)).transpose()
}

/// Drops bases whose row has no outbox entry any more.
pub(super) fn prune_bases(store: &Store) -> Result<usize> {
    store.write(|tx| {
        let live: HashSet<(String, String)> = crate::outbox::load(tx)?
            .into_iter()
            .map(|e| (e.mutation.resource.0, e.mutation.id.to_string()))
            .collect();
        let mut stmt = tx.prepare("SELECT resource, id FROM engine_draft_bases")?;
        let all = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut removed = 0;
        for key in all {
            if !live.contains(&key) {
                removed += tx.execute(
                    "DELETE FROM engine_draft_bases WHERE resource = ?1 AND id = ?2",
                    params![key.0, key.1],
                )?;
            }
        }
        Ok(removed)
    })
}

/// Removes mirror, outbox, conflicts and engine state in one transaction.
/// Returns the resources whose local copy was dropped.
pub(super) fn wipe(store: &Store) -> Result<Vec<ResourceName>> {
    store.write(|tx| {
        let names = Store::clear_mirror_on(tx)?;
        crate::outbox::clear_on(tx)?;
        crate::conflicts::clear_on(tx)?;
        tx.execute_batch(
            "DELETE FROM engine_draft_bases;
             DELETE FROM engine_meta;",
        )?;
        Ok(names)
    })
}

/// Who the local data belongs to, as confirmed by the last manifest.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct LocalSession {
    pub identity: Option<String>,
    /// Sign-in generation of that manifest.
    pub generation: Option<u64>,
    pub resources: Vec<ResourceName>,
    /// A sign-out still has to remove the local data.
    pub wipe_pending: bool,
}

pub(super) fn session(store: &Store) -> Result<LocalSession> {
    store.read(|conn| {
        let get = |key: &str| -> Result<Option<String>> {
            Ok(conn
                .query_row("SELECT value FROM engine_meta WHERE key = ?1", [key], |r| {
                    r.get(0)
                })
                .optional()?)
        };
        let resources = match get(RESOURCES)? {
            Some(json) => serde_json::from_str(&json)?,
            None => Vec::new(),
        };
        Ok(LocalSession {
            identity: get(IDENTITY)?,
            generation: get(GENERATION)?.and_then(|g| g.parse().ok()),
            resources,
            wipe_pending: get(WIPE_PENDING)?.is_some(),
        })
    })
}

/// Records identity, generation and manifest resources together.
pub(super) fn set_session(
    store: &Store,
    identity: &str,
    generation: u64,
    resources: &[ResourceName],
) -> Result<()> {
    let resources = serde_json::to_string(resources)?;
    store.write(|tx| {
        for (key, value) in [
            (IDENTITY, identity.to_owned()),
            (GENERATION, generation.to_string()),
            (RESOURCES, resources),
        ] {
            tx.execute(
                "INSERT INTO engine_meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )?;
        }
        Ok(())
    })
}

/// Drops the saved draft bases of `resource` (server data the user may no
/// longer see); the drafts themselves stay in the outbox.
pub(super) fn drop_bases(store: &Store, resource: &ResourceName) -> Result<usize> {
    store.write(|tx| {
        Ok(tx.execute(
            "DELETE FROM engine_draft_bases WHERE resource = ?1",
            [resource.as_str()],
        )?)
    })
}

/// Sets or clears the sign-out cleanup mark (a wipe removes it too).
pub(super) fn set_wipe_pending(store: &Store, pending: bool) -> Result<()> {
    store.write(|tx| {
        if pending {
            tx.execute(
                "INSERT INTO engine_meta (key, value) VALUES (?1, '1')
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [WIPE_PENDING],
            )?;
        } else {
            tx.execute("DELETE FROM engine_meta WHERE key = ?1", [WIPE_PENDING])?;
        }
        Ok(())
    })
}
