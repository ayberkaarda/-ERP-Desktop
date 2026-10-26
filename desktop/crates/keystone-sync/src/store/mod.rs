//! Encrypted local store (SQLCipher).
//!
//! One `Store` per (server profile, user, company). Other modules reach the
//! database only through [`Store::read`] and [`Store::write`]; they own their
//! tables through their `MIGRATIONS` (see [`migrations`]).

pub mod migrations;
mod mirror;

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use rusqlite::{Connection, ErrorCode as SqliteCode, Transaction, TransactionBehavior};

use crate::error::{Result, SyncError};
pub use migrations::{Migration, RANGES};
pub use mirror::{AppliedPage, MirrorStore};

/// Store-owned tables.
pub const MIGRATIONS: &[Migration] = &[Migration {
    id: 1,
    module: "store",
    name: "store_meta",
    sql: "CREATE TABLE store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    ) STRICT;",
}];

/// 256-bit raw SQLCipher key. The OS keychain keeps it (D3).
#[derive(Clone, PartialEq, Eq)]
pub struct DbKey([u8; 32]);

impl DbKey {
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    fn pragma_value(&self) -> String {
        let hex: String = self.0.iter().map(|b| format!("{b:02x}")).collect();
        format!("\"x'{hex}'\"")
    }
}

impl fmt::Debug for DbKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("DbKey(<redacted>)")
    }
}

pub struct Store {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl fmt::Debug for Store {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Store").field("path", &self.path).finish()
    }
}

impl Store {
    /// Opens or creates the database and applies every crate migration.
    pub fn open(path: impl AsRef<Path>, key: &DbKey) -> Result<Self> {
        Self::open_with_migrations(path, key, &migrations::registry())
    }

    /// Like [`Store::open`] with an explicit migration list (tests, tools).
    pub fn open_with_migrations(
        path: impl AsRef<Path>,
        key: &DbKey,
        migrations: &[&Migration],
    ) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let mut conn = Connection::open(&path)?;
        unlock(&conn, key)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;",
        )?;
        migrations::apply(&mut conn, migrations)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Runs `f` on the connection without a transaction.
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        f(&self.lock())
    }

    /// Runs `f` in an IMMEDIATE transaction; commits on `Ok`, rolls back on `Err`.
    pub fn write<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        let mut conn = self.lock();
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = f(&tx)?;
        tx.commit()?;
        Ok(value)
    }

    /// `PRAGMA user_version`: highest applied migration id.
    pub fn user_version(&self) -> Result<u32> {
        self.read(|conn| Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?))
    }

    /// `(id, name)` of every applied migration.
    pub fn applied_migrations(&self) -> Result<Vec<(u32, String)>> {
        self.read(migrations::ledger)
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        // A panic inside `read`/`write` cannot leave a half-open transaction:
        // `Transaction` rolls back on drop. The connection stays usable.
        self.conn.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn unlock(conn: &Connection, key: &DbKey) -> Result<()> {
    let cipher: Option<String> = conn
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .ok();
    if cipher.is_none_or(|v| v.is_empty()) {
        // Built without SQLCipher: never fall back to a plaintext database.
        return Err(SyncError::StoreKeyInvalid);
    }
    conn.execute_batch(&format!("PRAGMA key = {};", key.pragma_value()))?;
    match conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| {
        row.get::<_, i64>(0)
    }) {
        Ok(_) => Ok(()),
        Err(rusqlite::Error::SqliteFailure(e, _)) if e.code == SqliteCode::NotADatabase => {
            Err(SyncError::StoreKeyInvalid)
        }
        Err(e) => Err(e.into()),
    }
}
