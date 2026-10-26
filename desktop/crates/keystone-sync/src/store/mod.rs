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

use std::cell::RefCell;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use rusqlite::{Connection, ErrorCode as SqliteCode, OpenFlags, Transaction, TransactionBehavior};

use crate::error::{Result, SyncError};
pub use fold::{fold, match_expression};
pub use migrations::{Migration, RANGES};
pub use mirror::{AppliedPage, MirrorStore, PageApply, PullBase, ResourceState, Snapshot};
pub use query::{
    Filter, FilterOp, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, ListPage, ListQuery, LocalCopy,
    ReadRoute, SortKey, read_route,
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
/// Per-resource row tables (`m_*`) and FTS tables (`m_*#fts`) are created by
/// [`Store::register`], not by migrations: their shape follows the spec.
/// Not shipped yet, so this one migration still holds the whole layout;
/// databases from earlier dev builds must be deleted (no upgrade path).
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
    ) STRICT;
    CREATE TABLE store_epochs (
        resource TEXT PRIMARY KEY,
        epoch INTEGER NOT NULL
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
    /// Who holds `writer`; waited on with a timeout (std `Mutex` has none).
    writer_gate: Gate,
    lock_timeout: Mutex<Duration>,
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
            let reader = Connection::open_with_flags(
                &path,
                OpenFlags::SQLITE_OPEN_READ_ONLY
                    | OpenFlags::SQLITE_OPEN_URI
                    | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?;
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
            writer_gate: Gate::default(),
            lock_timeout: Mutex::new(LOCK_WAIT),
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
    /// Waits up to the lock timeout ([`LOCK_WAIT`] by default) for a free
    /// reader, then fails with `STORE_ERROR` (busy); never waits for the
    /// writer.
    ///
    /// **Callback rule** (also for [`Store::write`] and everything built on
    /// them): a callback must not wait on another call into a store, on the
    /// same thread or on another thread it hands work to. Same-thread nesting
    /// is rejected with `STORE_ERROR`; waiting across threads is caught
    /// only by the lock timeout. Inside a callback use the `*_on(conn, ..)`
    /// functions on the connection you were given.
    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let _entry = Entry::enter(self)?;
        if self.readers.size == 0 {
            let lease = self.lock_writer()?;
            return f(&lease.conn);
        }
        let lease = self.readers.take(self.lock_timeout())?;
        match &lease.conn {
            Some(conn) => f(conn),
            None => Err(SyncError::Store(rusqlite::Error::InvalidQuery)),
        }
    }

    /// Runs `f` in an IMMEDIATE transaction on the single writer; commits on
    /// `Ok`, rolls back on `Err`. Waits up to the lock timeout for the writer.
    /// The callback rule of [`Store::read`] applies.
    pub fn write<T>(&self, f: impl FnOnce(&Transaction<'_>) -> Result<T>) -> Result<T> {
        let _entry = Entry::enter(self)?;
        let mut lease = self.lock_writer()?;
        let tx = lease
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
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

    /// Wait limit for the writer and for a free reader.
    pub fn lock_timeout(&self) -> Duration {
        *self
            .lock_timeout
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    pub fn set_lock_timeout(&self, timeout: Duration) {
        *self
            .lock_timeout
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = timeout;
    }

    fn lock_writer(&self) -> Result<WriterLease<'_>> {
        let gate = &self.writer_gate;
        let deadline = Instant::now() + self.lock_timeout();
        let mut busy = gate.busy.lock().unwrap_or_else(PoisonError::into_inner);
        while *busy {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(sqlite_failure(
                    rusqlite::ffi::SQLITE_BUSY,
                    "the writer did not become free in time",
                ));
            }
            busy = gate
                .freed
                .wait_timeout(busy, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        *busy = true;
        drop(busy);
        // A panic inside `read`/`write` cannot leave a half-open transaction:
        // `Transaction` rolls back on drop. The connection stays usable.
        Ok(WriterLease {
            gate,
            conn: self.writer.lock().unwrap_or_else(PoisonError::into_inner),
        })
    }
}

struct ReaderPool {
    idle: Mutex<Vec<Connection>>,
    ready: Condvar,
    size: usize,
}

impl ReaderPool {
    fn take(&self, timeout: Duration) -> Result<Lease<'_>> {
        let deadline = Instant::now() + timeout;
        let mut idle = self.idle.lock().unwrap_or_else(PoisonError::into_inner);
        loop {
            if let Some(conn) = idle.pop() {
                return Ok(Lease {
                    pool: self,
                    conn: Some(conn),
                });
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(sqlite_failure(
                    rusqlite::ffi::SQLITE_BUSY,
                    "no reader became free in time",
                ));
            }
            idle = self
                .ready
                .wait_timeout(idle, left)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }
}

/// Default wait limit for the writer and for a free reader.
pub const LOCK_WAIT: Duration = Duration::from_secs(30);

#[derive(Default)]
struct Gate {
    busy: Mutex<bool>,
    freed: Condvar,
}

/// The writer connection; frees the gate on drop, also on panic.
struct WriterLease<'a> {
    gate: &'a Gate,
    conn: MutexGuard<'a, Connection>,
}

impl Drop for WriterLease<'_> {
    fn drop(&mut self) {
        *self
            .gate
            .busy
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = false;
        self.gate.freed.notify_one();
    }
}

thread_local! {
    /// Stores this thread is inside a `read`/`write` callback of.
    static ACTIVE: RefCell<Vec<usize>> = const { RefCell::new(Vec::new()) };
}

/// Marks this thread as inside a callback of one store; rejects nesting,
/// which could otherwise wait forever on the pool or the writer mutex.
struct Entry(usize);

impl Entry {
    fn enter(store: &Store) -> Result<Self> {
        let id = std::ptr::from_ref(store) as usize;
        ACTIVE.with(|active| {
            let mut active = active.borrow_mut();
            if active.contains(&id) {
                return Err(sqlite_failure(
                    rusqlite::ffi::SQLITE_MISUSE,
                    "re-entrant store call; use the *_on(conn, ..) functions",
                ));
            }
            active.push(id);
            Ok(Entry(id))
        })
    }
}

impl Drop for Entry {
    fn drop(&mut self) {
        ACTIVE.with(|active| active.borrow_mut().retain(|id| *id != self.0));
    }
}

fn sqlite_failure(code: std::ffi::c_int, message: &str) -> SyncError {
    SyncError::Store(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(code),
        Some(message.to_owned()),
    ))
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
