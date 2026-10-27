//! Engine push against wiremock: batches of `push_batch_max`, results
//! applied/conflict/rejected/duplicate settled in outbox and Conflict Inbox,
//! server rows written to the mirror, quarantine after repeated transient
//! failures shown in the status.

mod engine_support;

use std::sync::{Arc, Mutex};

use engine_support::*;
use keystone_sync::conflicts::ConflictInbox;
use keystone_sync::engine::{SyncState, Trigger};
use keystone_sync::outbox::{MAX_ATTEMPTS, OutboxState};
use keystone_sync::store::raw::prelude::*;
use keystone_sync::wire::{MutationOp, ResourceRow};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const PUSH: &str = "/api/v1/sync/push";

fn server_row(id: Uuid, version: u64, fields: Value) -> ResourceRow {
    serde_json::from_value(row(&id.to_string(), version, fields)).unwrap()
}

#[tokio::test]
async fn push_results_settle_the_outbox_and_update_the_mirror() {
    let env = env().await;
    let mut manifest = simple_manifest(&["parties"]);
    manifest["data"]["limits"]["push_batch_max"] = json!(2);
    mount_manifest(&env.server, manifest).await;
    mount_empty_pull(&env.server).await;

    let parties = name("parties");
    let created = Uuid::now_v7();
    let updated = Uuid::now_v7();
    let invalid = Uuid::now_v7();
    let deleted = Uuid::now_v7();
    // Full download first (empty), so later pulls are incremental and keep
    // the rows put below.
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.store
        .put_row(&parties, &server_row(updated, 1, json!({"name": "Eski"})))
        .unwrap();
    env.store
        .put_row(
            &parties,
            &server_row(deleted, 1, json!({"name": "Silinecek"})),
        )
        .unwrap();
    let e = &env.engine;
    e.enqueue(draft(
        MutationOp::Create,
        "parties",
        created,
        json!({"name": "Yeni"}),
    ))
    .unwrap();
    e.enqueue(draft(
        MutationOp::Update,
        "parties",
        updated,
        json!({"name": "Benim"}),
    ))
    .unwrap();
    e.enqueue(draft(
        MutationOp::Create,
        "parties",
        invalid,
        json!({"name": ""}),
    ))
    .unwrap();
    e.enqueue(draft(MutationOp::Delete, "parties", deleted, json!({})))
        .unwrap();
    assert_eq!(e.status().pending, 4);

    let outcomes = Arc::new(Mutex::new(Vec::new()));
    let log = outcomes.clone();
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(move |request: &Request| {
            let mutations = body(request)["mutations"].as_array().unwrap().clone();
            let results: Vec<Value> = mutations
                .iter()
                .map(|m| {
                    let id = Uuid::parse_str(m["id"].as_str().unwrap()).unwrap();
                    let base = json!({
                        "idempotency_key": m["idempotency_key"],
                        "resource": m["resource"],
                        "id": m["id"],
                    });
                    let mut result = base.as_object().unwrap().clone();
                    let extra = if id == created {
                        json!({"status": "applied", "replayed": false, "version": 1,
                               "data": row(&id.to_string(), 1, json!({"name": "Yeni", "code": "C-0001"}))})
                    } else if id == updated {
                        json!({"status": "conflict", "replayed": false, "conflict": {
                            "code": "VERSION_CONFLICT", "base_version": 1, "server_version": 2,
                            "conflicting_fields": ["name"],
                            "server_data": row(&id.to_string(), 2, json!({"name": "Sunucu"})),
                            "choices": ["keep_mine", "take_server", "merge"]}})
                    } else if id == invalid {
                        json!({"status": "rejected", "replayed": false,
                               "error": {"message": "name is required", "code": "VALIDATION_ERROR"}})
                    } else {
                        json!({"status": "duplicate", "replayed": true, "data": null})
                    };
                    result.extend(extra.as_object().unwrap().clone());
                    log.lock().unwrap().push(m["op"].clone());
                    Value::Object(result)
                })
                .collect();
            ResponseTemplate::new(200).set_body_json(json!({"data": {"results": results}, "meta": {}}))
        })
        .mount(&env.server)
        .await;

    let report = e.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(
        (report.pushed, report.conflicts, report.rejected),
        (2, 1, 1)
    );
    // push_batch_max = 2.
    let sent = bodies(&env.server, PUSH).await;
    assert_eq!(sent.len(), 2);
    assert!(
        sent.iter()
            .all(|b| b["mutations"].as_array().unwrap().len() == 2)
    );
    assert_eq!(outcomes.lock().unwrap().len(), 4);

    // Mirror: server row for the applied create, delete applied, the
    // conflicting row untouched.
    let row = env.store.get_row(&parties, created).unwrap().unwrap();
    assert_eq!(row.fields["code"], "C-0001");
    assert_eq!(row.version, Some(1));
    assert!(env.store.get_row(&parties, deleted).unwrap().is_none());
    let kept = env.store.get_row(&parties, updated).unwrap().unwrap();
    assert_eq!(kept.fields["name"], "Eski");

    // Outbox and inbox.
    let entries = outbox_list(&env.store);
    let states: Vec<(Uuid, OutboxState)> =
        entries.iter().map(|x| (x.mutation.id, x.state)).collect();
    assert_eq!(
        states,
        [
            (updated, OutboxState::Conflict),
            (invalid, OutboxState::Rejected)
        ]
    );
    assert_eq!(inbox(&env.store).count().unwrap(), 1);
    let status = e.status();
    assert_eq!(status.state, SyncState::Idle);
    assert_eq!(
        (
            status.pending,
            status.conflicts,
            status.rejected,
            status.quarantined
        ),
        (0, 1, 1, 0)
    );
    // The user still sees their conflicting draft locally.
    let local = e.get(&parties, updated).unwrap().unwrap();
    assert!(local.draft);
    assert_eq!(local.row.fields["name"], "Benim");
}

