//! SQLCipher encryption and the migration registry.

use std::fs;

use keystone_sync::SyncError;
use keystone_sync::store::{DbKey, MIGRATIONS, Migration, Store};
use rusqlite::Connection;

fn key(byte: u8) -> DbKey {
    DbKey::from_bytes([byte; 32])
}

const NOTE_TABLE: Migration = Migration {
    id: 2,
    module: "store",
    name: "test_notes",
    sql: "CREATE TABLE test_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;",
};

const NOTE_INDEX: Migration = Migration {
    id: 3,
    module: "store",
    name: "test_notes_body",
    sql: "CREATE INDEX test_notes_body ON test_notes (body);",
};

#[test]
fn opens_with_its_key_and_rejects_any_other() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("keystone.db");

    {
        let store = Store::open(&path, &key(7)).expect("create");
        store
            .write(|tx| {
                tx.execute(
                    "INSERT INTO store_meta (key, value) VALUES ('probe', 'gizli-değer')",
                    [],
                )?;
                Ok(())
            })
            .expect("write");
    }

    let store = Store::open(&path, &key(7)).expect("reopen with the same key");
    let value: String = store
        .read(|conn| {
            Ok(conn.query_row(
                "SELECT value FROM store_meta WHERE key = 'probe'",
                [],
                |r| r.get(0),
            )?)
        })
        .expect("read");
    assert_eq!(value, "gizli-değer");
    drop(store);

    match Store::open(&path, &key(8)) {
        Err(SyncError::StoreKeyInvalid) => {}
        other => panic!("wrong key must be rejected, got {other:?}"),
    }

    // Without a key the file is not a readable SQLite database.
    let plain = Connection::open(&path).expect("open file");
    assert!(
        plain
            .query_row("SELECT count(*) FROM sqlite_master", [], |r| r
                .get::<_, i64>(0))
            .is_err()
    );
    drop(plain);

    let header = fs::read(&path).expect("file bytes");
    assert!(
        !header.starts_with(b"SQLite format 3\0"),
        "file is plaintext"
    );
}

#[test]
fn migrations_advance_user_version_once() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("migrate.db");
    let base: Vec<&Migration> = MIGRATIONS.iter().collect();

    let store = Store::open_with_migrations(&path, &key(1), &base).expect("open");
    assert_eq!(store.user_version().unwrap(), 1);
    drop(store);

    let mut more = base.clone();
    more.push(&NOTE_TABLE);
    more.push(&NOTE_INDEX);
    let store = Store::open_with_migrations(&path, &key(1), &more).expect("upgrade");
    assert_eq!(store.user_version().unwrap(), 3);
    let ledger = store.applied_migrations().unwrap();
    assert_eq!(
        ledger,
        [
            (1, "store_meta".to_owned()),
            (2, "test_notes".to_owned()),
            (3, "test_notes_body".to_owned()),
        ]
    );
    drop(store);

    // Re-opening applies nothing new.
    let store = Store::open_with_migrations(&path, &key(1), &more).expect("reopen");
    assert_eq!(store.user_version().unwrap(), 3);
    assert_eq!(store.applied_migrations().unwrap().len(), 3);
    drop(store);

    // A build that lacks an applied migration must not open the database.
    match Store::open_with_migrations(&path, &key(1), &base) {
        Err(SyncError::Migration(_)) => {}
        other => panic!("unknown applied migration must fail, got {other:?}"),
    }
}

#[test]
fn failed_migration_rolls_back_and_keeps_user_version() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("broken.db");
    let broken = Migration {
        id: 2,
        module: "store",
        name: "broken",
        sql: "CREATE TABLE half_done (id INTEGER); THIS IS NOT SQL;",
    };
    let list: Vec<&Migration> = MIGRATIONS.iter().chain([&broken]).collect();
    assert!(Store::open_with_migrations(&path, &key(2), &list).is_err());

    let store = Store::open_with_migrations(&path, &key(2), &[&MIGRATIONS[0]]).expect("open");
    assert_eq!(store.user_version().unwrap(), 1);
    let half_done: i64 = store
        .read(|conn| {
            Ok(conn.query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = 'half_done'",
                [],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(half_done, 0);
}
