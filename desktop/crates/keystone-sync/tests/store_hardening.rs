//! Review fixes: derived name collisions, re-entrant pool use, Unicode
//! consistency of search, migration SQL digests.

use std::sync::{Arc, Barrier, mpsc};
use std::thread;
use std::time::Duration;

use keystone_sync::SyncError;
use keystone_sync::store::{
    DbKey, ListQuery, MIGRATIONS, Migration, MirrorStore, READER_POOL_SIZE, ResourceSpec, Store,
};
use keystone_sync::wire::{ResourceName, ResourceRow};
use serde_json::{Value, json};
use uuid::Uuid;

const WAIT: Duration = Duration::from_secs(10);

fn key() -> DbKey {
    DbKey::from_bytes([4; 32])
}

fn res(name: &str) -> ResourceName {
    ResourceName(name.to_owned())
}

fn row(n: u128, fields: Value) -> ResourceRow {
    let Value::Object(fields) = fields else {
        panic!("object")
    };
    ResourceRow {
        id: Uuid::from_u128(n),
        version: None,
        fields,
    }
}

fn search(store: &Store, resource: &str, text: &str) -> Vec<u128> {
    let mut out: Vec<u128> = store
        .list(
            &res(resource),
            &ListQuery {
                search: Some(text.to_owned()),
                ..ListQuery::default()
            },
        )
        .unwrap()
        .rows
        .into_iter()
        .map(|r| r.id.as_u128())
        .collect();
    out.sort();
    out
}

#[test]
fn derived_names_never_collide_between_resources() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("names.db"), &key()).unwrap();
    // `m-foo` maps to table `m_m_2dfoo`; its FTS/index names must not be `foo`'s.
    // `foo-data` must not collide with FTS shadow tables of `foo`.
    for name in ["foo", "m-foo", "foo-data", "a.f-b"] {
        store
            .register(
                &ResourceSpec::new(res(name))
                    .indexed(["x", "b.f_c"])
                    .search(["name"]),
            )
            .unwrap();
    }
    store
        .put_row(&res("foo"), &row(1, json!({"name": "Elma", "x": 1})))
        .unwrap();
    store
        .put_row(&res("m-foo"), &row(2, json!({"name": "Armut", "x": 2})))
        .unwrap();
    store
        .put_row(&res("foo-data"), &row(3, json!({"name": "Kiraz"})))
        .unwrap();
    store
        .put_row(&res("a.f-b"), &row(4, json!({"name": "Ayva"})))
        .unwrap();

    assert_eq!(search(&store, "foo", "elma"), [1]);
    assert!(search(&store, "foo", "armut").is_empty());
    assert_eq!(search(&store, "m-foo", "armut"), [2]);
    assert_eq!(search(&store, "foo-data", "kiraz"), [3]);
    assert_eq!(search(&store, "a.f-b", "ayva"), [4]);

    // Every table owns both of its indexes.
    for name in ["foo", "m-foo", "foo-data", "a.f-b"] {
        let table = store.mirror_table(&res(name)).unwrap().unwrap();
        let n: i64 = store
            .read(|c| {
                Ok(c.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1 AND sql IS NOT NULL",
                    [&table],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(n, 2, "{name}");
    }
}

#[test]
fn search_matches_decomposed_and_precomposed_text() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("nfd.db"), &key()).unwrap();
    store
        .register(&ResourceSpec::new(res("items")).search(["name"]))
        .unwrap();
    store
        .put_row(&res("items"), &row(1, json!({"name": "s\u{0327}eker"})))
        .unwrap();
    store
        .put_row(&res("items"), &row(2, json!({"name": "Şeker"})))
        .unwrap();
    store
        .put_row(
            &res("items"),
            &row(3, json!({"name": "C\u{0327}ay I\u{0307}c\u{0327}"})),
        )
        .unwrap();
    for q in [
        "şeker",
        "s\u{0327}eker",
        "seker",
        "ŞEKER",
        "S\u{0327}EKER",
        "şek",
    ] {
        assert_eq!(search(&store, "items", q), [1, 2], "query {q:?}");
    }
    for q in ["çay iç", "c\u{0327}ay", "İç", "ic"] {
        assert_eq!(search(&store, "items", q), [3], "query {q:?}");
    }
}

