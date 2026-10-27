//! Retention of the local mirror. Only document resources (spec `window`)
//! lose rows; master data and snapshots are never pruned here.
//!
//! 1. Window: document rows whose window field (as text) is before
//!    `today - days` are removed. A row exactly `days` old stays. Rows
//!    whose window field is null or not text are left alone by this step.
//! 2. Size: while the live pages of the database exceed `max_bytes`, the
//!    oldest document rows (any document resource, nulls last) go in
//!    batches. Freed pages are reused; the file itself is not shrunk.
//!
//! Runs on [`Store::prune`] / [`Store::prune_at`], and automatically inside
//! the writing transaction once `prune_every_writes` mirror writes (rows
//! upserted plus tombstones, `put_row`, `remove_row`) have accumulated.

use rusqlite::{Connection, OptionalExtension, params};

use super::Store;
use super::mirror::{Registered, all_registered, delete_where};
use super::spec::{column_name, invalid};
use crate::error::Result;

const WRITES_KEY: &str = "mirror.writes_since_prune";
const SIZE_BATCH: i64 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionPolicy {
    /// Window for document specs without their own `days`.
    pub window_days: u32,
    /// Soft cap on live database pages.
    pub max_bytes: u64,
    /// Automatic prune after this many mirror writes; 0 turns it off.
    pub prune_every_writes: u64,
}

impl Default for RetentionPolicy {
    /// 30 days / 500 MB / 5000 writes.
    fn default() -> Self {
        Self {
            window_days: 30,
            max_bytes: 500 * 1024 * 1024,
            prune_every_writes: 5000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PruneReport {
    /// Rows removed for being outside their window.
    pub expired: usize,
    /// Rows removed to get under `max_bytes`.
    pub over_size: usize,
}

impl Store {
    /// Prunes against today's UTC date.
    pub(crate) fn prune(&self) -> Result<PruneReport> {
        let policy = self.retention();
        self.write(|tx| prune_in(tx, &policy, None))
    }

    /// Prunes as if today were `today` (`YYYY-MM-DD`).
    #[cfg_attr(not(feature = "raw-store"), allow(dead_code))]
    pub(crate) fn prune_at(&self, today: &str) -> Result<PruneReport> {
        let policy = self.retention();
        self.write(|tx| prune_in(tx, &policy, Some(today)))
    }

    /// Bytes in use by live pages (file size minus free pages).
    pub fn used_bytes(&self) -> Result<u64> {
        self.read(used_bytes)
    }
}

pub(crate) fn count_writes(tx: &Connection, writes: usize, policy: &RetentionPolicy) -> Result<()> {
    if writes == 0 {
        return Ok(());
    }
    let current: u64 = tx
        .query_row(
            "SELECT value FROM store_meta WHERE key = ?1",
            [WRITES_KEY],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut total = current.saturating_add(writes as u64);
    if policy.prune_every_writes > 0 && total >= policy.prune_every_writes {
        prune_in(tx, policy, None)?;
        total = 0;
    }
    tx.execute(
        "INSERT INTO store_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![WRITES_KEY, total.to_string()],
    )?;
    Ok(())
}

fn prune_in(tx: &Connection, policy: &RetentionPolicy, today: Option<&str>) -> Result<PruneReport> {
    let documents: Vec<Registered> = all_registered(tx)?
        .into_iter()
        .filter(|r| r.spec.is_document())
        .collect();
    let mut report = PruneReport::default();

    for reg in &documents {
        let Some(window) = &reg.spec.window else {
            continue;
        };
        let days = window.days.unwrap_or(policy.window_days);
        let modifier = format!("-{days} days");
        let cutoff: Option<String> = match today {
            Some(day) => tx.query_row(
                "SELECT date(?1, ?2) WHERE ?1 GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'",
                params![day, modifier],
                |r| r.get(0),
            )
            .optional()?
            .flatten(),
            None => tx.query_row("SELECT date('now', ?1)", [&modifier], |r| r.get(0))?,
        };
        let Some(cutoff) = cutoff else {
            return Err(invalid(format!("invalid date {today:?}")));
        };
        let column = column_name(&window.field);
        // Text before `YYYY-MM-DD` of the cutoff is exactly "date part
        // earlier than the cutoff", also for full timestamps.
        report.expired += delete_where(
            tx,
            reg,
            &format!(
                "SELECT k FROM \"{}\" WHERE typeof(\"{column}\") = 'text' AND \"{column}\" < ?1",
                reg.table
            ),
            [cutoff],
        )?;
    }

    while used_bytes(tx)? > policy.max_bytes {
        let mut oldest: Option<(bool, Option<String>, &Registered)> = None;
        for reg in &documents {
            let Some(window) = &reg.spec.window else {
                continue;
            };
            let column = column_name(&window.field);
            let head: Option<Option<String>> = tx
                .query_row(
                    &format!(
                        "SELECT CAST(\"{column}\" AS TEXT) FROM \"{}\"
                         ORDER BY \"{column}\" IS NULL, \"{column}\" LIMIT 1",
                        reg.table
                    ),
                    [],
                    |r| r.get(0),
                )
                .optional()?;
            let Some(value) = head else {
                continue;
            };
            let key = (value.is_none(), value);
            if oldest
                .as_ref()
                .is_none_or(|(n, v, _)| (key.0, &key.1) < (*n, v))
            {
                oldest = Some((key.0, key.1, reg));
            }
        }
        let Some((_, _, reg)) = oldest else {
            break;
        };
        let Some(window) = &reg.spec.window else {
            break;
        };
        let column = column_name(&window.field);
        let removed = delete_where(
            tx,
            reg,
            &format!(
                "SELECT k FROM \"{}\" ORDER BY \"{column}\" IS NULL, \"{column}\", k LIMIT ?1",
                reg.table
            ),
            [SIZE_BATCH],
        )?;
        if removed == 0 {
            break;
        }
        report.over_size += removed;
    }
    Ok(report)
}

fn used_bytes(conn: &Connection) -> Result<u64> {
    let pages: i64 = conn.query_row(
        "SELECT (SELECT page_count FROM pragma_page_count())
              - (SELECT freelist_count FROM pragma_freelist_count())",
        [],
        |r| r.get(0),
    )?;
    // SQLCipher answers `PRAGMA page_size` as text (`cipher_page_size`).
    let size: rusqlite::types::Value = conn.query_row("PRAGMA page_size", [], |r| r.get(0))?;
    let size = match size {
        rusqlite::types::Value::Integer(n) => n,
        rusqlite::types::Value::Text(t) => t.trim().parse().unwrap_or(0),
        _ => 0,
    };
    if size <= 0 {
        return Err(invalid("page size unavailable"));
    }
    Ok(u64::try_from(pages.max(0).saturating_mul(size)).unwrap_or(0))
}
