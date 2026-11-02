//! Typed list queries of the manifest `query` sections on the mirror: SQL
//! (`ks_key`/`ks_test` on the pooled readers) gives the order and rows the
//! in-memory rules give, field paths cannot reach SQL, and the manifest
//! parser reads `query` only from manifests that define it.

use keystone_sync::store::raw::prelude::*;
use keystone_sync::store::{
    Condition, DbKey, FilterMatch, ListQuery, OrderKey, ResourceSpec, SortType, Store, Test,
    TextSearch, ValueType, offline_manifest, row_matches, specs_from_offline_manifest,
};
use keystone_sync::wire::{Cursor, PullResourceResult, ResourceName, ResourceRow, Xid8};
use serde_json::{Value, json};
use uuid::Uuid;

fn res(name: &str) -> ResourceName {
    ResourceName(name.to_owned())
}

fn row(n: u128, fields: Value) -> ResourceRow {
    ResourceRow {
        id: Uuid::from_u128(n),
        version: Some(1),
        fields: fields.as_object().cloned().unwrap(),
    }
}

fn rows() -> Vec<ResourceRow> {
    vec![
        row(
            7,
            json!({"name": "Çağ", "total": "96.00", "at": "2026-10-27T10:00:00+03:00", "day": "2026-10-02", "on": true, "n": 3, "roles": ["customer"], "lines": [{"item_id": "AA"}]}),
        ),
        row(
            2,
            json!({"name": "cag", "total": "288.00", "at": "2026-10-27T08:00:00Z", "day": null, "on": false, "n": -1, "roles": []}),
        ),
        row(
            5,
            json!({"name": "Zeytin", "total": "9007199254740993.00", "at": "2026-10-27T06:59:59Z", "day": "2026-10-01", "on": true, "n": 10, "roles": ["supplier", "customer"], "lines": [{"item_id": "bb"}]}),
        ),
        row(
            3,
            json!({"name": "ılık", "total": "9007199254740992.99", "day": "2026-10-03", "n": 2, "roles": ["supplier"]}),
        ),
        row(
            9,
            json!({"name": null, "total": "-5", "at": "2026-10-26T23:00:00-05:00", "day": "2026-10-02", "on": false, "n": 3}),
        ),
        row(
            4,
            json!({"name": "İnci", "total": "0.5", "at": "2026-10-27T07:00:00Z", "day": "2026-10-02", "on": true, "n": 0, "roles": ["customer"], "lines": [{"item_id": "aa"}, {"item_id": "cc"}]}),
        ),
    ]
}

fn store(dir: &tempfile::TempDir) -> Store {
    let store = Store::open(dir.path().join("typed.db"), &DbKey::from_bytes([9; 32])).unwrap();
    store
        .register(&ResourceSpec::new(res("things")).search(["name"]))
        .unwrap();
    let page = PullResourceResult {
        resource: res("things"),
        rows: rows(),
        tombstones: Vec::new(),
        next_cursor: Cursor {
            txid: Xid8(1),
            after_id: None,
            generation: 1,
            session: None,
        },
        has_more: false,
        reset: false,
        reset_reason: None,
    };
    let base = store.pull_base(&page.resource).unwrap();
    store.apply_page(&page, &base).unwrap();
    store
}

fn listed(store: &Store, query: &ListQuery) -> Vec<u128> {
    store
        .list(&res("things"), query)
        .unwrap()
        .rows
        .iter()
        .map(|r| r.id.as_u128())
        .collect()
}

fn ordered(keys: Vec<OrderKey>) -> ListQuery {
    ListQuery {
        order: Some(keys),
        ..ListQuery::default()
    }
}

fn key(field: &str, kind: SortType, descending: bool) -> OrderKey {
    OrderKey {
        field: field.into(),
        kind,
        descending,
    }
}

