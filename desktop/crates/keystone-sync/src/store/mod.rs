//! Encrypted local store (SQLCipher).
//!
//! One `Store` per (server profile, user, company). Other modules reach the
//! database only through [`Store::read`] and [`Store::write`]; they own their
//! tables through their `MIGRATIONS` (see [`migrations`]).
//!
//! Connections: one writer (behind a mutex, IMMEDIATE transactions) and a
//! small pool of `query_only` readers. WAL lets readers run while the writer
//! holds a transaction; they see the last committed state.

mod fold;
pub mod migrations;
mod mirror;
mod query;
mod retention;
mod spec;

use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};

use rusqlite::{Connection, ErrorCode as SqliteCode, Transaction, TransactionBehavior};

use crate::error::{Result, SyncError};
pub use fold::{fold, match_expression};
pub use migrations::{Migration, RANGES};
pub use mirror::{AppliedPage, MirrorStore, ResourceState, Snapshot};
pub use query::{
    Filter, FilterOp, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, ListPage, ListQuery, ReadRoute, SortKey,
    read_route,
};
pub use retention::{PruneReport, RetentionPolicy};
pub use spec::{DEFAULT_SEARCH_FIELDS, ResourceSpec, Window, specs_from_offline_manifest};

/// Store base tables.
pub const MIGRATIONS: &[Migration] = &[Migration {
    id: 1,
    module: "store",
    name: "store_meta",
    sql: "CREATE TABLE store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    ) STRICT;",
}];

/// Generic mirror bookkeeping (store range, part of [`migrations::registry`]).
/// Kept apart from [`MIGRATIONS`] so the base list stays `store_meta` only.
/// Per-resource row tables (`m_*`) and FTS tables (`s_*`) are created by
/// [`Store::register`], not by migrations: their shape follows the spec.
pub const MIRROR_MIGRATIONS: &[Migration] = &[Migration {
    id: 10,
    module: "store",
    name: "mirror_registry",
    sql: "CREATE TABLE store_resources (
        resource TEXT PRIMARY KEY,
        table_name TEXT NOT NULL UNIQUE,
        spec TEXT NOT NULL
    ) STRICT;
    CREATE TABLE store_cursors (
        resource TEXT PRIMARY KEY,
        cursor TEXT NOT NULL,
        complete INTEGER NOT NULL,
        synced_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE store_snapshots (
        resource TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL
    ) STRICT;",
}];

/// Readers opened next to the writer.
pub const READER_POOL_SIZE: usize = 3;

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
    writer: Mutex<Connection>,
    readers: ReaderPool,
    retention: Mutex<RetentionPolicy>,
    path: PathBuf,
}

impl fmt::Debug for Store {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Store")
            .field("path", &self.path)
            .field("readers", &self.readers.size)
            .finish()
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

        let size = if is_memory(&path) {
            0
        } else {
            READER_POOL_SIZE
        };
        let mut idle = Vec::with_capacity(size);
        for _ in 0..size {
            let reader = Connection::open(&path)?;
            unlock(&reader, key)?;
            reader.execute_batch(
                "PRAGMA query_only = ON;
                 PRAGMA foreign_keys = ON;
                 PRAGMA busy_timeout = 5000;",
            )?;
            idle.push(reader);
        }
        Ok(Self {
            writer: Mutex::new(conn),
            readers: ReaderPool {
                idle: Mutex::new(idle),
                ready: Condvar::new(),
                size,
            },
            retention: Mutex::new(RetentionPolicy::default()),
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Runs `f` on a pooled read-only connection, without a transaction.
    /// Waits when every reader is busy; never waits for the writer.
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        if self.readers.size == 0 {
            return f(&self.lock_writer());
        }
        let lease = self.readers.take();
        match &lease.conn {
            Some(conn) => f(conn),
            None => Err(SyncError::Store(rusqlite::Error::InvalidQuery)),
        }
    }

    /// Runs `f` in an IMMEDIATE transaction on the single writer; commits on
    /// `Ok`, rolls back on `Err`.
    pub fn write<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        let mut conn = self.lock_writer();
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

    pub fn retention(&self) -> RetentionPolicy {
        *self
            .retention
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Replaces the retention policy of this open store (not persisted).
    pub fn set_retention(&self, policy: RetentionPolicy) {
        *self
            .retention
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = policy;
    }

    fn lock_writer(&self) -> MutexGuard<'_, Connection> {
        // A panic inside `read`/`write` cannot leave a half-open transaction:
        // `Transaction` rolls back on drop. The connection stays usable.
        self.writer.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

struct ReaderPool {
    idle: Mutex<Vec<Connection>>,
    ready: Condvar,
    size: usize,
}

impl ReaderPool {
    fn take(&self) -> Lease<'_> {
        let mut idle = self.idle.lock().unwrap_or_else(PoisonError::into_inner);
        loop {
            if let Some(conn) = idle.pop() {
                return Lease {
                    pool: self,
                    conn: Some(conn),
                };
            }
            idle = self
                .ready
                .wait(idle)
                .unwrap_or_else(PoisonError::into_inner);
        }
    }
}

/// A borrowed reader; goes back to the pool on drop, also on panic.
struct Lease<'a> {
    pool: &'a ReaderPool,
    conn: Option<Connection>,
}

impl Drop for Lease<'_> {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            self.pool
                .idle
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(conn);
            self.pool.ready.notify_one();
        }
    }
}

fn is_memory(path: &Path) -> bool {
    let text = path.to_string_lossy();
    text.is_empty() || text == ":memory:" || text.starts_with("file::memory:")
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
