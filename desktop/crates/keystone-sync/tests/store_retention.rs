//! Retention: document window boundaries, size cap, automatic prune after N
//! writes. Master data is never removed.

use keystone_sync::store::raw::prelude::*;
use keystone_sync::store::{DbKey, ListQuery, PruneReport, ResourceSpec, RetentionPolicy, Store};
use keystone_sync::wire::{ResourceName, ResourceRow};
use serde_json::{Value, json};
use uuid::Uuid;

fn res(name: &str) -> ResourceName {
    ResourceName(name.to_owned())
}

fn row(n: u128, fields: Value) -> ResourceRow {
    let Value::Object(fields) = fields else {
        panic!("fields must be an object")
    };
    ResourceRow {
        id: Uuid::from_u128(n),
        version: None,
        fields,
    }
}

fn ids(store: &Store, resource: &str) -> Vec<u128> {
    let mut out: Vec<u128> = store
        .list(
            &res(resource),
            &ListQuery {
                limit: Some(1000),
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

fn setup(dir: &tempfile::TempDir) -> Store {
    let store = Store::open(dir.path().join("retention.db"), &DbKey::from_bytes([5; 32])).unwrap();
    store.set_retention(RetentionPolicy {
        prune_every_writes: 0,
        ..RetentionPolicy::default()
    });
    store
        .register_all(&[
            ResourceSpec::new(res("sales-quotes"))
                .window("document_date", Some(30))
                .search(["name"]),
            ResourceSpec::new(res("exchange-rates")).window("rate_date", None),
            ResourceSpec::new(res("parties")).search(["name"]),
        ])
        .unwrap();
    store
}

#[test]
fn defaults_are_30_days_500_mb_5000_writes() {
    let policy = RetentionPolicy::default();
    assert_eq!(policy.window_days, 30);
    assert_eq!(policy.max_bytes, 500 * 1024 * 1024);
    assert_eq!(policy.prune_every_writes, 5000);
}

#[test]
fn window_boundaries_and_master_data() {
    let dir = tempfile::tempdir().unwrap();
    let store = setup(&dir);
    let quotes = res("sales-quotes");
    for (n, date) in [
        (1, json!("2026-09-26")),                // exactly 30 days: kept
        (2, json!("2026-09-25")),                // 31 days: removed
        (3, json!("2026-09-25T23:59:59+03:00")), // date part 31 days: removed
        (4, json!("2026-09-26T00:00:00+00:00")), // date part 30 days: kept
        (5, Value::Null),                        // unknown date: kept
        (6, json!("2026-10-26")),                // today: kept
        (7, json!("2027-01-01")),                // future: kept
        (8, json!("2025-01-01")),                // old: removed
    ] {
        store
            .put_row(
                &quotes,
                &row(n, json!({"document_date": date, "name": format!("q{n}")})),
            )
            .unwrap();
    }
    // Master data with old dates and no window is never pruned.
    store
        .put_row(
            &res("parties"),
            &row(
                100,
                json!({"name": "Eski Cari", "document_date": "2000-01-01"}),
            ),
        )
        .unwrap();
    // Window without own days: policy window (here 10 days).
    store.set_retention(RetentionPolicy {
        window_days: 10,
        prune_every_writes: 0,
        ..RetentionPolicy::default()
    });
    for (n, date) in [(20, "2026-10-16"), (21, "2026-10-15")] {
        store
            .put_row(&res("exchange-rates"), &row(n, json!({"rate_date": date})))
            .unwrap();
    }

    let report = store.prune_at("2026-10-26").unwrap();
    assert_eq!(
        report,
        PruneReport {
            expired: 4,
            over_size: 0
        }
    );
    assert_eq!(ids(&store, "sales-quotes"), [1, 4, 5, 6, 7]);
    assert_eq!(ids(&store, "exchange-rates"), [20]);
    assert_eq!(ids(&store, "parties"), [100]);
    // FTS rows went with them.
    let found = store
        .list(
            &quotes,
            &ListQuery {
                search: Some("q2".into()),
                ..ListQuery::default()
            },
        )
        .unwrap();
    assert_eq!(found.total, 0);

    // Idempotent.
    assert_eq!(
        store.prune_at("2026-10-26").unwrap(),
        PruneReport::default()
    );
    assert!(store.prune_at("26.10.2026").is_err());
}

#[test]
fn size_cap_removes_oldest_documents_only() {
    let dir = tempfile::tempdir().unwrap();
    let store = setup(&dir);
    let filler = "x".repeat(2000);
    for n in 0..300u128 {
        let day = 1 + (n % 28);
        store
            .put_row(
                &res("sales-quotes"),
                &row(
                    n,
                    json!({"document_date": format!("2999-01-{day:02}"), "pad": filler}),
                ),
            )
            .unwrap();
    }
    store
        .put_row(&res("sales-quotes"), &row(999, json!({"pad": filler})))
        .unwrap();
    for n in 1000..1010u128 {
        store
            .put_row(
                &res("parties"),
                &row(n, json!({"name": "Cari", "pad": filler})),
            )
            .unwrap();
    }
    let used = store.used_bytes().unwrap();
    assert!(used > 600_000, "used {used}");

    // Generous cap: nothing over size.
    store.set_retention(RetentionPolicy {
        prune_every_writes: 0,
        ..RetentionPolicy::default()
    });
    assert_eq!(
        store.prune_at("2026-10-26").unwrap(),
        PruneReport::default()
    );

    // Cap a bit under the current size: only some of the oldest go.
    store.set_retention(RetentionPolicy {
        max_bytes: used - 150_000,
        prune_every_writes: 0,
        ..RetentionPolicy::default()
    });
    let report = store.prune_at("2026-10-26").unwrap();
    assert!(report.over_size > 0 && report.over_size < 301, "{report:?}");
    let left = ids(&store, "sales-quotes");
    assert!(left.contains(&999), "null-dated rows go last");
    let oldest_left: Vec<String> = store
        .list(
            &res("sales-quotes"),
            &ListQuery {
                limit: Some(1000),
                ..ListQuery::default()
            },
        )
        .unwrap()
        .rows
        .iter()
        .filter_map(|r| {
            r.fields
                .get("document_date")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect();
    let min_left = oldest_left.iter().min().cloned().unwrap();
    assert!(
        min_left.as_str() > "2999-01-01",
        "oldest went first, min left {min_left}"
    );

    // Tiny cap: every document goes, master data stays.
    store.set_retention(RetentionPolicy {
        max_bytes: 1,
        prune_every_writes: 0,
        ..RetentionPolicy::default()
    });
    store.prune_at("2026-10-26").unwrap();
    assert!(ids(&store, "sales-quotes").is_empty());
    assert!(ids(&store, "exchange-rates").is_empty());
    assert_eq!(ids(&store, "parties").len(), 10);
}

#[test]
fn prunes_automatically_after_the_write_budget() {
    let dir = tempfile::tempdir().unwrap();
    let store = setup(&dir);
    store.set_retention(RetentionPolicy {
        prune_every_writes: 3,
        ..RetentionPolicy::default()
    });
    let quotes = res("sales-quotes");
    store
        .put_row(&quotes, &row(1, json!({"document_date": "2000-01-01"})))
        .unwrap();
    store
        .put_row(&quotes, &row(2, json!({"document_date": "2999-01-01"})))
        .unwrap();
    assert_eq!(
        ids(&store, "sales-quotes"),
        [1, 2],
        "budget not reached yet"
    );
    store
        .put_row(&res("parties"), &row(3, json!({"name": "Cari"})))
        .unwrap();
    assert_eq!(ids(&store, "sales-quotes"), [2], "third write prunes");

    // Counter restarted: two more writes do not prune.
    store
        .put_row(&quotes, &row(4, json!({"document_date": "2000-01-01"})))
        .unwrap();
    store
        .put_row(&quotes, &row(5, json!({"document_date": "2999-01-02"})))
        .unwrap();
    assert_eq!(ids(&store, "sales-quotes"), [2, 4, 5]);
    assert!(store.remove_row(&quotes, Uuid::from_u128(5)).unwrap());
    assert_eq!(ids(&store, "sales-quotes"), [2]);
    assert_eq!(ids(&store, "parties"), [3]);
    assert!(
        store
            .get_row(&quotes, Uuid::from_u128(2))
            .unwrap()
            .is_some()
    );
}
