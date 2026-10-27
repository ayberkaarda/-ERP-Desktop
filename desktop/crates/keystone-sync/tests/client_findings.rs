//! Regression tests for the D1 attack findings on the desktop client
//! (C1-C4, `.orchestra/c-fix-plan.md`). Each test states the behaviour the
//! contract (docs/SYNC-PROTOCOL.md) or the chosen fix requires; they fail
//! until the fix lands. Guards marked as such pass today and must keep
//! passing after the fix.

mod engine_support;

use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use engine_support::*;
use keystone_sync::conflicts::{ConflictInbox, ConflictStore, ResolutionAction, allowed_choices};
use keystone_sync::engine::{SyncState, Trigger};
use keystone_sync::error::SyncError;
use keystone_sync::outbox::{MAX_ATTEMPTS, Outbox, OutboxQueue, OutboxState};
use keystone_sync::store::{DbKey, ListQuery, MirrorStore, Store};
use keystone_sync::wire::{
    Conflict, ConflictChoice, ConflictCode, MutationOp, PushResult, PushStatus, ResourceName,
    ResourceRow,
};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const PULL: &str = "/api/v1/sync/pull";
const PUSH: &str = "/api/v1/sync/push";
const REFRESH: &str = "/api/v1/auth/device/refresh";

fn server_row(id: Uuid, version: u64, fields: Value) -> ResourceRow {
    serde_json::from_value(row(&id.to_string(), version, fields)).unwrap()
}

fn mirror_version(env: &Env, resource: &str, id: Uuid) -> Option<u64> {
    env.store
        .get_row(&name(resource), id)
        .unwrap()
        .and_then(|r| r.version)
}

/// One push answer: every sent mutation answered with `status` and `data`
/// (a row of `version`, or `null` for a delete).
fn replay_all(version: Option<u64>, fields: Value) -> impl Fn(&Request) -> ResponseTemplate {
    move |request: &Request| {
        let results: Vec<Value> = body(request)["mutations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| {
                let data = version.map_or(Value::Null, |v| {
                    row(m["id"].as_str().unwrap(), v, fields.clone())
                });
                json!({"idempotency_key": m["idempotency_key"], "resource": m["resource"],
                       "id": m["id"], "status": "duplicate", "replayed": true,
                       "version": version, "data": data})
            })
            .collect();
        ResponseTemplate::new(200).set_body_json(json!({"data": {"results": results}, "meta": {}}))
    }
}

// ---------------------------------------------------------------- C1 ----
// Contract "Sürüm kuralı (istemci)": a push result never moves the local
// row backwards; `duplicate` data may be old.

/// Quarantine → pull brings the row → web deletes it (tombstone) → user
/// retries → `duplicate` with the first `data`. The row must not come back.
#[tokio::test]
async fn c1_duplicate_create_after_remote_delete_does_not_resurrect_the_row() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    let id = Uuid::now_v7();
    let pulls = Arc::new(AtomicUsize::new(0));
    let seen = pulls.clone();
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(move |_: &Request| {
            let n = seen.fetch_add(1, Ordering::SeqCst);
            let next = cursor(1000 + n as u64, None, 0, None);
            let page = match n {
                // Run after the quarantine: the server row arrives.
                1 => page(
                    "parties",
                    vec![row(&id.to_string(), 1, json!({"name": "Yeni"}))],
                    vec![],
                    next,
                    false,
                ),
                // Web user deletes it.
                2 => page(
                    "parties",
                    vec![],
                    vec![tombstone("parties", &id.to_string(), 1002)],
                    next,
                    false,
                ),
                _ => page("parties", vec![], vec![], next, false),
            };
            ResponseTemplate::new(200).set_body_json(pull_response(vec![page]))
        })
        .mount(&env.server)
        .await;
    let pushes = Arc::new(AtomicUsize::new(0));
    let count = pushes.clone();
    let replay = replay_all(Some(1), json!({"name": "Yeni"}));
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(move |request: &Request| {
            // The server applied the create on the first send; the answers
            // are lost (5xx) until the quarantine.
            if count.fetch_add(1, Ordering::SeqCst) < MAX_ATTEMPTS as usize {
                ResponseTemplate::new(503).set_body_json(error_body("SERVER_ERROR", "down"))
            } else {
                replay(request)
            }
        })
        .mount(&env.server)
        .await;

    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    e.enqueue(draft(
        MutationOp::Create,
        "parties",
        id,
        json!({"name": "Yeni"}),
    ))
    .unwrap();
    for _ in 0..MAX_ATTEMPTS {
        e.run_once(Trigger::Manual).await.unwrap_err();
    }
    let key = outbox_list(&env.store)[0].mutation.idempotency_key;
    assert_eq!(outbox_list(&env.store)[0].state, OutboxState::Quarantined);
    e.run_once(Trigger::Manual).await.unwrap(); // pull: row arrives
    assert_eq!(mirror_version(&env, "parties", id), Some(1));
    e.run_once(Trigger::Manual).await.unwrap(); // pull: tombstone
    assert_eq!(mirror_version(&env, "parties", id), None);

    e.retry(key).unwrap();
    e.run_once(Trigger::Manual).await.unwrap(); // push: duplicate v1
    assert!(outbox_list(&env.store).is_empty(), "the entry settles");
    assert_eq!(
        mirror_version(&env, "parties", id),
        None,
        "C1: a duplicate create must not re-insert a row the server deleted"
    );
    assert!(e.get(&name("parties"), id).unwrap().is_none());
}

