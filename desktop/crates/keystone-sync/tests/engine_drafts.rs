//! Draft layer of local reads: pending creates and updates over the mirror,
//! deletes hidden, with filter, sort, search and paging; drafts stay
//! visible after retention or a reset removes their mirror row.

mod engine_support;

use engine_support::*;
use keystone_sync::store::{Filter, ListQuery, MirrorStore, ResourceSpec, SortKey};
use keystone_sync::wire::{MutationOp, ResourceRow};
use serde_json::json;
use uuid::Uuid;

fn put(env: &Env, resource: &str, fields: serde_json::Value) -> Uuid {
    let id = Uuid::now_v7();
    let row: ResourceRow = serde_json::from_value(row(&id.to_string(), 1, fields)).unwrap();
    env.store.put_row(&name(resource), &row).unwrap();
    id
}

fn ids(page: &keystone_sync::engine::LocalPage) -> Vec<Uuid> {
    page.rows.iter().map(|r| r.id).collect()
}

#[tokio::test]
async fn drafts_are_laid_over_list_and_get() {
    let env = env().await;
    let parties = name("parties");
    env.store
        .register(
            &ResourceSpec::new(parties.clone())
                .indexed(["name"])
                .search(["name"]),
        )
        .unwrap();
    let p1 = put(
        &env,
        "parties",
        json!({"name": "Ankara Ltd", "city": "Ankara"}),
    );
    let p2 = put(&env, "parties", json!({"name": "Bursa", "city": "Bursa"}));
    let p3 = put(&env, "parties", json!({"name": "Çorum", "city": "Çorum"}));
    let e = &env.engine;
    let n1 = Uuid::now_v7();
    e.enqueue(draft(
        MutationOp::Create,
        "parties",
        n1,
        json!({"name": "Yeni Cari"}),
    ))
    .unwrap();
    e.enqueue(draft(
        MutationOp::Update,
        "parties",
        p1,
        json!({"name": "Ankara A.Ş."}),
    ))
    .unwrap();
    e.enqueue(draft(MutationOp::Delete, "parties", p2, json!({})))
        .unwrap();

    // Default order: drafts first, then the mirror.
    let page = e.list(&parties, &ListQuery::default()).unwrap();
    assert_eq!(ids(&page), [n1, p1, p3]);
    assert_eq!(page.total, 3);
    assert_eq!(page.drafts, [n1, p1]);
    assert_eq!(page.rows[1].fields["name"], "Ankara A.Ş.");
    assert_eq!(
        page.rows[1].fields["city"], "Ankara",
        "update merges into the row"
    );

    // Sorted: merged with the mirror in SQLite (binary) order.
    let sorted = ListQuery {
        sort: vec![SortKey::asc("name")],
        ..ListQuery::default()
    };
    assert_eq!(ids(&e.list(&parties, &sorted).unwrap()), [p1, n1, p3]);
    let desc = ListQuery {
        sort: vec![SortKey::desc("name")],
        limit: Some(2),
        ..ListQuery::default()
    };
    assert_eq!(ids(&e.list(&parties, &desc).unwrap()), [p3, n1]);
    let paged = ListQuery {
        sort: vec![SortKey::asc("name")],
        limit: Some(1),
        offset: 1,
        ..ListQuery::default()
    };
    let page = e.list(&parties, &paged).unwrap();
    assert_eq!((ids(&page), page.total), (vec![n1], 3));
    let paged = ListQuery {
        offset: 2,
        sort: vec![],
        ..paged
    };
    assert_eq!(ids(&e.list(&parties, &paged).unwrap()), [p3]);

    // Filters and search see the draft values, not the mirror's.
    let filtered = ListQuery {
        filters: vec![Filter::eq("name", "Yeni Cari")],
        ..ListQuery::default()
    };
    let page = e.list(&parties, &filtered).unwrap();
    assert_eq!((ids(&page), page.total), (vec![n1], 1));
    let old_name = ListQuery {
        filters: vec![Filter::eq("name", "Ankara Ltd")],
        ..ListQuery::default()
    };
    assert_eq!(e.list(&parties, &old_name).unwrap().total, 0);
    let search = |text: &str| {
        let query = ListQuery {
            search: Some(text.into()),
            ..ListQuery::default()
        };
        ids(&e.list(&parties, &query).unwrap())
    };
    assert_eq!(search("ANKARA a.ş"), [p1]);
    assert_eq!(search("yeni"), [n1]);
    assert_eq!(search("corum"), [p3]);
    assert!(search("bursa").is_empty(), "deleted draft is hidden");

    // get: draft first, deletes hidden, plain mirror rows untouched.
    let got = e.get(&parties, p1).unwrap().unwrap();
    assert!(got.draft);
    assert_eq!(got.row.fields["name"], "Ankara A.Ş.");
    assert!(e.get(&parties, n1).unwrap().unwrap().draft);
    assert!(e.get(&parties, p2).unwrap().is_none());
    let plain = e.get(&parties, p3).unwrap().unwrap();
    assert!(!plain.draft);
    // The mirror itself is unchanged.
    assert_eq!(
        env.store.get_row(&parties, p1).unwrap().unwrap().fields["name"],
        "Ankara Ltd"
    );
}

#[tokio::test]
async fn drafts_survive_retention_and_reset() {
    let env = env().await;
    let quotes = name("sales-quotes");
    env.store
        .register(
            &ResourceSpec::new(quotes.clone())
                .window("document_date", Some(30))
                .search(["party_name"]),
        )
        .unwrap();
    let old = put(
        &env,
        "sales-quotes",
        json!({"document_date": "2026-01-05", "party_name": "Ege"}),
    );
    let recent = put(
        &env,
        "sales-quotes",
        json!({"document_date": "2026-10-20", "party_name": "Marmara"}),
    );
    env.engine
        .enqueue(draft(
            MutationOp::Update,
            "sales-quotes",
            old,
            json!({"notes": "teslim"}),
        ))
        .unwrap();

    let pruned = env.store.prune_at("2026-10-26").unwrap();
    assert_eq!(pruned.expired, 1);
    assert!(env.store.get_row(&quotes, old).unwrap().is_none());

    let got = env.engine.get(&quotes, old).unwrap().unwrap();
    assert!(got.draft);
    assert_eq!(got.row.fields["notes"], "teslim");
    assert_eq!(got.row.fields["document_date"], "2026-01-05");
    assert_eq!(got.row.fields["party_name"], "Ege");
    // Documents: newest window value first, drafts merged in.
    let page = env.engine.list(&quotes, &ListQuery::default()).unwrap();
    assert_eq!((ids(&page), page.total), (vec![recent, old], 2));
    let query = ListQuery {
        search: Some("ege".into()),
        ..ListQuery::default()
    };
    assert_eq!(ids(&env.engine.list(&quotes, &query).unwrap()), [old]);

    env.store.reset_resource(&quotes).unwrap();
    let page = env.engine.list(&quotes, &ListQuery::default()).unwrap();
    assert_eq!((ids(&page), page.total), (vec![old], 1));
    assert_eq!(
        env.engine.get(&quotes, old).unwrap().unwrap().row.fields["notes"],
        "teslim"
    );
}
