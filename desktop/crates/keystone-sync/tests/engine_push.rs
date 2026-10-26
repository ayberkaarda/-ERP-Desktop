//! Engine push against wiremock: batches of `push_batch_max`, results
//! applied/conflict/rejected/duplicate settled in outbox and Conflict Inbox,
//! server rows written to the mirror, quarantine after repeated transient
//! failures shown in the status.

mod engine_support;

use std::sync::{Arc, Mutex};

use engine_support::*;
use keystone_sync::conflicts::ConflictInbox;
use keystone_sync::engine::{SyncState, Trigger};
use keystone_sync::outbox::{MAX_ATTEMPTS, OutboxQueue, OutboxState};
use keystone_sync::store::MirrorStore;
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
    let row = e.store().get_row(&parties, created).unwrap().unwrap();
    assert_eq!(row.fields["code"], "C-0001");
    assert_eq!(row.version, Some(1));
    assert!(e.store().get_row(&parties, deleted).unwrap().is_none());
    let kept = e.store().get_row(&parties, updated).unwrap().unwrap();
    assert_eq!(kept.fields["name"], "Eski");

    // Outbox and inbox.
    let entries = e.outbox().list().unwrap();
    let states: Vec<(Uuid, OutboxState)> =
        entries.iter().map(|x| (x.mutation.id, x.state)).collect();
    assert_eq!(
        states,
        [
            (updated, OutboxState::Conflict),
            (invalid, OutboxState::Rejected)
        ]
    );
    assert_eq!(e.conflicts().count().unwrap(), 1);
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
    let entry = &e.outbox().list().unwrap()[0];
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
    e.outbox().retry(entry.mutation.idempotency_key).unwrap();
    assert_eq!(e.refresh_status().unwrap().pending, 1);
}
