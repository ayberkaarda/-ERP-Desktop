//! Server data outside the user's current scope never shows up locally: a
//! resource that left the manifest is not readable, a narrowed visibility
//! drops the server fields kept as draft bases (the user's own edits stay),
//! and push answers are checked against the request before anything is
//! written.

mod engine_support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use engine_support::*;
use keystone_sync::engine::Trigger;
use keystone_sync::outbox::OutboxState;
use keystone_sync::store::MirrorStore;
use keystone_sync::wire::MutationOp;
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const PUSH: &str = "/api/v1/sync/push";
const P1: &str = "0193b1e8-0000-7d30-8333-0000000000b1";
const OTHER_COMPANY: &str = "0192f5a0-0000-7000-8000-0000000000ff";

/// First manifest `first`, every later one `then`.
async fn mount_two_manifests(env: &Env, first: Value, then: Value) {
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            let body = if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                first.clone()
            } else {
                then.clone()
            };
            ResponseTemplate::new(200).set_body_json(body)
        })
        .mount(&env.server)
        .await;
}

async fn mount_push_error(env: &Env) {
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(ResponseTemplate::new(503).set_body_json(error_body("SERVER_ERROR", "down")))
        .mount(&env.server)
        .await;
}

/// Seed run, a server row with a field the user may lose access to, and
/// an update draft over it.
async fn seed_update(env: &Env) -> Uuid {
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        P1,
        json!({"name": "A Ltd", "credit_limit": 900_000}),
    );
    let id = Uuid::parse_str(P1).unwrap();
    env.engine
        .enqueue(draft(
            MutationOp::Update,
            "parties",
            id,
            json!({"name": "A Ltd Şti"}),
        ))
        .unwrap();
    id
}

#[tokio::test]
async fn a_resource_that_left_the_manifest_is_not_readable() {
    let env = env().await;
    mount_two_manifests(
        &env,
        simple_manifest(&["parties"]),
        manifest(USER_A, vec![], 200, 100),
    )
    .await;
    mount_empty_pull(&env.server).await;
    mount_push_error(&env).await;
    let id = seed_update(&env).await;

    let _ = env.engine.run_once(Trigger::Timer).await;
    let parties = name("parties");
    let got = env.engine.get(&parties, id);
    assert!(
        !matches!(&got, Ok(Some(row)) if row.row.fields.contains_key("credit_limit")),
        "server fields of a resource without access: {got:?}"
    );
    assert!(got.is_err());
    assert!(env.engine.list(&parties, &Default::default()).is_err());
    // The user's own work is kept.
    assert_eq!(env.engine.outbox().list().unwrap().len(), 1);
}

#[tokio::test]
async fn a_narrowed_visibility_keeps_the_draft_but_drops_its_server_base() {
    let env = env().await;
    mount_two_manifests(
        &env,
        simple_manifest(&["parties"]),
        manifest(USER_A, vec![resource("parties", 4)], 200, 100),
    )
    .await;
    mount_empty_pull(&env.server).await;
    mount_push_error(&env).await;
    let id = seed_update(&env).await;

    let _ = env.engine.run_once(Trigger::Timer).await;
    assert!(env.store.get_row(&name("parties"), id).unwrap().is_none());
    let got = env.engine.get(&name("parties"), id).unwrap().unwrap();
    assert!(got.draft);
    assert_eq!(got.row.fields["name"], "A Ltd Şti");
    assert!(
        !got.row.fields.contains_key("credit_limit"),
        "a field the server no longer shows: {:?}",
        got.row.fields
    );
}

/// Applied answers whose row is rewritten by `tamper`.
fn tampered(tamper: fn(&mut Value)) -> impl Fn(&Request) -> ResponseTemplate {
    move |request: &Request| {
        let results: Vec<Value> = body(request)["mutations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| {
                let mut data = row(m["id"].as_str().unwrap(), 1, m["payload"].clone());
                tamper(&mut data);
                json!({"idempotency_key": m["idempotency_key"], "resource": m["resource"],
                       "id": m["id"], "status": "applied", "replayed": false, "version": 1,
                       "data": data})
            })
            .collect();
        ResponseTemplate::new(200).set_body_json(json!({"data": {"results": results}, "meta": {}}))
    }
}

async fn push_with(tamper: fn(&mut Value)) -> (Env, Uuid) {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(tampered(tamper))
        .mount(&env.server)
        .await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    let id = Uuid::now_v7();
    env.engine
        .enqueue(draft(
            MutationOp::Create,
            "parties",
            id,
            json!({"name": "Yeni"}),
        ))
        .unwrap();
    (env, id)
}

fn assert_nothing_written(env: &Env, error: Option<keystone_sync::error::SyncError>) {
    let rows = env
        .store
        .list(&name("parties"), &Default::default())
        .unwrap();
    assert_eq!(
        rows.total, 0,
        "rows written from an invalid answer: {:?}",
        rows.rows
    );
    assert!(error.is_some(), "an invalid answer fails the run");
    let entries = env.engine.outbox().list().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].state, OutboxState::Pending);
}

#[tokio::test]
async fn a_push_row_with_another_id_is_not_written() {
    let (env, _) = push_with(|data| {
        data["id"] = json!("0193b1e8-0000-7d30-8333-0000000000c9");
    })
    .await;
    let error = env.engine.run_once(Trigger::Manual).await.err();
    assert_nothing_written(&env, error);
}

#[tokio::test]
async fn a_push_row_of_another_company_is_not_written() {
    let (env, id) = push_with(|data| {
        data["company_id"] = json!(OTHER_COMPANY);
    })
    .await;
    let error = env.engine.run_once(Trigger::Manual).await.err();
    assert!(env.store.get_row(&name("parties"), id).unwrap().is_none());
    assert_nothing_written(&env, error);
}

#[tokio::test]
async fn a_push_row_of_the_own_company_is_written() {
    let (env, id) = push_with(|data| {
        data["company_id"] = json!(COMPANY);
    })
    .await;
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert!(env.store.get_row(&name("parties"), id).unwrap().is_some());
    assert!(env.engine.outbox().list().unwrap().is_empty());
}
