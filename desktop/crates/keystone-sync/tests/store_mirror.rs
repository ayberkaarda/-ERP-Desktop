//! Generic mirror: apply_page atomicity, reset and tombstones, cursors,
//! generated columns, Turkish FTS, manifest specs, snapshots.

use keystone_sync::store::raw::prelude::*;
use keystone_sync::store::{
    DbKey, Filter, FilterOp, ListQuery, ResourceSpec, SortKey, Store, specs_from_offline_manifest,
};
use keystone_sync::wire::{
    Cursor, PullResourceResult, ReadMode, ResetReason, ResourceName, ResourceRow, Timestamp,
    Tombstone, TombstoneReason, Xid8,
};
use serde_json::{Value, json};
use uuid::Uuid;

fn open(dir: &tempfile::TempDir) -> Store {
    Store::open(dir.path().join("mirror.db"), &DbKey::from_bytes([3; 32])).expect("open")
}

fn res(name: &str) -> ResourceName {
    ResourceName(name.to_owned())
}

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

fn row(n: u128, fields: Value) -> ResourceRow {
    let Value::Object(fields) = fields else {
        panic!("fields must be an object")
    };
    ResourceRow {
        id: id(n),
        version: Some(1),
        fields,
    }
}

fn cursor(txid: u64) -> Cursor {
    Cursor {
        txid: Xid8(txid),
        after_id: None,
        generation: 1,
        session: None,
    }
}

fn tombstone(resource: &str, n: u128) -> Tombstone {
    Tombstone {
        resource: res(resource),
        id: id(n),
        parent_id: None,
        sync_txid: Xid8(1),
        deleted_at: Timestamp("2026-10-01T00:00:00+00:00".into()),
        reason: TombstoneReason::Deleted,
    }
}

fn page(resource: &str, rows: Vec<ResourceRow>, txid: u64) -> PullResourceResult {
    PullResourceResult {
        resource: res(resource),
        rows,
        tombstones: Vec::new(),
        next_cursor: cursor(txid),
        has_more: false,
        reset: false,
        reset_reason: None,
    }
}

fn ids(store: &Store, resource: &str) -> Vec<Uuid> {
    let mut out: Vec<Uuid> = store
        .list(
            &res(resource),
            &ListQuery {
                limit: Some(1000),
                ..ListQuery::default()
            },
        )
        .expect("list")
        .rows
        .into_iter()
        .map(|r| r.id)
        .collect();
    out.sort();
    out
}

fn search(store: &Store, resource: &str, text: &str) -> Vec<Uuid> {
    store
        .list(
            &res(resource),
            &ListQuery {
                search: Some(text.to_owned()),
                ..ListQuery::default()
            },
        )
        .expect("search")
        .rows
        .into_iter()
        .map(|r| r.id)
        .collect()
}

fn parties_spec() -> ResourceSpec {
    ResourceSpec::new(res("parties")).search(["name", "code"])
}

#[test]
fn cursor_is_stored_per_resource_and_survives_reopen() {
    let dir = tempfile::tempdir().unwrap();
    {
        let store = open(&dir);
        assert_eq!(store.cursor(&res("parties")).unwrap(), None);
        let mut first = page("parties", vec![row(1, json!({"name": "A"}))], 10);
        first.has_more = true;
        first.next_cursor.after_id = Some(id(1));
        apply(&store, &first).unwrap();
        apply(
            &store,
            &page("units", vec![row(9, json!({"code": "KG"}))], 77),
        )
        .unwrap();

        let state = store.resource_state(&res("parties")).unwrap().unwrap();
        assert_eq!(state.cursor, first.next_cursor);
        assert!(!state.complete, "full download still paging");
    }
    let store = open(&dir);
    let parties = store.cursor(&res("parties")).unwrap().unwrap();
    assert_eq!(parties.txid, Xid8(10));
    assert_eq!(parties.after_id, Some(id(1)));
    assert_eq!(store.cursor(&res("units")).unwrap(), Some(cursor(77)));

    // The next page continues the download: no reset, cursor advances.
    let applied = apply(
        &store,
        &page("parties", vec![row(2, json!({"name": "B"}))], 11),
    )
    .unwrap();
    assert!(!applied.reset);
    assert_eq!(ids(&store, "parties"), [id(1), id(2)]);
    let state = store.resource_state(&res("parties")).unwrap().unwrap();
    assert_eq!(state.cursor, cursor(11));
    assert!(state.complete);

    assert_eq!(store.reset_resource(&res("parties")).unwrap(), 2);
    assert_eq!(store.cursor(&res("parties")).unwrap(), None);
    assert_eq!(store.cursor(&res("units")).unwrap(), Some(cursor(77)));
}

