//! Identity loss: `UNAUTHENTICATED` keeps the outbox and continues for the
//! same user; another user wipes local data before anything is pushed;
//! `USER_DEACTIVATED` of the current sign-in generation wipes the mirror and
//! seals unsent work (another user then deletes it),
//! a stale one nothing; sign-out with pending work needs `force`.

mod engine_support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use engine_support::*;
use keystone_sync::auth::TokenStore;
use keystone_sync::conflicts::{ConflictInbox, ConflictRecord};
use keystone_sync::engine::{SignOut, SyncState, Trigger};
use keystone_sync::store::MirrorStore;
use keystone_sync::wire::{MutationOp, ResourceRow, Timestamp};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const PUSH: &str = "/api/v1/sync/push";
const REFRESH: &str = "/api/v1/auth/device/refresh";
const P1: &str = "0193b1e8-0000-7d30-8333-0000000000f1";

/// Echoes `applied` for every pushed mutation.
fn apply_all(request: &Request) -> ResponseTemplate {
    let results: Vec<Value> = body(request)["mutations"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            json!({"idempotency_key": m["idempotency_key"], "resource": m["resource"],
                   "id": m["id"], "status": "applied", "replayed": false, "version": 1,
                   "data": row(m["id"].as_str().unwrap(), 1, m["payload"].clone())})
        })
        .collect();
    ResponseTemplate::new(200).set_body_json(json!({"data": {"results": results}, "meta": {}}))
}

/// Local data: one mirror row (after an empty full download), one outbox
/// entry (a create draft).
async fn seed(env: &Env) -> Uuid {
    env.engine.run_once(Trigger::Startup).await.unwrap();
    let row: ResourceRow = serde_json::from_value(row(P1, 1, json!({"name": "A"}))).unwrap();
    env.store.put_row(&name("parties"), &row).unwrap();
    let id = Uuid::now_v7();
    env.engine
        .enqueue(draft(
            MutationOp::Create,
            "parties",
            id,
            json!({"name": "Taslak"}),
        ))
        .unwrap();
    id
}

fn local_rows(env: &Env) -> u64 {
    env.store.row_count(&name("parties")).unwrap()
}

#[tokio::test]
async fn unauthenticated_keeps_the_outbox_and_the_same_user_continues() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            move |_: &Request| match seen.fetch_add(1, Ordering::SeqCst) {
                // Seed run, then 401 + failed refresh; the run while signed out
                // never reaches the server; after the new sign-in it works.
                0 | 2 => ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"])),
                _ => ResponseTemplate::new(401)
                    .set_body_json(error_body("UNAUTHENTICATED", "revoked")),
            },
        )
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
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(apply_all)
        .mount(&env.server)
        .await;

    let draft_id = seed(&env).await;
    let error = env.engine.run_once(Trigger::Timer).await.unwrap_err();
    assert_eq!(error.code(), "UNAUTHENTICATED");
    let status = env.engine.status();
    assert_eq!(status.state, SyncState::AuthRequired);
    assert_eq!(status.pending, 1, "outbox kept");
    assert_eq!(local_rows(&env), 1, "mirror kept");
    assert!(env.tokens.load(PROFILE).unwrap().is_none());
    assert_eq!(hits(&env.server, PUSH).await, 0);

    // Still signed out: the client fails locally, nothing changes.
    env.engine.run_once(Trigger::Manual).await.unwrap_err();
    assert_eq!(env.engine.status().pending, 1);

    // The same user signs in again: the queued draft goes out.
    sign_in_as(&env.tokens, 2).await;
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(hits(&env.server, PUSH).await, 1);
    let status = env.engine.status();
    assert_eq!((status.state, status.pending), (SyncState::Idle, 0));
    assert!(
        env.store
            .get_row(&name("parties"), draft_id)
            .unwrap()
            .is_some()
    );
}

#[tokio::test]
async fn another_user_signing_in_wipes_local_data_before_pushing() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            let user = if seen.fetch_add(1, Ordering::SeqCst) == 0 {
                USER_A
            } else {
                USER_B
            };
            ResponseTemplate::new(200).set_body_json(manifest(
                user,
                vec![resource("parties", 0)],
                200,
                100,
            ))
        })
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(apply_all)
        .mount(&env.server)
        .await;
    seed(&env).await;
    assert_eq!(env.engine.status().pending, 1);

    sign_in_as(&env.tokens, 3).await;
    let report = env.engine.run_once(Trigger::Manual).await.unwrap();
    assert!(report.changed.contains(&name("parties")));
    assert_eq!(
        hits(&env.server, PUSH).await,
        0,
        "user A's draft is never sent as user B"
    );
    assert_eq!(env.engine.status().pending, 0);
    assert_eq!(local_rows(&env), 0);
    assert!(outbox_list(&env.store).is_empty());
}

