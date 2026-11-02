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
const SIGN_OUT_SERVER_ENDED: &str = "sign_out_server_ended";
/// The last `GET /auth/me` answer of a sign-in ([`StoredSessionCopy`]).
/// Every wipe, seal and close removes it.
const SESSION_COPY: &str = "session_copy";

/// Format of [`SESSION_COPY`]; any other is ignored.
const SESSION_COPY_FORMAT: u32 = 1;

/// The `GET /auth/me` answer kept for an offline start, with the sign-in,
/// user and company it was fetched for. It never holds a token: the server
/// sends none in that answer, and the engine refuses one that does.
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct StoredSessionCopy {
    pub format: u32,
    pub generation: u64,
    pub user_id: Uuid,
    pub company_id: Uuid,
    pub fetched_at: String,
    pub body: serde_json::Value,
}

/// The body (user data) is never printed.
impl std::fmt::Debug for StoredSessionCopy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredSessionCopy")
            .field("generation", &self.generation)
            .field("fetched_at", &self.fetched_at)
            .finish_non_exhaustive()
    }
}

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
    /// The server confirmed that the sign-in of `generation` ended. Written
    /// with the move to [`SignOutStage::Wipe`], so a sign-out finished later
    /// reports what the server said, not that nothing was left to ask.
    /// Missing (older records, a torn mark) reads as `false`.
    pub server_ended: bool,
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
    let server_ended = get(SIGN_OUT_SERVER_ENDED)?.as_deref() == Some("1");
    Ok(match (generation, stage) {
        (Some(generation), Some(stage)) => Some(PendingSignOut {
            generation,
            stage,
            server_ended,
        }),
        // A torn or unknown mark is treated as the earliest stage: nothing
        // is wiped before the revoke of that generation is confirmed.
        (Some(generation), None) => Some(PendingSignOut {
            generation,
            stage: SignOutStage::Revoke,
            server_ended: false,
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
                let server_ended = if pending.server_ended { "1" } else { "0" };
                for (key, value) in [
                    (SIGN_OUT_GENERATION, pending.generation.to_string()),
                    (SIGN_OUT_STAGE, pending.stage.as_str().to_owned()),
                    (SIGN_OUT_SERVER_ENDED, server_ended.to_owned()),
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
                    "DELETE FROM engine_meta WHERE key IN (?1, ?2, ?3)",
                    [SIGN_OUT_GENERATION, SIGN_OUT_STAGE, SIGN_OUT_SERVER_ENDED],
                )?;
            }
        }
        Ok(())
    })
}

/// The kept `GET /auth/me` answer; `None` when there is none or it is
/// unreadable or of another format.
pub(super) fn session_copy(store: &Store) -> Result<Option<StoredSessionCopy>> {
    store.read(|conn| {
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM engine_meta WHERE key = ?1",
                [SESSION_COPY],
                |r| r.get(0),
            )
            .optional()?;
        Ok(value
            .and_then(|v| serde_json::from_str::<StoredSessionCopy>(&v).ok())
            .filter(|copy| copy.format == SESSION_COPY_FORMAT))
    })
}

/// Replaces the kept `GET /auth/me` answer.
pub(super) fn set_session_copy(store: &Store, copy: &StoredSessionCopy) -> Result<()> {
    store.write(|tx| write_session_copy(tx, copy))
}

/// Replaces the kept `GET /auth/me` answer unless the kept one belongs to
/// the same sign-in and was fetched later than `copy` (an older answer
/// that arrives last never overwrites a newer one). Check and write are
/// one transaction. `false`: the kept one stays.
pub(super) fn offer_session_copy(store: &Store, copy: &StoredSessionCopy) -> Result<bool> {
    store.write(|tx| {
        let kept: Option<String> = tx
            .query_row(
                "SELECT value FROM engine_meta WHERE key = ?1",
                [SESSION_COPY],
                |r| r.get(0),
            )
            .optional()?;
        let kept = kept
            .and_then(|v| serde_json::from_str::<StoredSessionCopy>(&v).ok())
            .filter(|kept| kept.format == SESSION_COPY_FORMAT);
        if let Some(kept) = kept.filter(|kept| kept.generation == copy.generation) {
            // An unreadable time compares as NULL: the new answer wins.
            let newer: Option<bool> = tx.query_row(
                "SELECT julianday(?1) > julianday(?2)",
                params![kept.fetched_at, copy.fetched_at],
                |r| r.get(0),
            )?;
            if newer == Some(true) {
                return Ok(false);
            }
        }
        write_session_copy(tx, copy)?;
        Ok(true)
    })
}

fn write_session_copy(tx: &Connection, copy: &StoredSessionCopy) -> Result<()> {
    let value = serde_json::to_string(&StoredSessionCopy {
        format: SESSION_COPY_FORMAT,
        ..copy.clone()
    })?;
    tx.execute(
        "INSERT INTO engine_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SESSION_COPY, value],
    )?;
    Ok(())
}

/// Drops the kept `GET /auth/me` answer.
pub(super) fn clear_session_copy(store: &Store) -> Result<()> {
    store.write(|tx| {
        tx.execute("DELETE FROM engine_meta WHERE key = ?1", [SESSION_COPY])?;
        Ok(())
    })
}

/// Closes local access while retaining the identity and all data; the kept
/// `GET /auth/me` answer goes.
pub(super) fn close(store: &Store) -> Result<()> {
    store.write(|tx| {
        tx.execute(
            "DELETE FROM engine_meta WHERE key IN (?1, ?2)",
            [GENERATION, SESSION_COPY],
        )?;
        Ok(())
    })
}

/// Removes server data (the kept `GET /auth/me` answer too) and seals work
/// until the same identity is verified again.
pub(super) fn seal(store: &Store) -> Result<Vec<ResourceName>> {
    store.write(|tx| {
        tx.execute(
            "INSERT OR REPLACE INTO engine_meta (key, value) VALUES (?1, '1')",
            [crate::outbox::WORK_SEALED],
        )?;
        let names = Store::clear_mirror_on(tx)?;
        tx.execute("DELETE FROM engine_draft_bases", [])?;
        tx.execute(
            "DELETE FROM engine_meta WHERE key IN (?1, ?2)",
            [GENERATION, SESSION_COPY],
        )?;
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
