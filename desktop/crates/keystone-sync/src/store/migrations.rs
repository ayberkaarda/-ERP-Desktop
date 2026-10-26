//! Migration registry.
//!
//! Each module that owns tables exposes `pub const MIGRATIONS: &[Migration]`
//! and takes ids only from its range in [`RANGES`]. [`registry`] collects all
//! of them; the store applies the ones missing from the ledger table in id
//! order, one transaction each, and sets `PRAGMA user_version` to the highest
//! applied id. The ledger keeps a late-added lower id from being skipped and
//! rejects a database that has migrations this build does not know.
//!
//! The ledger also records module and SQL digest of each migration; a
//! mismatch on open stops the store.
//!
//! Rules: never edit or renumber a migration that has shipped; add a new one.

use rusqlite::{Connection, TransactionBehavior, params};

use crate::error::{Result, SyncError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Migration {
    /// Unique across the crate, inside the module's range.
    pub id: u32,
    /// Owning module, a key of [`RANGES`].
    pub module: &'static str,
    /// Short snake_case label, recorded in the ledger.
    pub name: &'static str,
    /// Executed with `execute_batch`.
    pub sql: &'static str,
}

/// Id ranges per owning module (inclusive).
pub const RANGES: &[(&str, u32, u32)] = &[
    ("store", 1, 99),
    ("outbox", 100, 199),
    ("conflicts", 200, 299),
    ("engine", 300, 399),
];

const LEDGER: &str = "_keystone_migrations";

/// Every migration of the crate, sorted by id.
pub fn registry() -> Vec<&'static Migration> {
    let mut all: Vec<&'static Migration> = [
        super::MIGRATIONS,
        super::MIRROR_MIGRATIONS,
        crate::outbox::MIGRATIONS,
        crate::conflicts::MIGRATIONS,
        crate::engine::MIGRATIONS,
    ]
    .into_iter()
    .flatten()
    .collect();
    all.sort_by_key(|m| m.id);
    all
}

/// Checks ids are unique and inside their module's range.
pub fn validate(migrations: &[&Migration]) -> Result<()> {
    let mut seen = std::collections::BTreeSet::new();
    for m in migrations {
        let Some(&(_, low, high)) = RANGES.iter().find(|(module, ..)| *module == m.module) else {
            return Err(invalid(format!("{}: unknown module {:?}", m.id, m.module)));
        };
        if !(low..=high).contains(&m.id) {
            return Err(invalid(format!(
                "{} {}: id outside {}..={} of {}",
                m.id, m.name, low, high, m.module
            )));
        }
        if !seen.insert(m.id) {
            return Err(invalid(format!("{}: duplicate id", m.id)));
        }
    }
    Ok(())
}

/// Applies the migrations that are not in the ledger yet. Returns how many ran.
///
/// Every ledger row must match this build by id, name, module and SQL digest
/// ([`sql_digest`]). A ledger from before digests existed gets the column
/// added and its rows stamped with this build's digests once.
pub(crate) fn apply(conn: &mut Connection, migrations: &[&Migration]) -> Result<usize> {
    validate(migrations)?;
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {LEDGER} (
            id INTEGER PRIMARY KEY,
            module TEXT NOT NULL,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            sql_digest TEXT
        ) STRICT;"
    ))?;
    let has_digest: bool = conn.query_row(
        &format!(
            "SELECT count(*) > 0 FROM pragma_table_info('{LEDGER}') WHERE name = 'sql_digest'"
        ),
        [],
        |r| r.get(0),
    )?;
    if !has_digest {
        conn.execute_batch(&format!("ALTER TABLE {LEDGER} ADD COLUMN sql_digest TEXT;"))?;
    }

    let known = ledger_rows(conn)?;
    for row in &known {
        let Some(m) = migrations.iter().find(|m| m.id == row.id) else {
            return Err(invalid(format!(
                "database has migration {} {}, which this build does not know",
                row.id, row.name
            )));
        };
        if m.name != row.name {
            return Err(invalid(format!(
                "migration {} is {:?} in the database but {:?} here",
                row.id, row.name, m.name
            )));
        }
        if m.module != row.module {
            return Err(invalid(format!(
                "migration {} belongs to {:?} in the database but {:?} here",
                row.id, row.module, m.module
            )));
        }
        let digest = sql_digest(m.sql);
        match &row.digest {
            Some(stored) if *stored != digest => {
                return Err(invalid(format!(
                    "migration {} {}: SQL digest {stored} in the database, {digest} here; \
                     shipped migrations must not change, add a new one",
                    row.id, row.name
                )));
            }
            Some(_) => {}
            None => {
                conn.execute(
                    &format!("UPDATE {LEDGER} SET sql_digest = ?1 WHERE id = ?2"),
                    params![digest, row.id],
                )?;
            }
        }
    }

    let mut ordered: Vec<&Migration> = migrations.to_vec();
    ordered.sort_by_key(|m| m.id);
    let mut applied = 0;
    for m in ordered {
        if known.iter().any(|row| row.id == m.id) {
            continue;
        }
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(m.sql)?;
        tx.execute(
            &format!("INSERT INTO {LEDGER} (id, module, name, sql_digest) VALUES (?1, ?2, ?3, ?4)"),
            params![m.id, m.module, m.name, sql_digest(m.sql)],
        )?;
        let current: u32 = tx.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if m.id > current {
            // PRAGMA takes no bound parameters; the id is a u32 from code.
            tx.execute_batch(&format!("PRAGMA user_version = {};", m.id))?;
        }
        tx.commit()?;
        applied += 1;
    }
    Ok(applied)
}

/// Change detector for migration SQL: FNV-1a 64 over the text with `\r`
/// removed (a CRLF checkout builds the same digest). Not a security hash;
/// the ledger lives inside the encrypted database.
pub fn sql_digest(sql: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in sql.bytes().filter(|b| *b != b'\r') {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("fnv1a64:{hash:016x}")
}

struct LedgerRow {
    id: u32,
    module: String,
    name: String,
    digest: Option<String>,
}

fn ledger_rows(conn: &Connection) -> Result<Vec<LedgerRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, module, name, sql_digest FROM {LEDGER} ORDER BY id"
    ))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LedgerRow {
                id: row.get(0)?,
                module: row.get(1)?,
                name: row.get(2)?,
                digest: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// `(id, name)` of every applied migration, by id.
pub(crate) fn ledger(conn: &Connection) -> Result<Vec<(u32, String)>> {
    let mut stmt = conn.prepare(&format!("SELECT id, name FROM {LEDGER} ORDER BY id"))?;
    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

fn invalid(message: String) -> SyncError {
    SyncError::Migration(message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crate_registry_is_valid() {
        validate(&registry()).expect("registry");
    }

    #[test]
    fn ranges_do_not_overlap() {
        for (i, (a, a_low, a_high)) in RANGES.iter().enumerate() {
            assert!(a_low <= a_high, "{a}");
            for (b, b_low, b_high) in &RANGES[i + 1..] {
                assert!(a_high < b_low || b_high < a_low, "{a} overlaps {b}");
            }
        }
    }

    #[test]
    fn rejects_out_of_range_and_duplicate_ids() {
        let wrong_range = Migration {
            id: 150,
            module: "store",
            name: "x",
            sql: "",
        };
        assert!(validate(&[&wrong_range]).is_err());
        let a = Migration {
            id: 5,
            module: "store",
            name: "a",
            sql: "",
        };
        assert!(validate(&[&a, &a]).is_err());
    }
}