#[tokio::test]
async fn deactivation_of_the_current_generation_wipes_the_mirror_and_seals_unsent_work() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            move |_: &Request| match seen.fetch_add(1, Ordering::SeqCst) {
                0 => ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"])),
                1 => ResponseTemplate::new(403)
                    .set_body_json(error_body("USER_DEACTIVATED", "inactive")),
                // Afterwards another user signs in on this profile.
                _ => ResponseTemplate::new(200).set_body_json(manifest(
                    USER_B,
                    vec![resource("parties", 0)],
                    200,
                    100,
                )),
            },
        )
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(apply_all)
        .mount(&env.server)
        .await;
    seed(&env).await;
    // An open conflict too.
    let local = outbox_list(&env.store)[0].mutation.clone();
    inbox(&env.store)
        .record(ConflictRecord {
            idempotency_key: local.idempotency_key,
            resource: local.resource.clone(),
            id: local.id,
            conflict: serde_json::from_value(json!({
                "code": "DUPLICATE_RECORD", "base_version": null, "server_version": null,
                "conflicting_fields": ["tax_number"], "server_data": null,
                "candidates": [P1], "choices": ["use_existing", "keep_mine", "discard"],
            }))
            .unwrap(),
            local,
            detected_at: Timestamp("2026-10-26T09:20:00Z".into()),
        })
        .unwrap();
    assert_eq!(env.engine.refresh_status().unwrap().conflicts, 1);
    let mut changes = env.engine.subscribe_changes();

    let error = env.engine.run_once(Trigger::Timer).await.unwrap_err();
    assert_eq!(error.code(), "USER_DEACTIVATED");
    // The mirror goes; unsent work and the open conflict are sealed: kept,
    // but neither readable nor sendable until the same user verifies again
    // (`client_findings::c4_deactivation_keeps_unsent_work_for_the_same_user`).
    assert_eq!(local_rows(&env), 0);
    // Sealed at the outbox layer too: a raw outbox neither lists nor selects
    // it; the entry itself is still in the database.
    let raw = keystone_sync::outbox::Outbox::new(env.store.clone());
    assert!(matches!(
        raw.list(),
        Err(keystone_sync::error::SyncError::OfflineUnavailable(_))
    ));
    assert!(matches!(
        keystone_sync::outbox::OutboxQueue::next_batch(&raw, 10),
        Err(keystone_sync::error::SyncError::OfflineUnavailable(_))
    ));
    let stored: i64 = env
        .store
        .read(|c| Ok(c.query_row("SELECT count(*) FROM outbox_entries", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(stored, 1);
    assert_eq!(inbox(&env.store).count().unwrap(), 1);
    assert!(env.engine.outbox_entries().is_err());
    assert!(env.engine.conflict_records().is_err());
    let record = env.tokens.load_record(PROFILE).unwrap();
    assert!(record.deactivated && record.tokens.is_none());
    assert_eq!(env.engine.status().state, SyncState::AuthRequired);
    let mut wiped = Vec::new();
    while let Ok(event) = changes.try_recv() {
        wiped.extend(event.resources);
    }
    assert!(wiped.contains(&name("parties")));

    // Another user signs in: the sealed work is deleted before any push.
    sign_in_as(&env.tokens, 2).await;
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(hits(&env.server, PUSH).await, 0);
    assert!(outbox_list(&env.store).is_empty());
    assert_eq!(inbox(&env.store).count().unwrap(), 0);
    assert_eq!(env.engine.status().pending, 0);
}

#[tokio::test]
async fn a_stale_deactivation_deletes_nothing() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            move |_: &Request| match seen.fetch_add(1, Ordering::SeqCst) {
                0 => ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"])),
                // Answers a call made before the new sign-in below.
                1 => ResponseTemplate::new(403)
                    .set_body_json(error_body("USER_DEACTIVATED", "inactive"))
                    .set_delay(Duration::from_millis(600)),
                // The follow-up run under the new sign-in finds the server down.
                _ => ResponseTemplate::new(500).set_body_json(error_body("SERVER_ERROR", "down")),
            },
        )
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    seed(&env).await;

    let engine = env.engine.clone();
    let run = tokio::spawn(async move { engine.run_once(Trigger::Timer).await });
    tokio::time::sleep(Duration::from_millis(200)).await;
    let generation = sign_in_as(&env.tokens, 4).await;
    // The stale 403 changed nothing; the run cut short by the sign-in is
    // followed by one under the new sign-in.
    let error = run.await.unwrap().unwrap_err();
    assert_eq!(error.code(), "SERVER_ERROR");
    assert_eq!(calls.load(Ordering::SeqCst), 3);

    let record = env.tokens.load_record(PROFILE).unwrap();
    assert_eq!(record.generation, generation);
    assert!(!record.deactivated);
    assert_eq!(record.tokens, Some(tokens(4)));
    assert_eq!(local_rows(&env), 1);
    assert_eq!(env.engine.status().pending, 1);
    assert_eq!(env.engine.status().state, SyncState::Failed("SERVER_ERROR"));
}

#[tokio::test]
async fn sign_out_with_pending_work_needs_force() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    seed(&env).await;

    let answer = env.engine.sign_out(false).await.unwrap();
    assert_eq!(
        answer,
        SignOut::PendingWork {
            outbox: 1,
            conflicts: 0
        }
    );
    assert!(env.tokens.load(PROFILE).unwrap().is_some());
    assert_eq!(local_rows(&env), 1);

    assert_eq!(env.engine.sign_out(true).await.unwrap(), SignOut::Done);
    assert!(env.tokens.load(PROFILE).unwrap().is_none());
    assert_eq!(local_rows(&env), 0);
    assert!(outbox_list(&env.store).is_empty());
    assert_eq!(env.engine.status().state, SyncState::AuthRequired);
}