/// Order the in-memory rule gives.
fn in_memory(keys: &[OrderKey], conditions: &[Condition], text: Option<&TextSearch>) -> Vec<u128> {
    let mut all: Vec<ResourceRow> = rows()
        .into_iter()
        .filter(|r| row_matches(r, conditions, text))
        .collect();
    all.sort_by(|a, b| {
        for k in keys {
            let ka = keystone_sync::store::sort_key(k.kind, a.fields.get(&k.field));
            let kb = keystone_sync::store::sort_key(k.kind, b.fields.get(&k.field));
            let order =
                keystone_sync::store::compare_keys(ka.as_deref(), kb.as_deref(), k.descending);
            if order.is_ne() {
                return order;
            }
        }
        a.id.cmp(&b.id)
    });
    all.iter().map(|r| r.id.as_u128()).collect()
}

#[test]
fn every_sort_type_orders_in_sql_as_in_memory_both_ways() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(&dir);
    let expected: [(&str, SortType, [u128; 6]); 6] = [
        // Turkish letters beside their base, case after letters, null last.
        ("name", SortType::Text, [2, 7, 4, 3, 5, 9]),
        // Exact decimals: 2^53 + 1 after 2^53 - 0.01.
        ("total", SortType::Decimal, [9, 4, 7, 2, 3, 5]),
        // Instants in UTC, missing last.
        ("at", SortType::Datetime, [9, 5, 4, 7, 2, 3]),
        ("day", SortType::Date, [5, 4, 7, 9, 3, 2]),
        ("on", SortType::Bool, [2, 9, 4, 5, 7, 3]),
        ("n", SortType::Integer, [2, 4, 3, 7, 9, 5]),
    ];
    for (field, kind, asc) in expected {
        let up = listed(&store, &ordered(vec![key(field, kind, false)]));
        assert_eq!(up, asc, "{field} asc");
        assert_eq!(
            up,
            in_memory(&[key(field, kind, false)], &[], None),
            "{field}"
        );
        let down = listed(&store, &ordered(vec![key(field, kind, true)]));
        assert_eq!(
            down,
            in_memory(&[key(field, kind, true)], &[], None),
            "{field} desc"
        );
    }
    // Nulls: last ascending, first descending; ties by id ascending.
    assert_eq!(
        listed(&store, &ordered(vec![key("day", SortType::Date, true)])),
        [2, 3, 4, 7, 9, 5]
    );
    let two = vec![
        key("on", SortType::Bool, true),
        key("n", SortType::Integer, false),
    ];
    assert_eq!(
        listed(&store, &ordered(two.clone())),
        in_memory(&two, &[], None)
    );
    assert_eq!(listed(&store, &ordered(Vec::new())), [2, 3, 4, 5, 7, 9]);
}

