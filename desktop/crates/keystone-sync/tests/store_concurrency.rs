//! One writer, pooled readers: reads do not wait for an open write
//! transaction and only ever see whole committed pages.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use keystone_sync::store::raw::prelude::*;
use keystone_sync::store::{DbKey, ListQuery, READER_POOL_SIZE, ResourceSpec, Store};
use keystone_sync::wire::{Cursor, PullResourceResult, ResourceName, ResourceRow, Xid8};
use serde_json::{Map, json};
use uuid::Uuid;

const WAIT: Duration = Duration::from_secs(10);

fn res() -> ResourceName {
    ResourceName("parties".to_owned())
}

fn open(dir: &tempfile::TempDir) -> Arc<Store> {
    let store = Store::open(dir.path().join("pool.db"), &DbKey::from_bytes([9; 32])).unwrap();
    store
        .register(&ResourceSpec::new(res()).search(["name"]))
        .unwrap();
    Arc::new(store)
}

fn row(n: u128) -> ResourceRow {
    let mut fields = Map::new();
    fields.insert("name".into(), json!(format!("Cari {n}")));
    ResourceRow {
        id: Uuid::from_u128(n),
        version: Some(1),
        fields,
    }
}

#[test]
fn reads_proceed_while_the_writer_holds_a_transaction() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    store.put_row(&res(), &row(1)).unwrap();
    let table = store.mirror_table(&res()).unwrap().unwrap();

    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let writer = {
        let store = Arc::clone(&store);
        thread::spawn(move || {
            store.write(|tx| {
                tx.execute(
                    &format!("INSERT INTO \"{table}\" (id, data) VALUES (?1, ?2)"),
                    [
                        Uuid::from_u128(2).to_string(),
                        json!({"id": Uuid::from_u128(2)}).to_string(),
                    ],
                )?;
                started_tx.send(()).ok();
                // Hold the write transaction open until the reads are done.
                release_rx.recv_timeout(WAIT).ok();
                Ok(())
            })
        })
    };
    started_rx.recv_timeout(WAIT).expect("writer started");

    // Several readers at once, each finishing while the writer still waits.
    let (done_tx, done_rx) = mpsc::channel();
    for _ in 0..READER_POOL_SIZE + 2 {
        let store = Arc::clone(&store);
        let done_tx = done_tx.clone();
        thread::spawn(move || {
            let seen = (
                store.row_count(&res()),
                store
                    .get_row(&res(), Uuid::from_u128(2))
                    .map(|r| r.is_some()),
            );
            done_tx.send(seen).ok();
        });
    }
    for _ in 0..READER_POOL_SIZE + 2 {
        let (count, has_new) = done_rx
            .recv_timeout(WAIT)
            .expect("read finished while the writer held its transaction");
        assert_eq!(count.unwrap(), 1, "uncommitted row is invisible");
        assert!(!has_new.unwrap());
    }

    release_tx.send(()).unwrap();
    writer.join().unwrap().unwrap();
    assert_eq!(store.row_count(&res()).unwrap(), 2);
}

#[test]
fn readers_see_only_whole_pages() {
    const PAGES: u64 = 30;
    const PER_PAGE: u128 = 25;
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    let stop = Arc::new(AtomicBool::new(false));

    let readers: Vec<_> = (0..4)
        .map(|_| {
            let store = Arc::clone(&store);
            let stop = Arc::clone(&stop);
            thread::spawn(move || {
                let mut last = 0;
                let mut reads = 0u32;
                while !stop.load(Ordering::Relaxed) {
                    let page = store
                        .list(
                            &res(),
                            &ListQuery {
                                limit: Some(1),
                                ..ListQuery::default()
                            },
                        )
                        .unwrap();
                    assert_eq!(page.total % PER_PAGE as u64, 0, "partial page visible");
                    assert!(page.total >= last, "count went back");
                    last = page.total;
                    let hits = store
                        .list(
                            &res(),
                            &ListQuery {
                                search: Some("cari".into()),
                                limit: Some(1),
                                ..ListQuery::default()
                            },
                        )
                        .unwrap()
                        .total;
                    assert_eq!(hits % PER_PAGE as u64, 0, "partial FTS page visible");
                    reads += 1;
                }
                reads
            })
        })
        .collect();

    for p in 0..PAGES {
        let rows = (0..PER_PAGE)
            .map(|i| row(u128::from(p) * PER_PAGE + i + 1))
            .collect();
        apply(
            &store,
            &PullResourceResult {
                resource: res(),
                rows,
                tombstones: Vec::new(),
                next_cursor: Cursor {
                    txid: Xid8(p + 1),
                    after_id: None,
                    generation: 1,
                    session: None,
                },
                has_more: p + 1 < PAGES,
                reset: false,
                reset_reason: None,
            },
        )
        .unwrap();
    }
    stop.store(true, Ordering::Relaxed);
    let reads: u32 = readers.into_iter().map(|h| h.join().unwrap()).sum();
    assert!(reads > 0);
    assert_eq!(store.row_count(&res()).unwrap(), PAGES * PER_PAGE as u64);
    assert!(store.resource_state(&res()).unwrap().unwrap().complete);
}

/// Applies `page` against the current base, as the engine does.
fn apply(
    store: &Store,
    page: &PullResourceResult,
) -> keystone_sync::Result<keystone_sync::store::AppliedPage> {
    let base = store.pull_base(&page.resource)?;
    match store.apply_page(page, &base)? {
        keystone_sync::store::PageApply::Applied(applied) => Ok(applied),
        keystone_sync::store::PageApply::Stale => panic!("page unexpectedly stale"),
    }
}