/// Local v7 (a newer pull) + `duplicate` v6 → local stays v7.
#[tokio::test]
async fn c1_duplicate_update_does_not_roll_a_newer_local_row_back() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(replay_all(Some(6), json!({"name": "Benim"})))
        .mount(&env.server)
        .await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    let parties = name("parties");
    let id = Uuid::now_v7();
    env.store
        .put_row(&parties, &server_row(id, 5, json!({"name": "Eski"})))
        .unwrap();
    let mut update = draft(MutationOp::Update, "parties", id, json!({"name": "Benim"}));
    update.base_version = Some(5);
    e.enqueue(update).unwrap();
    // A pull applied the web's v7 meanwhile (before the replay arrives).
    env.store
        .put_row(&parties, &server_row(id, 7, json!({"name": "Web"})))
        .unwrap();

    e.run_once(Trigger::Manual).await.unwrap();
    assert!(outbox_list(&env.store).is_empty(), "the entry settles");
    let local = env.store.get_row(&parties, id).unwrap().unwrap();
    assert_eq!(
        (local.version, local.fields["name"].clone()),
        (Some(7), json!("Web")),
        "C1: local version >= data.version keeps the local row"
    );
}

/// Delete base 7 applied, web restored the row (v8, pulled), retry →
/// `duplicate data:null`: local v8 > base 7 → the row stays.
#[tokio::test]
async fn c1_duplicate_delete_keeps_a_row_newer_than_its_base() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(replay_all(None, Value::Null))
        .mount(&env.server)
        .await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    let parties = name("parties");
    let id = Uuid::now_v7();
    env.store
        .put_row(&parties, &server_row(id, 7, json!({"name": "Silinecek"})))
        .unwrap();
    let mut delete = draft(MutationOp::Delete, "parties", id, json!({}));
    delete.base_version = Some(7);
    e.enqueue(delete).unwrap();
    env.store
        .put_row(&parties, &server_row(id, 8, json!({"name": "Geri alındı"})))
        .unwrap();

    e.run_once(Trigger::Manual).await.unwrap();
    assert!(outbox_list(&env.store).is_empty(), "the entry settles");
    assert_eq!(
        mirror_version(&env, "parties", id),
        Some(8),
        "C1: data:null removes the row only while local version <= base_version"
    );
}

/// Guard (passes today): a newer `duplicate` row is still applied.
#[tokio::test]
async fn c1_guard_duplicate_with_a_newer_row_is_applied() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(replay_all(Some(2), json!({"name": "Benim"})))
        .mount(&env.server)
        .await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    let parties = name("parties");
    let id = Uuid::now_v7();
    env.store
        .put_row(&parties, &server_row(id, 1, json!({"name": "Eski"})))
        .unwrap();
    e.enqueue(draft(
        MutationOp::Update,
        "parties",
        id,
        json!({"name": "Benim"}),
    ))
    .unwrap();
    e.run_once(Trigger::Manual).await.unwrap();
    let local = env.store.get_row(&parties, id).unwrap().unwrap();
    assert_eq!(
        (local.version, local.fields["name"].clone()),
        (Some(2), json!("Benim"))
    );
}

// ---------------------------------------------------------------- C2 ----
// Remote revocation must close the local mirror.