#[tokio::test]
async fn repeated_transient_failures_quarantine_the_mutation_visibly() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(ResponseTemplate::new(503).set_body_json(error_body("SERVER_ERROR", "down")))
        .mount(&env.server)
        .await;
    let e = &env.engine;
    // Verifies the sign-in; nothing to push yet.
    e.run_once(Trigger::Startup).await.unwrap();
    let id = Uuid::now_v7();
    e.enqueue(draft(
        MutationOp::Create,
        "parties",
        id,
        json!({"name": "X"}),
    ))
    .unwrap();

    for attempt in 1..=MAX_ATTEMPTS {
        let error = e.run_once(Trigger::Manual).await.unwrap_err();
        assert_eq!(error.code(), "SERVER_ERROR");
        let status = e.status();
        assert_eq!(status.state, SyncState::Failed("SERVER_ERROR"));
        assert_eq!(status.failures, attempt);
        if attempt < MAX_ATTEMPTS {
            assert_eq!((status.pending, status.quarantined), (1, 0));
        }
    }
    let status = e.status();
    assert_eq!((status.pending, status.quarantined), (0, 1));
    let entry = &outbox_list(&env.store)[0];
    assert_eq!(entry.state, OutboxState::Quarantined);
    assert_eq!(entry.attempts, MAX_ATTEMPTS);

    // Quarantined work is not sent again; the run succeeds and keeps it visible.
    e.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(hits(&env.server, PUSH).await, MAX_ATTEMPTS as usize);
    let status = e.status();
    assert_eq!(status.state, SyncState::Idle);
    assert_eq!((status.quarantined, status.failures), (1, 0));
    assert!(e.get(&name("parties"), id).unwrap().unwrap().draft);

    // Retried by the user, it goes out again.
    e.retry(entry.mutation.idempotency_key).unwrap();
    assert_eq!(e.refresh_status().unwrap().pending, 1);
}