#[test]
fn conditions_and_search_filter_in_sql_as_in_memory() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(&dir);
    let strings = |v: &[&str]| v.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>();
    let cases: Vec<(Vec<Condition>, Option<TextSearch>, Vec<u128>)> = vec![
        (
            vec![Condition {
                field: "roles".into(),
                test: Test::AnyOf {
                    kind: ValueType::String,
                    element: None,
                    values: strings(&["customer"]),
                },
            }],
            None,
            vec![4, 5, 7],
        ),
        (
            vec![Condition {
                field: "lines".into(),
                test: Test::AnyOf {
                    kind: ValueType::Uuid,
                    element: Some("item_id".into()),
                    values: strings(&["aa"]),
                },
            }],
            None,
            vec![4, 7],
        ),
        (
            vec![Condition {
                field: "on".into(),
                test: Test::Eq {
                    kind: ValueType::Bool,
                    values: strings(&["0"]),
                },
            }],
            None,
            vec![2, 9],
        ),
        (
            vec![
                Condition {
                    field: "day".into(),
                    test: Test::Gte {
                        kind: ValueType::Date,
                        value: "2026-10-02".into(),
                    },
                },
                Condition {
                    field: "n".into(),
                    test: Test::Lte {
                        kind: ValueType::Integer,
                        value: "2".into(),
                    },
                },
            ],
            None,
            vec![3, 4],
        ),
        (
            vec![Condition {
                field: "name".into(),
                test: Test::Eq {
                    kind: ValueType::String,
                    values: strings(&["cag", "Zeytin"]),
                },
            }],
            None,
            vec![2, 5],
        ),
        (
            Vec::new(),
            Some(TextSearch {
                fields: vec!["name".into(), "total".into()],
                text: "CAG".into(),
            }),
            vec![2, 7],
        ),
        (
            Vec::new(),
            Some(TextSearch {
                fields: vec!["name".into(), "total".into()],
                text: "ILIK".into(),
            }),
            vec![3],
        ),
        (
            Vec::new(),
            Some(TextSearch {
                fields: vec!["total".into()],
                text: ".00".into(),
            }),
            vec![2, 5, 7],
        ),
        (
            Vec::new(),
            Some(TextSearch {
                fields: Vec::new(),
                text: "x".into(),
            }),
            Vec::new(),
        ),
    ];
    for (conditions, text, expected) in cases {
        let query = ListQuery {
            conditions: conditions.clone(),
            text: text.clone(),
            order: Some(Vec::new()),
            ..ListQuery::default()
        };
        let label = format!("{conditions:?} {text:?}");
        assert_eq!(listed(&store, &query), expected, "{label}");
        assert_eq!(
            in_memory(&[], &conditions, text.as_ref()),
            expected,
            "{label}"
        );
        let page = store.list(&res("things"), &query).unwrap();
        assert_eq!(page.total, expected.len() as u64, "{label}");
    }
}

#[test]
fn paging_follows_the_typed_order() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(&dir);
    let all = in_memory(&[key("total", SortType::Decimal, true)], &[], None);
    let mut seen = Vec::new();
    for offset in [0, 2, 4] {
        let query = ListQuery {
            order: Some(vec![key("total", SortType::Decimal, true)]),
            limit: Some(2),
            offset,
            ..ListQuery::default()
        };
        let page = store.list(&res("things"), &query).unwrap();
        assert_eq!(page.total, 6);
        seen.extend(page.rows.iter().map(|r| r.id.as_u128()));
    }
    assert_eq!(seen, all);
}

#[test]
fn field_paths_never_reach_sql() {
    let dir = tempfile::tempdir().unwrap();
    let store = store(&dir);
    let hostile = [
        "name') OR 1=1 --",
        "name\" DESC",
        "$.name",
        "name[0]",
        "Name",
        "a__b",
        "",
        "na me",
    ];
    for field in hostile {
        let condition = ListQuery {
            conditions: vec![Condition {
                field: field.into(),
                test: Test::Eq {
                    kind: ValueType::String,
                    values: vec!["x".into()],
                },
            }],
            ..ListQuery::default()
        };
        assert!(store.list(&res("things"), &condition).is_err(), "{field}");
        let order = ordered(vec![key(field, SortType::Text, false)]);
        assert!(store.list(&res("things"), &order).is_err(), "{field}");
        let search = ListQuery {
            text: Some(TextSearch {
                fields: vec![field.into()],
                text: "x".into(),
            }),
            ..ListQuery::default()
        };
        assert!(store.list(&res("things"), &search).is_err(), "{field}");
    }
    // A hostile value is only compared.
    let value = ListQuery {
        conditions: vec![Condition {
            field: "name".into(),
            test: Test::Eq {
                kind: ValueType::String,
                values: vec!["x' OR '1'='1".into()],
            },
        }],
        ..ListQuery::default()
    };
    assert!(listed(&store, &value).is_empty());
    assert_eq!(listed(&store, &ListQuery::default()).len(), 6);
}

fn manifest(version: Option<u64>, query: Value) -> String {
    let mut root = json!({
        "resources": [{
            "resource": "parties", "read": "local-first", "source": "pull",
            "query": query,
            "children": [{"resource": "parties.contacts", "query": {"sort": {"name": {"type": "text"}}}}]
        }]
    });
    if let Some(version) = version {
        root["manifest_version"] = json!(version);
    }
    root.to_string()
}