/// Seed run, then 401 on the manifest and 401 on the refresh: what the
/// server answers after `DELETE /me/devices/{id}`, a deactivation
/// (`AccessRevoker` deletes the device) or a password reset.
#[tokio::test]
async fn c2_revoked_device_closes_local_reads() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"]))
            } else {
                ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "revoked"))
            }
        })
        .mount(&env.server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "revoked")),
        )
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        &Uuid::now_v7().to_string(),
        json!({"name": "Cari"}),
    );
    assert_eq!(
        e.list(&name("parties"), &ListQuery::default())
            .unwrap()
            .total,
        1
    );

    let error = e.run_once(Trigger::Timer).await.unwrap_err();
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert_eq!(e.status().state, SyncState::AuthRequired);
    let read = e.list(&name("parties"), &ListQuery::default());
    assert!(
        matches!(read, Err(SyncError::OfflineUnavailable(_))),
        "C2: after the server revoked the device the mirror must not be served, got {read:?}"
    );
}

/// Seed run, then 403 `COMPANY_FORBIDDEN` on the manifest: what
/// `ResolveCompany` answers once the membership is removed (or the company
/// deactivated). The company's mirror goes.
#[tokio::test]
async fn c2_company_forbidden_wipes_the_company_mirror() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"]))
            } else {
                ResponseTemplate::new(403)
                    .set_body_json(error_body("COMPANY_FORBIDDEN", "not a member"))
            }
        })
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        &Uuid::now_v7().to_string(),
        json!({"name": "Cari"}),
    );

    let error = e.run_once(Trigger::Timer).await.unwrap_err();
    assert_eq!(error.code(), "COMPANY_FORBIDDEN");
    let read = e.list(&name("parties"), &ListQuery::default());
    assert!(
        matches!(read, Err(SyncError::OfflineUnavailable(_))),
        "C2: after losing the membership the mirror must not be served, got {read:?}"
    );
    assert_eq!(
        env.store.row_count(&name("parties")).unwrap(),
        0,
        "C2: the removed member's mirror is deleted"
    );
}

// ---------------------------------------------------------------- C3 ----

/// Server as specified: mutations in order, each committed on its own; a
/// transient failure in one fails the whole request without results, and
/// a resend replays the committed ones as `duplicate`. Outbox [M1, M2, M3],
/// M2 always fails transiently. Only M2 may end in the quarantine; M1 (already
/// committed) and M3 (independent) settle.
#[tokio::test]
async fn c3_a_transient_request_failure_quarantines_only_the_failing_mutation() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    let (m1, m2, m3) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    let committed: Arc<Mutex<HashSet<String>>> = Arc::default();
    let server = committed.clone();
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(move |request: &Request| {
            let mut done = server.lock().unwrap();
            let mut results = Vec::new();
            for m in body(request)["mutations"].as_array().unwrap() {
                if m["id"] == json!(m2.to_string()) {
                    return ResponseTemplate::new(503)
                        .set_body_json(error_body("SERVER_ERROR", "writer failed"));
                }
                let key = m["idempotency_key"].as_str().unwrap().to_owned();
                let replayed = !done.insert(key);
                results.push(json!({
                    "idempotency_key": m["idempotency_key"], "resource": m["resource"],
                    "id": m["id"], "status": if replayed { "duplicate" } else { "applied" },
                    "replayed": replayed, "version": 1,
                    "data": row(m["id"].as_str().unwrap(), 1, m["payload"].clone())}));
            }
            ResponseTemplate::new(200)
                .set_body_json(json!({"data": {"results": results}, "meta": {}}))
        })
        .mount(&env.server)
        .await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    for (id, label) in [(m1, "M1"), (m2, "M2"), (m3, "M3")] {
        e.enqueue(draft(
            MutationOp::Create,
            "parties",
            id,
            json!({"name": label}),
        ))
        .unwrap();
    }

    for _ in 0..(3 * MAX_ATTEMPTS + 3) {
        let _ = e.run_once(Trigger::Manual).await;
    }
    let left: Vec<(Uuid, OutboxState)> = outbox_list(&env.store)
        .iter()
        .map(|x| (x.mutation.id, x.state))
        .collect();
    assert_eq!(
        left,
        [(m2, OutboxState::Quarantined)],
        "C3: committed M1 and untried M3 must not be charged for M2's failure"
    );
    assert!(committed.lock().unwrap().len() >= 2);
    assert_eq!(mirror_version(&env, "parties", m1), Some(1));
    assert_eq!(mirror_version(&env, "parties", m3), Some(1));
}

// ---------------------------------------------------------------- C4 ----