#[test]
fn apply_page_rolls_back_entirely_when_a_row_fails() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    store.register(&parties_spec()).unwrap();
    apply(
        &store,
        &page(
            "parties",
            vec![
                row(1, json!({"name": "Alfa"})),
                row(2, json!({"name": "Beta"})),
            ],
            10,
        ),
    )
    .unwrap();

    let table = store.mirror_table(&res("parties")).unwrap().unwrap();
    let poison = id(3).to_string();
    store
        .write(|tx| {
            tx.execute_batch(&format!(
                "CREATE TRIGGER poison BEFORE INSERT ON \"{table}\"
                 WHEN NEW.id = '{poison}' BEGIN SELECT RAISE(ABORT, 'poison'); END;"
            ))?;
            Ok(())
        })
        .unwrap();

    // Upsert, a failing row in the middle, a tombstone and a new cursor.
    let mut bad = page(
        "parties",
        vec![
            row(1, json!({"name": "Alfa Yeni"})),
            row(4, json!({"name": "Delta"})),
            row(3, json!({"name": "Gama"})),
            row(5, json!({"name": "Epsilon"})),
        ],
        20,
    );
    bad.tombstones = vec![tombstone("parties", 2)];
    assert!(apply(&store, &bad).is_err());

    assert_eq!(ids(&store, "parties"), [id(1), id(2)]);
    assert_eq!(store.cursor(&res("parties")).unwrap(), Some(cursor(10)));
    let one = store.get_row(&res("parties"), id(1)).unwrap().unwrap();
    assert_eq!(one.fields["name"], "Alfa");
    assert_eq!(search(&store, "parties", "alfa"), [id(1)]);
    assert!(search(&store, "parties", "delta").is_empty());
    assert!(search(&store, "parties", "yeni").is_empty());

    // A failing reset page must not drop the old copy either.
    let mut bad_reset = page("parties", vec![row(3, json!({"name": "Gama"}))], 30);
    bad_reset.reset = true;
    bad_reset.reset_reason = Some(ResetReason::CursorExpired);
    assert!(apply(&store, &bad_reset).is_err());
    assert_eq!(ids(&store, "parties"), [id(1), id(2)]);
    assert_eq!(store.cursor(&res("parties")).unwrap(), Some(cursor(10)));
}

#[test]
fn reset_and_tombstones_leave_no_stale_rows() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    store.register(&parties_spec()).unwrap();

    // A row written before the first pull (e.g. push data) does not survive
    // the full download: no cursor means page one clears the table.
    store
        .put_row(&res("parties"), &row(99, json!({"name": "Eski"})))
        .unwrap();
    let applied = apply(
        &store,
        &page(
            "parties",
            vec![
                row(1, json!({"name": "A"})),
                row(2, json!({"name": "B"})),
                row(3, json!({"name": "C"})),
            ],
            10,
        ),
    )
    .unwrap();
    assert!(applied.reset);
    assert_eq!(ids(&store, "parties"), [id(1), id(2), id(3)]);

    // Incremental: tombstones (one unknown) and an update.
    let mut inc = page("parties", vec![row(3, json!({"name": "C2"}))], 11);
    inc.tombstones = vec![tombstone("parties", 2), tombstone("parties", 42)];
    let applied = apply(&store, &inc).unwrap();
    assert_eq!(
        (applied.upserted, applied.removed, applied.reset),
        (1, 1, false)
    );
    assert_eq!(ids(&store, "parties"), [id(1), id(3)]);
    assert!(search(&store, "parties", "b").is_empty());
    assert_eq!(search(&store, "parties", "c2"), [id(3)]);

    // Reset paging over two pages: nothing from before survives.
    let mut reset = page("parties", vec![row(5, json!({"name": "E"}))], 50);
    reset.reset = true;
    reset.reset_reason = Some(ResetReason::VisibilityChanged);
    reset.has_more = true;
    let applied = apply(&store, &reset).unwrap();
    assert!(applied.reset);
    assert_eq!(ids(&store, "parties"), [id(5)]);
    assert!(
        !store
            .resource_state(&res("parties"))
            .unwrap()
            .unwrap()
            .complete
    );
    assert!(search(&store, "parties", "a").is_empty());

    apply(
        &store,
        &page("parties", vec![row(6, json!({"name": "F"}))], 51),
    )
    .unwrap();
    assert_eq!(ids(&store, "parties"), [id(5), id(6)]);
    assert!(
        store
            .resource_state(&res("parties"))
            .unwrap()
            .unwrap()
            .complete
    );

    assert!(store.remove_row(&res("parties"), id(5)).unwrap());
    assert!(!store.remove_row(&res("parties"), id(5)).unwrap());
    assert_eq!(store.get_row(&res("parties"), id(5)).unwrap(), None);
    assert_eq!(ids(&store, "parties"), [id(6)]);
}