#[tokio::test]
async fn busy_and_rate_limited_pushes_are_resent_with_the_same_keys_after_retry_after() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    let calls = Arc::new(Mutex::new(0usize));
    let seen = calls.clone();
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(move |request: &Request| {
            let mut n = seen.lock().unwrap();
            *n += 1;
            match *n {
                // A busy row lock (55P03): the whole push, no results.
                1 => ResponseTemplate::new(409)
                    .insert_header("Retry-After", "1")
                    .set_body_json(error_body("IDEMPOTENCY_IN_PROGRESS", "busy")),
                2 => ResponseTemplate::new(429)
                    .insert_header("Retry-After", "2")
                    .set_body_json(error_body("TOO_MANY_ATTEMPTS", "slow down")),
                _ => {
                    let results: Vec<Value> = body(request)["mutations"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|m| {
                            if m["payload"]["number"].is_null() {
                                json!({"idempotency_key": m["idempotency_key"], "resource": m["resource"],
                                       "id": m["id"], "status": "applied", "replayed": false, "version": 1,
                                       "data": row(m["id"].as_str().unwrap(), 1, m["payload"].clone())})
                            } else {
                                json!({"idempotency_key": m["idempotency_key"], "resource": m["resource"],
                                       "id": m["id"], "status": "rejected", "replayed": false,
                                       "error": {"message": "number is server side",
                                                 "code": "SYNC_OFFLINE_WRITE_NOT_ALLOWED"}})
                            }
                        })
                        .collect();
                    ResponseTemplate::new(200)
                        .set_body_json(json!({"data": {"results": results}, "meta": {}}))
                }
            }
        })
        .mount(&env.server)
        .await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    let ok = Uuid::now_v7();
    let numbered = Uuid::now_v7();
    e.enqueue(draft(
        MutationOp::Create,
        "parties",
        ok,
        json!({"name": "A"}),
    ))
    .unwrap();
    e.enqueue(draft(
        MutationOp::Create,
        "parties",
        numbered,
        json!({"name": "B", "number": "X-1"}),
    ))
    .unwrap();

    let started = std::time::Instant::now();
    let attempts = |id: Uuid| {
        outbox_list(&env.store)
            .iter()
            .find(|x| x.mutation.id == id)
            .map(|x| x.attempts)
    };
    // 1) The whole batch gets the busy lock (55P03): the server may have
    // committed a prefix, so no mutation is charged; the next requests go
    // one mutation at a time.
    let error = e.run_once(Trigger::Manual).await.unwrap_err();
    assert_eq!(error.code(), "IDEMPOTENCY_IN_PROGRESS");
    let status = e.status();
    assert_eq!(status.state, SyncState::Failed("IDEMPOTENCY_IN_PROGRESS"));
    assert_eq!(status.retry_after, Some(std::time::Duration::from_secs(1)));
    assert_eq!(
        (status.pending, status.rejected, status.quarantined),
        (2, 0, 0)
    );
    assert_eq!((attempts(ok), attempts(numbered)), (Some(0), Some(0)));
    // 2) A single-mutation request is rate limited: only that one is charged.
    let error = e.run_once(Trigger::Manual).await.unwrap_err();
    assert_eq!(error.code(), "TOO_MANY_ATTEMPTS");
    let status = e.status();
    assert_eq!(status.state, SyncState::Failed("TOO_MANY_ATTEMPTS"));
    assert_eq!(status.retry_after, Some(std::time::Duration::from_secs(2)));
    assert_eq!(
        (status.pending, status.rejected, status.quarantined),
        (2, 0, 0)
    );
    assert_eq!((attempts(ok), attempts(numbered)), (Some(1), Some(0)));

    let report = e.run_once(Trigger::Manual).await.unwrap();
    // Each run waited out the previous Retry-After (1 s, then 2 s).
    assert!(started.elapsed() >= std::time::Duration::from_secs(3));
    assert_eq!((report.pushed, report.rejected), (1, 1));
    let sent = bodies(&env.server, PUSH).await;
    let keys = |b: &Value| -> Vec<Value> {
        b["mutations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["idempotency_key"].clone())
            .collect()
    };
    // Same keys throughout: the full batch once, then one by one.
    assert_eq!(sent.len(), 4);
    let first = keys(&sent[0]);
    assert_eq!(first.len(), 2);
    assert_eq!(keys(&sent[1]), first[..1]);
    assert_eq!(keys(&sent[2]), first[..1]);
    assert_eq!(keys(&sent[3]), first[1..]);
    let entries = outbox_list(&env.store);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].mutation.id, numbered);
    assert_eq!(entries[0].state, OutboxState::Rejected);
    assert_eq!(
        entries[0].last_error.as_deref(),
        Some("SYNC_OFFLINE_WRITE_NOT_ALLOWED")
    );
    assert_eq!(e.status().state, SyncState::Idle);
}
