//! `cursor.session`: required, null or `^[A-Za-z0-9_-]{1,64}$`, opaque, and
//! kept by the store exactly as received.

use keystone_sync::store::{DbKey, MirrorStore, PageApply, Store};
use keystone_sync::wire::{Cursor, PullResourceResult, ResourceName, Xid8};
use serde_json::json;

fn decode(value: serde_json::Value) -> Result<Cursor, serde_json::Error> {
    serde_json::from_value(value)
}

#[test]
fn session_is_required_nullable_and_pattern_checked() {
    let base = |session: serde_json::Value| json!({ "txid": "10", "after_id": null, "gen": 1, "session": session });
    assert_eq!(decode(base(json!(null))).expect("null").session, None);
    let full = decode(base(json!("fd_01J9-abc"))).expect("set");
    assert_eq!(full.session.as_deref(), Some("fd_01J9-abc"));
    assert_eq!(
        serde_json::to_value(&full).expect("encode"),
        base(json!("fd_01J9-abc"))
    );
    assert!(
        decode(json!({ "txid": "10", "after_id": null, "gen": 1 })).is_err(),
        "missing"
    );
    let long = "a".repeat(65);
    for bad in [
        json!(""),
        json!("has space"),
        json!("ü"),
        json!(long),
        json!(5),
    ] {
        assert!(decode(base(bad.clone())).is_err(), "{bad}");
    }
    assert!(decode(base(json!("a".repeat(64)))).is_ok());
}

#[test]
fn store_keeps_the_cursor_with_its_session() {
    let dir = tempfile::tempdir().expect("dir");
    let store = Store::open(dir.path().join("s.db"), &DbKey::from_bytes([5; 32])).expect("open");
    let resource = ResourceName("parties".into());
    let cursor = Cursor {
        txid: Xid8(42),
        after_id: Some(uuid::Uuid::from_u128(7)),
        generation: 3,
        session: Some("fd_SESSION-1".into()),
    };
    let base = store.pull_base(&resource).expect("base");
    let page = PullResourceResult {
        resource: resource.clone(),
        rows: Vec::new(),
        tombstones: Vec::new(),
        next_cursor: cursor.clone(),
        has_more: true,
        reset: false,
        reset_reason: None,
    };
    assert!(matches!(
        store.apply_page(&page, &base).expect("apply"),
        PageApply::Applied(_)
    ));
    assert_eq!(
        store.cursor(&resource).expect("cursor"),
        Some(cursor.clone())
    );
    assert_eq!(
        store.pull_base(&resource).expect("base").cursor,
        Some(cursor)
    );
}