#[test]
fn rows_round_trip_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    let original = row(
        7,
        json!({"name": "Çağ A.Ş.", "lines": [{"qty": "1.50"}], "note": null}),
    );
    store.put_row(&res("sales-quotes"), &original).unwrap();
    assert_eq!(
        store.get_row(&res("sales-quotes"), id(7)).unwrap(),
        Some(original)
    );
    assert_eq!(store.get_row(&res("sales-quotes"), id(8)).unwrap(), None);
    assert_eq!(store.get_row(&res("not-registered"), id(7)).unwrap(), None);
}

fn quotes_store(dir: &tempfile::TempDir) -> Store {
    let store = open(dir);
    store
        .register(
            &ResourceSpec::new(res("sales-quotes"))
                .indexed(["status", "total", "party.name"])
                .window("document_date", Some(30)),
        )
        .unwrap();
    let rows = vec![
        row(
            1,
            json!({"status": "draft", "total": 300, "document_date": "2026-10-01", "party": {"name": "Beta"}, "currency_code": "TRY"}),
        ),
        row(
            2,
            json!({"status": "approved", "total": 100, "document_date": "2026-10-03", "party": {"name": "Alfa"}, "currency_code": "USD"}),
        ),
        row(
            3,
            json!({"status": "draft", "total": 200, "document_date": "2026-10-02", "party": {"name": "Gama"}, "currency_code": "TRY"}),
        ),
        row(
            4,
            json!({"status": "draft", "total": 50.5, "document_date": "2026-09-20", "party": {"name": "Alfa"}, "currency_code": "EUR"}),
        ),
    ];
    apply(&store, &page("sales-quotes", rows, 5)).unwrap();
    store
}

fn list_ids(store: &Store, query: ListQuery) -> Vec<Uuid> {
    store
        .list(&res("sales-quotes"), &query)
        .unwrap()
        .rows
        .into_iter()
        .map(|r| r.id)
        .collect()
}

