//! Review fixes that change the store API: pages are applied only against
//! the base they were requested with; routing knows partial copies; reads
//! can run on a connection already held.

use keystone_sync::store::{
    DbKey, ListQuery, LocalCopy, MirrorStore, PageApply, ReadRoute, ResourceSpec, Store, read_route,
};
use keystone_sync::wire::{
    Cursor, PullResourceResult, ReadMode, ResourceName, ResourceRow, Timestamp, Xid8,
};
use serde_json::{Map, json};
use uuid::Uuid;

fn res(name: &str) -> ResourceName {
    ResourceName(name.to_owned())
}

fn open(dir: &tempfile::TempDir) -> Store {
    Store::open(dir.path().join("api.db"), &DbKey::from_bytes([6; 32])).unwrap()
}

fn row(n: u128) -> ResourceRow {
    let mut fields = Map::new();
    fields.insert("name".into(), json!(format!("r{n}")));
    ResourceRow {
        id: Uuid::from_u128(n),
        version: None,
        fields,
    }
}

fn page(n: u128, txid: u64, has_more: bool) -> PullResourceResult {
    PullResourceResult {
        resource: res("parties"),
        rows: vec![row(n)],
        tombstones: Vec::new(),
        next_cursor: Cursor {
            txid: Xid8(txid),
            after_id: None,
            generation: 1,
        },
        has_more,
        reset: false,
        reset_reason: None,
    }
}

fn applied(outcome: PageApply) -> keystone_sync::store::AppliedPage {
    match outcome {
        PageApply::Applied(a) => a,
        PageApply::Stale => panic!("page unexpectedly stale"),
    }
}

#[test]
fn delayed_page_after_a_local_reset_is_stale() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    let parties = res("parties");

    let first = store.pull_base(&parties).unwrap();
    assert_eq!(first.cursor, None);
    applied(store.apply_page(&page(1, 10, true), &first).unwrap());

    // The continuation is requested, then the resource is reset locally
    // before its response arrives.
    let continuation = store.pull_base(&parties).unwrap();
    assert!(continuation.cursor.is_some());
    store.reset_resource(&parties).unwrap();
    assert!(matches!(
        store
            .apply_page(&page(2, 11, false), &continuation)
            .unwrap(),
        PageApply::Stale
    ));
    assert_eq!(store.row_count(&parties).unwrap(), 0);
    assert_eq!(store.resource_state(&parties).unwrap(), None);

    // A first-page request in flight across a reset is stale as well: the
    // epoch moved even though the cursor is `None` both times.
    let before = store.pull_base(&parties).unwrap();
    store.reset_resource(&parties).unwrap();
    assert!(matches!(
        store.apply_page(&page(3, 12, false), &before).unwrap(),
        PageApply::Stale
    ));

    // Two responses for the same base: only the first applies.
    let base = store.pull_base(&parties).unwrap();
    let a = applied(store.apply_page(&page(4, 13, true), &base).unwrap());
    assert!(a.reset);
    assert!(matches!(
        store.apply_page(&page(5, 14, false), &base).unwrap(),
        PageApply::Stale
    ));
    let next = store.pull_base(&parties).unwrap();
    applied(store.apply_page(&page(6, 15, false), &next).unwrap());
    let state = store.resource_state(&parties).unwrap().unwrap();
    assert!(state.complete);
    assert_eq!(store.row_count(&parties).unwrap(), 2);
}

#[test]
fn routing_accounts_for_partial_and_missing_copies() {
    use LocalCopy::{Complete, Missing, Partial};
    use ReadMode::{LocalFirst, OfflineFallback, OnlineFirst};
    let local = |partial| ReadRoute::Local { partial };
    let fallback = |partial| ReadRoute::RemoteThenLocal { partial };

    assert_eq!(read_route(LocalFirst, true, Complete), local(false));
    assert_eq!(read_route(LocalFirst, false, Complete), local(false));
    assert_eq!(read_route(LocalFirst, true, Partial), fallback(true));
    assert_eq!(read_route(LocalFirst, false, Partial), local(true));
    assert_eq!(read_route(LocalFirst, true, Missing), ReadRoute::Remote);
    assert_eq!(
        read_route(LocalFirst, false, Missing),
        ReadRoute::Unavailable
    );
    assert_eq!(read_route(OnlineFirst, true, Complete), fallback(false));
    assert_eq!(read_route(OnlineFirst, true, Partial), fallback(true));
    assert_eq!(read_route(OnlineFirst, false, Partial), local(true));
    assert_eq!(read_route(OnlineFirst, true, Missing), ReadRoute::Remote);
    assert_eq!(
        read_route(OfflineFallback, true, Complete),
        ReadRoute::Remote
    );
    assert_eq!(read_route(OfflineFallback, false, Complete), local(false));
    assert_eq!(
        read_route(OfflineFallback, false, Missing),
        ReadRoute::Unavailable
    );

    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    let parties = res("parties");
    store.register(&ResourceSpec::new(parties.clone())).unwrap();
    assert_eq!(store.local_copy(&parties).unwrap(), Missing);
    assert_eq!(store.route(&parties, true).unwrap(), ReadRoute::Remote);

    let base = store.pull_base(&parties).unwrap();
    applied(store.apply_page(&page(1, 1, true), &base).unwrap());
    assert_eq!(store.local_copy(&parties).unwrap(), Partial);
    assert_eq!(store.route(&parties, true).unwrap(), fallback(true));
    assert_eq!(store.route(&parties, false).unwrap(), local(true));

    let base = store.pull_base(&parties).unwrap();
    applied(store.apply_page(&page(2, 2, false), &base).unwrap());
    assert_eq!(store.local_copy(&parties).unwrap(), Complete);
    assert_eq!(store.route(&parties, true).unwrap(), local(false));

    let balances = res("stock-balances");
    store
        .register(&ResourceSpec::new(balances.clone()).read(OfflineFallback))
        .unwrap();
    assert_eq!(
        store.route(&balances, false).unwrap(),
        ReadRoute::Unavailable
    );
    store
        .put_snapshot(
            &balances,
            &json!({"data": []}),
            &Timestamp("2026-10-26T10:00:00Z".into()),
        )
        .unwrap();
    assert_eq!(store.route(&balances, false).unwrap(), local(false));
    assert_eq!(store.route(&balances, true).unwrap(), ReadRoute::Remote);

    // Unregistered: nothing local.
    assert_eq!(
        store.route(&res("units"), false).unwrap(),
        ReadRoute::Unavailable
    );
}

#[test]
fn reads_can_reuse_the_connection_they_hold() {
    let dir = tempfile::tempdir().unwrap();
    let store = open(&dir);
    let parties = res("parties");
    store.put_row(&parties, &row(1)).unwrap();
    store
        .read(|conn| {
            let one = Store::get_row_on(conn, &parties, Uuid::from_u128(1))?;
            assert!(one.is_some());
            let page = Store::list_on(conn, &parties, &ListQuery::default())?;
            assert_eq!(page.total, 1);
            Ok(())
        })
        .unwrap();
}
