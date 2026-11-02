//! Stores opened at the same moment from many threads, starting with the
//! very first SQLite call of the process. This file holds a single test on
//! purpose: its own binary, so nothing else in the process touches SQLite
//! before the first round.

use std::sync::{Arc, Barrier};
use std::thread;

use keystone_sync::store::{DbKey, Store};

const THREADS: usize = 24;
const ROUNDS: usize = 20;

#[test]
fn stores_opened_together_from_a_cold_process_all_unlock() {
    for round in 0..ROUNDS {
        let barrier = Arc::new(Barrier::new(THREADS));
        let workers: Vec<_> = (0..THREADS)
            .map(|n| {
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    let dir = tempfile::tempdir().expect("tempdir");
                    let path = dir.path().join("first.db");
                    let key = DbKey::from_bytes([u8::try_from(n).unwrap_or(0) + 1; 32]);
                    barrier.wait();
                    let opened = Store::open(&path, &key).map(drop);
                    let reopened = Store::open(&path, &key).map(drop);
                    (opened, reopened)
                })
            })
            .collect();

        let failures: Vec<String> = workers
            .into_iter()
            .enumerate()
            .filter_map(|(n, worker)| match worker.join().expect("worker") {
                (Ok(()), Ok(())) => None,
                (opened, reopened) => Some(format!(
                    "round {round}, thread {n}: open {opened:?}, reopen {reopened:?}"
                )),
            })
            .collect();
        assert!(failures.is_empty(), "{failures:#?}");
    }
}