#[test]
fn generated_columns_filter_and_sort() {
    let dir = tempfile::tempdir().unwrap();
    let store = quotes_store(&dir);
    let table = store.mirror_table(&res("sales-quotes")).unwrap().unwrap();

    let (columns, indexes, plan) = store
        .read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT name, hidden FROM pragma_table_xinfo(?1) WHERE name LIKE 'f\\_%' ESCAPE '\\' ORDER BY name",
            )?;
            let columns = stmt
                .query_map([&table], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            let mut stmt = conn.prepare(
                "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1 AND name GLOB '*#f_*'",
            )?;
            let indexes: i64 = stmt.query_row([&table], |r| r.get(0))?;
            let mut stmt = conn.prepare(&format!(
                "EXPLAIN QUERY PLAN SELECT data FROM \"{table}\" WHERE \"f_status\" IS 'draft'"
            ))?;
            let plan = stmt
                .query_map([], |r| r.get::<_, String>(3))?
                .collect::<rusqlite::Result<Vec<_>>>()?
                .join(" | ");
            Ok((columns, indexes, plan))
        })
        .unwrap();
    // hidden = 2: VIRTUAL generated column.
    assert_eq!(
        columns,
        [
            ("f_document_date".to_owned(), 2),
            ("f_party__name".to_owned(), 2),
            ("f_status".to_owned(), 2),
            ("f_total".to_owned(), 2),
        ]
    );
    assert_eq!(indexes, 4);
    assert!(plan.contains("USING INDEX"), "plan: {plan}");

    // Default order for documents: newest window value first.
    assert_eq!(
        list_ids(&store, ListQuery::default()),
        [id(2), id(3), id(1), id(4)]
    );

    let drafts_by_total = ListQuery {
        filters: vec![Filter::eq("status", "draft")],
        sort: vec![SortKey::desc("total")],
        ..ListQuery::default()
    };
    assert_eq!(list_ids(&store, drafts_by_total), [id(1), id(3), id(4)]);

    let nested = ListQuery {
        filters: vec![Filter::eq("party.name", "Alfa")],
        sort: vec![SortKey::asc("document_date")],
        ..ListQuery::default()
    };
    assert_eq!(list_ids(&store, nested), [id(4), id(2)]);

    let range = ListQuery {
        filters: vec![
            Filter::new("document_date", FilterOp::Gte, "2026-10-01"),
            Filter::new("total", FilterOp::Lt, 250),
        ],
        ..ListQuery::default()
    };
    assert_eq!(list_ids(&store, range), [id(2), id(3)]);

    // Unindexed field: json_extract fallback, same semantics.
    let any_of = ListQuery {
        filters: vec![Filter::new(
            "currency_code",
            FilterOp::In,
            json!(["USD", "EUR"]),
        )],
        sort: vec![SortKey::asc("total")],
        ..ListQuery::default()
    };
    assert_eq!(list_ids(&store, any_of), [id(4), id(2)]);
    let missing = ListQuery {
        filters: vec![Filter::new("archived_at", FilterOp::IsNull, Value::Null)],
        ..ListQuery::default()
    };
    assert_eq!(list_ids(&store, missing).len(), 4);

    // Paging is stable and `total` ignores limit/offset.
    let paged = store
        .list(
            &res("sales-quotes"),
            &ListQuery {
                sort: vec![SortKey::asc("total")],
                limit: Some(2),
                offset: 1,
                ..ListQuery::default()
            },
        )
        .unwrap();
    assert_eq!(paged.total, 4);
    assert_eq!(
        paged.rows.iter().map(|r| r.id).collect::<Vec<_>>(),
        [id(2), id(3)]
    );

    // Field paths are inlined only after validation.
    let hostile = ListQuery {
        filters: vec![Filter::eq("status') OR 1=1 --", "x")],
        ..ListQuery::default()
    };
    assert!(store.list(&res("sales-quotes"), &hostile).is_err());
    let hostile_sort = ListQuery {
        sort: vec![SortKey::asc("total; DROP TABLE store_meta")],
        ..ListQuery::default()
    };
    assert!(store.list(&res("sales-quotes"), &hostile_sort).is_err());
}

#[test]
fn re_registering_adds_and_drops_columns_and_keeps_rows() {
    let dir = tempfile::tempdir().unwrap();
    let store = quotes_store(&dir);
    store
        .register(
            &ResourceSpec::new(res("sales-quotes"))
                .indexed(["currency_code"])
                .window("document_date", Some(30))
                .search(["party.name"]),
        )
        .unwrap();
    let table = store.mirror_table(&res("sales-quotes")).unwrap().unwrap();
    let columns: Vec<String> = store
        .read(|conn| {
            let mut stmt = conn.prepare(
                "SELECT name FROM pragma_table_xinfo(?1) WHERE name LIKE 'f\\_%' ESCAPE '\\' ORDER BY name",
            )?;
            Ok(stmt
                .query_map([&table], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?)
        })
        .unwrap();
    assert_eq!(columns, ["f_currency_code", "f_document_date"]);
    assert_eq!(store.row_count(&res("sales-quotes")).unwrap(), 4);

    let usd = ListQuery {
        filters: vec![Filter::eq("currency_code", "USD")],
        ..ListQuery::default()
    };
    assert_eq!(list_ids(&store, usd), [id(2)]);
    // FTS was built from the rows already present.
    let mut alfa = search(&store, "sales-quotes", "alfa");
    alfa.sort();
    assert_eq!(alfa, [id(2), id(4)]);
    assert_eq!(
        store
            .resource_spec(&res("sales-quotes"))
            .unwrap()
            .unwrap()
            .search,
        ["party.name"]
    );
}

#[test]
fn turkish_search_folds_dotted_and_dotless_i() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    store.register(&parties_spec()).unwrap();
    apply(
        &store,
        &page(
            "parties",
            vec![
                row(1, json!({"name": "İSTANBUL Ticaret A.Ş.", "code": "C-001"})),
                row(2, json!({"name": "Ankara Gıda"})),
                row(3, json!({"name": "IŞIK Ltd"})),
                row(4, json!({"name": "Şişli Çağrı Merkezi"})),
                row(5, json!({"name": "Kadıköy Istanbul Şube"})),
            ],
            1,
        ),
    )
    .unwrap();

    let sorted = |text: &str| {
        let mut out = search(&store, "parties", text);
        out.sort();
        out
    };
    for query in ["İSTANBUL", "istanbul", "ıstanbul", "Istanbul", "İst", "ist"] {
        assert_eq!(sorted(query), [id(1), id(5)], "query {query:?}");
    }
    for query in ["ışık", "IŞIK", "isik", "Işık"] {
        assert_eq!(sorted(query), [id(3)], "query {query:?}");
    }
    assert_eq!(sorted("sisli cagri"), [id(4)]);
    assert_eq!(sorted("ŞİŞLİ"), [id(4)]);
    assert_eq!(sorted("gida"), [id(2)]);
    assert_eq!(sorted("kadikoy istanbul"), [id(5)]);
    assert_eq!(sorted("C-001"), [id(1)]);
    assert!(sorted("izmir").is_empty());
    // Punctuation-only text adds no condition.
    assert_eq!(sorted("\"*").len(), 5);

    // Updates and tombstones keep the index in step.
    let mut next = page("parties", vec![row(1, json!({"name": "İzmir Ticaret"}))], 2);
    next.tombstones = vec![tombstone("parties", 5)];
    apply(&store, &next).unwrap();
    assert!(sorted("istanbul").is_empty());
    assert_eq!(sorted("İZMİR"), [id(1)]);

    // Search combines with filters.
    let combined = store
        .list(
            &res("parties"),
            &ListQuery {
                search: Some("ticaret".into()),
                filters: vec![Filter::eq("name", "Ankara Gıda")],
                ..ListQuery::default()
            },
        )
        .unwrap();
    assert_eq!(combined.total, 0);

    // A resource without search fields rejects a search.
    apply(
        &store,
        &page("units", vec![row(9, json!({"code": "KG"}))], 1),
    )
    .unwrap();
    assert!(
        store
            .list(
                &res("units"),
                &ListQuery {
                    search: Some("kg".into()),
                    ..ListQuery::default()
                }
            )
            .is_err()
    );
}