/// Runs `f` on a thread and fails instead of hanging when it deadlocks.
fn within<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        tx.send(f()).ok();
    });
    rx.recv_timeout(WAIT).expect("deadlocked")
}

#[test]
fn nested_reads_on_a_busy_pool_fail_fast_instead_of_deadlocking() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(dir.path().join("nested.db"), &key()).unwrap());
    store
        .put_row(&res("parties"), &row(1, json!({"name": "A"})))
        .unwrap();

    let barrier = Arc::new(Barrier::new(READER_POOL_SIZE));
    let handles: Vec<_> = (0..READER_POOL_SIZE)
        .map(|_| {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                store.read(|_conn| {
                    barrier.wait(); // every reader is leased now
                    // Re-entrant use is rejected...
                    let nested = store.get_row(&res("parties"), Uuid::from_u128(1));
                    assert!(matches!(nested, Err(SyncError::Store(_))), "{nested:?}");
                    Ok(())
                })
            })
        })
        .collect();
    let results = within(move || {
        handles
            .into_iter()
            .map(|h| {
                h.join()
                    .map_err(|_| "panicked")
                    .and_then(|r| r.map_err(|_| "err"))
            })
            .collect::<Vec<_>>()
    });
    assert!(results.iter().all(Result::is_ok), "{results:?}");
}

#[test]
fn nested_write_is_rejected_instead_of_deadlocking() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(dir.path().join("nestedw.db"), &key()).unwrap());
    let inner = Arc::clone(&store);
    let outcome = within(move || {
        inner.write(|_| {
            let nested = inner.write(|_| Ok(()));
            Ok(nested.is_err())
        })
    });
    assert!(outcome.unwrap(), "nested write must fail");
}

#[test]
fn changed_migration_sql_is_rejected_on_open() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("digest.db");
    let original = Migration {
        id: 2,
        module: "store",
        name: "notes",
        sql: "CREATE TABLE notes (\n    id INTEGER PRIMARY KEY\n) STRICT;",
    };
    let list: Vec<&Migration> = MIGRATIONS.iter().chain([&original]).collect();
    drop(Store::open_with_migrations(&path, &key(), &list).unwrap());
    // Same id and name, CRLF line endings only: still the same migration.
    let crlf = Migration {
        sql: "CREATE TABLE notes (\r\n    id INTEGER PRIMARY KEY\r\n) STRICT;",
        ..original
    };
    let list_crlf: Vec<&Migration> = MIGRATIONS.iter().chain([&crlf]).collect();
    drop(Store::open_with_migrations(&path, &key(), &list_crlf).unwrap());

    let edited = Migration {
        sql: "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT) STRICT;",
        ..original
    };
    let list: Vec<&Migration> = MIGRATIONS.iter().chain([&edited]).collect();
    match Store::open_with_migrations(&path, &key(), &list) {
        Err(SyncError::Migration(m)) => assert!(m.contains("digest"), "{m}"),
        other => panic!("edited migration must be rejected, got {other:?}"),
    }

    // A ledger row whose module differs from the build is rejected too.
    let list: Vec<&Migration> = MIGRATIONS.iter().chain([&original]).collect();
    let store = Store::open_with_migrations(&path, &key(), &list).unwrap();
    store
        .write(|tx| {
            tx.execute(
                "UPDATE _keystone_migrations SET module = 'outbox' WHERE id = 2",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    drop(store);
    assert!(matches!(
        Store::open_with_migrations(&path, &key(), &list),
        Err(SyncError::Migration(_))
    ));
}

#[test]
fn greek_keeps_its_diacritics_like_unicode61() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("greek.db"), &key()).unwrap();
    store
        .register(&ResourceSpec::new(res("items")).search(["name"]))
        .unwrap();
    store
        .put_row(&res("items"), &row(1, json!({"name": "Ψάρι"})))
        .unwrap();
    store
        .put_row(&res("items"), &row(2, json!({"name": "ψα\u{0301}ρι"})))
        .unwrap();
    store
        .put_row(&res("items"), &row(3, json!({"name": "İstanbul Şeker"})))
        .unwrap();
    // Precomposed: same token both ways; the tonos is not removed (SQLite
    // strips Latin diacritics only).
    assert_eq!(search(&store, "items", "ψάρι"), [1]);
    assert_eq!(search(&store, "items", "ΨΆΡΙ"), [1]);
    assert!(!search(&store, "items", "ψαρι").contains(&1));
    // Decomposed Greek keeps its mark; index and query fold it the same way.
    assert!(search(&store, "items", "ψα\u{0301}ρι").contains(&2));
    // Turkish still folds.
    assert_eq!(search(&store, "items", "ıstanbul seker"), [3]);
}