/// Deactivated (403 `USER_DEACTIVATED` for the current sign-in; the same
/// mark a sign-in attempt while deactivated sets), then reactivated and
/// signed in again as the same user: the unsent offline work is still sent.
#[tokio::test]
async fn c4_deactivation_keeps_unsent_work_for_the_same_user() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            if seen.fetch_add(1, Ordering::SeqCst) == 1 {
                ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "inactive"))
            } else {
                ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"]))
            }
        })
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(apply_all)
        .mount(&env.server)
        .await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    let id = Uuid::now_v7();
    e.enqueue(draft(
        MutationOp::Create,
        "parties",
        id,
        json!({"name": "Çevrimdışı iş"}),
    ))
    .unwrap();

    let error = e.run_once(Trigger::Timer).await.unwrap_err();
    assert_eq!(error.code(), "USER_DEACTIVATED");
    // Guard (passes today): nothing local is readable while deactivated.
    assert!(matches!(
        e.list(&name("parties"), &ListQuery::default()),
        Err(SyncError::OfflineUnavailable(_))
    ));

    // The admin reactivates the user; the same user signs in again.
    sign_in_as(&env.tokens, 2).await;
    e.run_once(Trigger::Manual).await.unwrap();
    let pushed: Vec<Value> = bodies(&env.server, PUSH)
        .await
        .iter()
        .flat_map(|b| b["mutations"].as_array().cloned().unwrap_or_default())
        .collect();
    assert!(
        pushed.iter().any(|m| m["id"] == json!(id.to_string())),
        "C4: the offline create made before the deactivation must still be sent, pushed {pushed:?}"
    );
}

/// `save_as_new_draft` on a locked sales document: the create payload must
/// pass the server's field check. Every writer that can answer
/// `DOCUMENT_LOCKED` (Sales `DraftSyncWriter`, `PurchaseRequestSyncWriter`,
/// `StockDocumentSyncWriter`) locks `status` and `number`; a payload with
/// either key is rejected `SYNC_OFFLINE_WRITE_NOT_ALLOWED`
/// (`PushService::fieldSet`), for every op.
#[test]
fn c4_save_as_new_draft_payload_carries_no_server_locked_field() {
    let dir = tempfile::tempdir().unwrap();
    let store =
        Arc::new(Store::open(dir.path().join("inbox.db"), &DbKey::from_bytes([9; 32])).unwrap());
    let outbox = Outbox::new(store.clone());
    let inbox = ConflictStore::new(store.clone());
    let id = Uuid::now_v7();
    let mut update = draft(
        MutationOp::Update,
        "sales-quotes",
        id,
        json!({"notes": "benim"}),
    );
    update.base_version = Some(3);
    outbox.enqueue(update).unwrap();
    let sent = outbox.next_batch(1).unwrap().remove(0);
    let server_data = ResourceRow {
        id,
        version: Some(4),
        fields: json!({
            "status": "sent", "number": "TKL-2026-000001", "notes": "sunucu",
            "party_id": "0192f5a0-0000-7000-8000-0000000000aa",
            "lines": [{"id": "0192f5a0-0000-7000-8000-0000000000b1",
                       "item_id": "0192f5a0-0000-7000-8000-0000000000c1",
                       "quantity": "2"}],
        })
        .as_object()
        .unwrap()
        .clone(),
    };
    outbox
        .record_results(&[PushResult {
            idempotency_key: sent.idempotency_key,
            resource: ResourceName("sales-quotes".into()),
            id,
            status: PushStatus::Conflict,
            replayed: false,
            version: None,
            data: None,
            merged_fields: None,
            conflict: Some(Conflict {
                code: ConflictCode::DocumentLocked,
                message: None,
                base_version: Some(3),
                server_version: Some(4),
                conflicting_fields: vec![],
                server_data: Some(server_data),
                candidates: None,
                choices: allowed_choices(ConflictCode::DocumentLocked).to_vec(),
            }),
            error: None,
        }])
        .unwrap();

    let ResolutionAction::Enqueue(create) = inbox
        .resolve(sent.idempotency_key, ConflictChoice::SaveAsNewDraft)
        .unwrap()
    else {
        panic!("save_as_new_draft enqueues a create");
    };
    assert_eq!(create.op, MutationOp::Create);
    let locked: Vec<&str> = ["status", "number"]
        .into_iter()
        .filter(|f| create.payload.contains_key(*f))
        .collect();
    assert!(
        locked.is_empty(),
        "C4: the server rejects a create carrying {locked:?} (lockedFields)"
    );
}
