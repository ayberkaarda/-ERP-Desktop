//! Migration registry.
//!
//! Each module that owns tables exposes `pub const MIGRATIONS: &[Migration]`
//! and takes ids only from its range in [`RANGES`]. [`registry`] collects all
//! of them; the store applies the ones missing from the ledger table in id
//! order, one transaction each, and sets `PRAGMA user_version` to the highest
//! applied id. The ledger keeps a late-added lower id from being skipped and
//! rejects a database that has migrations this build does not know.
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
pub(crate) fn apply(conn: &mut Connection, migrations: &[&Migration]) -> Result<usize> {
    validate(migrations)?;
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS {LEDGER} (
            id INTEGER PRIMARY KEY,
            module TEXT NOT NULL,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        ) STRICT;"
    ))?;

    let known = ledger(conn)?;
    for (id, name) in &known {
        match migrations.iter().find(|m| m.id == *id) {
            None => {
                return Err(invalid(format!(
                    "database has migration {id} {name}, which this build does not know"
                )));
            }
            Some(m) if m.name != name => {
                return Err(invalid(format!(
                    "migration {id} is {name:?} in the database but {:?} here",
                    m.name
                )));
            }
            Some(_) => {}
        }
    }

    let mut ordered: Vec<&Migration> = migrations.to_vec();
    ordered.sort_by_key(|m| m.id);
    let mut applied = 0;
    for m in ordered {
        if known.iter().any(|(id, _)| *id == m.id) {
            continue;
        }
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(m.sql)?;
        tx.execute(
            &format!("INSERT INTO {LEDGER} (id, module, name) VALUES (?1, ?2, ?3)"),
            params![m.id, m.module, m.name],
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