#[test]
fn a_writer_waiting_on_another_thread_times_out() {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::open(dir.path().join("wait.db"), &key()).unwrap());
    store.set_lock_timeout(Duration::from_millis(200));
    let outer = Arc::clone(&store);
    let outcome = within(move || {
        outer.write(|_| {
            // Breaks the callback rule: waits on a write from another thread.
            let other = Arc::clone(&outer);
            let inner = thread::spawn(move || other.write(|_| Ok(())).is_err());
            Ok(inner.join().unwrap_or(false))
        })
    });
    assert!(
        outcome.unwrap(),
        "inner write must time out instead of hanging"
    );
    // The store is usable afterwards.
    store.write(|_| Ok(())).unwrap();
}

#[test]
fn a_ledger_without_digests_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("old-ledger.db");
    let store = Store::open(&path, &key()).unwrap();
    store
        .write(|tx| {
            tx.execute_batch("ALTER TABLE _keystone_migrations DROP COLUMN sql_digest;")?;
            Ok(())
        })
        .unwrap();
    drop(store);
    match Store::open(&path, &key()) {
        Err(SyncError::Migration(m)) => assert!(m.contains("delete"), "{m}"),
        other => panic!("digest-less ledger must be refused, got {other:?}"),
    }
}

#[test]
fn digest_normalizes_only_crlf() {
    use keystone_sync::store::migrations::sql_digest;
    assert_eq!(sql_digest("a\r\nb"), sql_digest("a\nb"));
    assert_ne!(sql_digest("a\rb"), sql_digest("ab"));
    assert_ne!(sql_digest("'x\ry'"), sql_digest("'xy'"));
}

#[test]
fn table_names_are_one_to_one() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("inject.db"), &key()).unwrap();
    // These used to share `m_a__b`; the second registration was refused.
    let pairs = [("a--b", "a.b"), ("a-.b", "a---b"), ("x-2d", "x--2d")];
    for (one, two) in pairs {
        store
            .register(&ResourceSpec::new(res(one)).search(["name"]))
            .unwrap();
        store
            .register(&ResourceSpec::new(res(two)).search(["name"]))
            .unwrap();
        let t1 = store.mirror_table(&res(one)).unwrap().unwrap();
        let t2 = store.mirror_table(&res(two)).unwrap().unwrap();
        assert_ne!(t1, t2, "{one} / {two}");
    }
    assert_eq!(
        store.mirror_table(&res("a--b")).unwrap().unwrap(),
        "m_a_2d_2db"
    );
    assert_eq!(store.mirror_table(&res("a.b")).unwrap().unwrap(), "m_a_2eb");
    store
        .put_row(&res("a--b"), &row(1, json!({"name": "Bir"})))
        .unwrap();
    store
        .put_row(&res("a.b"), &row(2, json!({"name": "Iki"})))
        .unwrap();
    assert_eq!(search(&store, "a--b", "bir"), [1]);
    assert_eq!(search(&store, "a.b", "iki"), [2]);
    assert!(search(&store, "a.b", "bir").is_empty());
}