#[test]
fn query_sections_are_read_from_version_3_manifests_only() {
    let query = json!({
        "default_sort": ["-name"],
        "sort": {"name": {"type": "text"}, "since": {"field": "created_at", "type": "datetime"}},
        "filters": {
            "role": {"field": "roles", "match": "any_of", "type": "string"},
            "is_active": {"match": "eq", "type": "bool"},
            "future": {"match": "near", "type": "point"}
        },
        "search": {"fields": ["name", "code"], "server_also": "x"},
        "online_only": [{"param": "filter[tree]", "reason": "server only"}],
        "extra": true
    });
    let read = offline_manifest(&manifest(Some(3), query.clone())).unwrap();
    let parties = &read.specs[0];
    let q = parties.query.as_ref().unwrap();
    assert_eq!(q.default_sort, ["-name"]);
    assert_eq!(q.sort["since"].field_of("since"), "created_at");
    assert_eq!(q.sort["since"].kind, SortType::Datetime);
    assert_eq!(q.filters["role"].matching, FilterMatch::AnyOf);
    assert_eq!(q.filters["future"].matching, FilterMatch::Unknown);
    assert_eq!(q.filters["future"].kind, ValueType::Unknown);
    assert_eq!(q.search.as_ref().unwrap().fields, ["name", "code"]);
    assert_eq!(q.online_only[0].reason, "server only");
    assert!(read.specs[1].query.is_some(), "a child keeps its own query");

    // Version 2 has no query sections; a newer version is not guessed.
    for version in [2, 4] {
        let read = offline_manifest(&manifest(Some(version), query.clone())).unwrap();
        assert!(read.specs.iter().all(|s| s.query.is_none()), "{version}");
    }
    // A v2 manifest without query parses as before.
    let plain = offline_manifest(
        &json!({"manifest_version": 2, "resources": [{"resource": "units", "read": "local-first", "source": "pull"}]})
            .to_string(),
    )
    .unwrap();
    assert_eq!(plain.specs[0].query, None);
    assert!(
        specs_from_offline_manifest(&manifest(None, query)).unwrap()[0]
            .query
            .is_some()
    );
}

#[test]
fn query_names_and_fields_outside_the_pattern_are_refused() {
    for query in [
        json!({"sort": {"name') --": {"type": "text"}}}),
        json!({"sort": {"name": {"field": "a\"b", "type": "text"}}}),
        json!({"filters": {"role": {"field": "roles[0]", "match": "any_of", "type": "string"}}}),
        json!({"filters": {"Role": {"match": "eq", "type": "string"}}}),
        json!({"filters": {"lines": {"match": "any_of", "type": "uuid", "element_field": "$.id"}}}),
        json!({"search": {"fields": ["name OR 1"]}}),
        json!({"online_only": [{"param": "filter[x]"}]}),
    ] {
        assert!(
            offline_manifest(&manifest(Some(3), query.clone())).is_err(),
            "{query}"
        );
    }
}

#[test]
fn the_shipped_manifest_registers_with_its_query_sections() {
    let json = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../contracts/offline-manifest.json"
    ))
    .unwrap();
    let manifest = offline_manifest(&json).unwrap();
    assert_eq!(
        manifest.manifest_version,
        keystone_sync::store::QUERY_MANIFEST_VERSION
    );
    let with_query = manifest.specs.iter().filter(|s| s.query.is_some()).count();
    assert_eq!(with_query, 25);
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path().join("m.db"), &DbKey::from_bytes([1; 32])).unwrap();
    store.register_all(&manifest.specs).unwrap();
    let stored = store.resource_spec(&res("sales-quotes")).unwrap().unwrap();
    assert_eq!(
        stored.query,
        manifest
            .specs
            .iter()
            .find(|s| s.resource.as_str() == "sales-quotes")
            .unwrap()
            .query
    );
}