#[test]
fn specs_from_the_offline_manifest_register() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../contracts/offline-manifest.json"
    ))
    .expect("offline manifest");
    let specs = specs_from_offline_manifest(&json).unwrap();
    let find = |name: &str| {
        specs
            .iter()
            .find(|s| s.resource.as_str() == name)
            .unwrap_or_else(|| panic!("{name} missing"))
    };

    let quotes = find("sales-quotes");
    assert!(quotes.is_document());
    let window = quotes.window.as_ref().unwrap();
    assert_eq!(
        (window.field.as_str(), window.days),
        ("document_date", Some(30))
    );
    assert_eq!(quotes.read, ReadMode::LocalFirst);
    assert_eq!(find("sales-invoices").read, ReadMode::OnlineFirst);
    assert!(!find("parties").is_document());
    assert!(!find("items.variants").is_document());
    assert_eq!(find("stock-balances").read, ReadMode::OfflineFallback);
    assert!(find("stock-balances").search.is_empty());

    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    store.register_all(&specs).unwrap();
    assert_eq!(store.resource_specs().unwrap().len(), specs.len());
    // Registering again is a no-op.
    store.register_all(&specs).unwrap();
    assert_eq!(
        store.resource_spec(&res("sales-quotes")).unwrap().as_ref(),
        Some(quotes)
    );

    assert!(specs_from_offline_manifest("{\"resources\": 1}").is_err());
}

#[test]
fn snapshots_are_kept_with_their_fetch_time() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    let name = res("stock-balances");
    assert_eq!(store.snapshot(&name).unwrap(), None);
    let at = Timestamp("2026-10-26T09:00:00+03:00".into());
    store
        .put_snapshot(&name, &json!({"data": [{"item_id": "x", "qty": "4"}]}), &at)
        .unwrap();
    let later = Timestamp("2026-10-26T09:15:00+03:00".into());
    store
        .put_snapshot(&name, &json!({"data": []}), &later)
        .unwrap();
    let snap = store.snapshot(&name).unwrap().unwrap();
    assert_eq!(snap.fetched_at, later);
    assert_eq!(snap.data, json!({"data": []}));
}

#[test]
fn unsafe_resource_names_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    let bad = page("parties\"; DROP TABLE store_meta; --", vec![], 1);
    assert!(apply(&store, &bad).is_err());
    assert!(store.put_row(&res("Parties"), &row(1, json!({}))).is_err());
    assert!(store.resource_specs().unwrap().is_empty());
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
