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
/// `offline_manifest_version` of that manifest.
const OFFLINE_MANIFEST_VERSION: &str = "offline_manifest_version";
/// Set while a sign-out is unfinished: the generation it signs out and the
/// stage it reached ([`SignOutStage`]); access stays closed meanwhile.
const SIGN_OUT_GENERATION: &str = "sign_out_generation";
const SIGN_OUT_STAGE: &str = "sign_out_stage";

/// Stages of a sign-out, persisted before the step they name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SignOutStage {
    /// The tokens of the generation still have to be revoked; nothing may
    /// be wiped before that is confirmed.
    Revoke,
    /// The tokens are gone (revoked, or replaced by a later sign-in); the
    /// local data still has to go.
    Wipe,
}

impl SignOutStage {
    fn as_str(self) -> &'static str {
        match self {
            Self::Revoke => "revoke",
            Self::Wipe => "wipe",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "revoke" => Some(Self::Revoke),
            "wipe" => Some(Self::Wipe),
            _ => None,
        }
    }
}

/// A sign-out that has not finished, bound to the generation it began in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PendingSignOut {
    pub generation: u64,
    pub stage: SignOutStage,
}

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
    /// `offline_manifest_version` the server sent with that manifest.
    pub offline_manifest_version: Option<u32>,
    /// A sign-out still has to revoke the tokens or remove the local data.
    pub sign_out: Option<PendingSignOut>,
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
            offline_manifest_version: get(OFFLINE_MANIFEST_VERSION)?.and_then(|v| v.parse().ok()),
            sign_out: pending_sign_out_on(conn)?,
        })
    })
}

fn pending_sign_out_on(conn: &Connection) -> Result<Option<PendingSignOut>> {
    let get = |key: &str| -> Result<Option<String>> {
        Ok(conn
            .query_row("SELECT value FROM engine_meta WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()?)
    };
    let generation = get(SIGN_OUT_GENERATION)?.and_then(|g| g.parse().ok());
    let stage = get(SIGN_OUT_STAGE)?.and_then(|s| SignOutStage::parse(&s));
    Ok(match (generation, stage) {
        (Some(generation), Some(stage)) => Some(PendingSignOut { generation, stage }),
        // A torn or unknown mark is treated as the earliest stage: nothing
        // is wiped before the revoke of that generation is confirmed.
        (Some(generation), None) => Some(PendingSignOut {
            generation,
            stage: SignOutStage::Revoke,
        }),
        _ => None,
    })
}

/// The unfinished sign-out, when there is one.
pub(super) fn pending_sign_out(store: &Store) -> Result<Option<PendingSignOut>> {
    store.read(pending_sign_out_on)
}

/// Records identity, generation and manifest resources together.
pub(super) fn set_session(
    store: &Store,
    identity: &str,
    generation: u64,
    resources: &[ResourceName],
    offline_manifest_version: u32,
) -> Result<()> {
    let resources = serde_json::to_string(resources)?;
    store.write(|tx| {
        tx.execute(
            "DELETE FROM engine_meta WHERE key = ?1",
            [crate::outbox::WORK_SEALED],
        )?;
        for (key, value) in [
            (IDENTITY, identity.to_owned()),
            (GENERATION, generation.to_string()),
            (RESOURCES, resources),
            (
                OFFLINE_MANIFEST_VERSION,
                offline_manifest_version.to_string(),
            ),
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

/// Records or clears the unfinished sign-out in one transaction (a wipe
/// removes it too).
pub(super) fn set_pending_sign_out(store: &Store, pending: Option<PendingSignOut>) -> Result<()> {
    store.write(|tx| {
        match pending {
            Some(pending) => {
                for (key, value) in [
                    (SIGN_OUT_GENERATION, pending.generation.to_string()),
                    (SIGN_OUT_STAGE, pending.stage.as_str().to_owned()),
                ] {
                    tx.execute(
                        "INSERT INTO engine_meta (key, value) VALUES (?1, ?2)
                         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                        params![key, value],
                    )?;
                }
            }
            None => {
                tx.execute(
                    "DELETE FROM engine_meta WHERE key IN (?1, ?2)",
                    [SIGN_OUT_GENERATION, SIGN_OUT_STAGE],
                )?;
            }
        }
        Ok(())
    })
}

/// Closes local access while retaining the identity and all data.
pub(super) fn close(store: &Store) -> Result<()> {
    store.write(|tx| {
        tx.execute("DELETE FROM engine_meta WHERE key = ?1", [GENERATION])?;
        Ok(())
    })
}

/// Removes server data and seals work until the same identity is verified again.
pub(super) fn seal(store: &Store) -> Result<Vec<ResourceName>> {
    store.write(|tx| {
        tx.execute(
            "INSERT OR REPLACE INTO engine_meta (key, value) VALUES (?1, '1')",
            [crate::outbox::WORK_SEALED],
        )?;
        let names = Store::clear_mirror_on(tx)?;
        tx.execute("DELETE FROM engine_draft_bases", [])?;
        tx.execute("DELETE FROM engine_meta WHERE key = ?1", [GENERATION])?;
        Ok(names)
    })
}

/// Retains single-mutation sending until the eligible queue drains.
pub(super) fn isolate_push(store: &Store, enabled: bool) -> Result<()> {
    store.write(|tx| {
        if enabled {
            tx.execute(
                "INSERT OR REPLACE INTO engine_meta (key, value) VALUES ('push_isolate', '1')",
                [],
            )?;
        } else {
            tx.execute("DELETE FROM engine_meta WHERE key = 'push_isolate'", [])?;
        }
        Ok(())
    })
}

pub(super) fn push_isolated(store: &Store) -> Result<bool> {
    store.read(|conn| {
        Ok(conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM engine_meta WHERE key = 'push_isolate' AND value = '1')",
            [],
            |r| r.get(0),
        )?)
    })
}
