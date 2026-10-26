//! Engine pull against wiremock: full download with a cursor session, then
//! incremental; `Stale` pages; lost answers retried verbatim; server
//! resets (`cursor_expired`), `SYNC_CURSOR_INVALID`; visibility generation
//! changes and resources leaving the manifest.

mod engine_support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use engine_support::*;
use keystone_sync::engine::{SyncState, Trigger};
use keystone_sync::store::{LocalCopy, MirrorStore};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const A: &str = "0193b1e8-0000-7d30-8333-000000000001";
const B: &str = "0193b1e8-0000-7d30-8333-000000000002";
const C: &str = "0193b1e8-0000-7d30-8333-000000000003";
const D: &str = "0193b1e8-0000-7d30-8333-000000000004";
const PULL: &str = "/api/v1/sync/pull";

fn ids(env: &Env, resource: &str) -> Vec<String> {
    let page = env
        .store
        .list(&name(resource), &Default::default())
        .unwrap();
    let mut ids: Vec<String> = page.rows.iter().map(|r| r.id.to_string()).collect();
    ids.sort();
    ids
}

fn parties(request: &Request) -> Value {
    body(request)["resources"][0].clone()
}

/// Full download over two pages (session `s1`), then one incremental page.
fn two_page_download(request: &Request) -> ResponseTemplate {
    let item = parties(request);
    let cursor_in = &item["cursor"];
    let answer = if cursor_in.is_null() {
        page(
            "parties",
            vec![
                row(A, 1, json!({"name": "Ankara"})),
                row(B, 1, json!({"name": "Bursa"})),
            ],
            vec![],
            cursor(40, Some(B), 0, Some("s1")),
            true,
        )
    } else if cursor_in["session"] == "s1" {
        page(
            "parties",
            vec![row(C, 1, json!({"name": "Ceyhan"}))],
            vec![],
            cursor(50, None, 0, None),
            false,
        )
    } else {
        page(
            "parties",
            vec![row(B, 2, json!({"name": "Bursa Yeni"}))],
            vec![tombstone("parties", A, 55)],
            cursor(60, None, 0, None),
            false,
        )
    };
    ResponseTemplate::new(200).set_body_json(pull_response(vec![answer]))
}

#[tokio::test]
async fn full_download_pages_with_the_session_then_pulls_incrementally() {
    let mut manifest = simple_manifest(&["parties"]);
    manifest["data"]["limits"]["pull_page_default"] = json!(2);
    let env = env().await;
    mount_manifest(&env.server, manifest).await;
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(two_page_download)
        .mount(&env.server)
        .await;
    let mut changes = env.engine.subscribe_changes();

    let report = env.engine.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(report.pull_requests, 2);
    assert_eq!(report.rows_upserted, 3);
    assert_eq!(ids(&env, "parties"), [A, B, C]);
    assert_eq!(
        env.store.local_copy(&name("parties")).unwrap(),
        LocalCopy::Complete
    );
    assert_eq!(env.engine.status().state, SyncState::Idle);
    assert_eq!(changes.try_recv().unwrap().resources, [name("parties")]);

    let sent = bodies(&env.server, PULL).await;
    assert_eq!(
        sent[0]["resources"][0],
        json!({"resource": "parties", "cursor": null, "limit": 2})
    );
    // The cursor goes back whole, session included.
    assert_eq!(
        sent[1]["resources"][0],
        json!({"resource": "parties", "cursor": cursor(40, Some(B), 0, Some("s1")), "limit": 2})
    );

    let report = env.engine.run_once(Trigger::Timer).await.unwrap();
    assert_eq!((report.rows_upserted, report.rows_removed), (1, 1));
    let sent = bodies(&env.server, PULL).await;
    assert_eq!(sent[2]["resources"][0]["cursor"], cursor(50, None, 0, None));
    assert_eq!(ids(&env, "parties"), [B, C]);
    let b = env
        .store
        .get_row(&name("parties"), Uuid::parse_str(B).unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(b.fields["name"], "Bursa Yeni");
    assert_eq!(
        env.store.cursor(&name("parties")).unwrap().unwrap().txid.0,
        60
    );
}

#[tokio::test]
async fn a_stale_page_is_requested_again_from_a_fresh_base() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    let store = env.store.clone();
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(move |request: &Request| {
            let n = seen.fetch_add(1, Ordering::SeqCst);
            let item = parties(request);
            let answer = match n {
                // Run 1: full download.
                0 => page(
                    "parties",
                    vec![row(A, 1, json!({}))],
                    vec![],
                    cursor(10, None, 0, None),
                    false,
                ),
                // Run 2: the resource is reset locally while the request is
                // out, so this answer must not be applied.
                1 => {
                    assert_eq!(item["cursor"], cursor(10, None, 0, None));
                    store.reset_resource(&name("parties")).unwrap();
                    page(
                        "parties",
                        vec![row(B, 1, json!({}))],
                        vec![],
                        cursor(20, None, 0, None),
                        false,
                    )
                }
                _ => {
                    assert!(item["cursor"].is_null(), "rebuilt from the reset base");
                    page(
                        "parties",
                        vec![row(C, 1, json!({}))],
                        vec![],
                        cursor(30, None, 0, None),
                        false,
                    )
                }
            };
            ResponseTemplate::new(200).set_body_json(pull_response(vec![answer]))
        })
        .mount(&env.server)
        .await;

    env.engine.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(ids(&env, "parties"), [A]);
    let report = env.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(report.stale_pages, 1);
    assert_eq!(report.pull_requests, 2);
    assert_eq!(ids(&env, "parties"), [C]);
    assert_eq!(
        env.store.cursor(&name("parties")).unwrap().unwrap().txid.0,
        30
    );
}

#[tokio::test]
async fn a_lost_answer_is_retried_with_the_same_limit_and_cursor() {
    let env = env_with(Duration::from_millis(400)).await;
    let manifests = Arc::new(AtomicUsize::new(0));
    let m = manifests.clone();
    Mock::given(method("GET"))
        .and(path("/api/v1/sync/manifest"))
        .respond_with(move |_: &Request| {
            // The page size changes after the first run.
            let default = if m.fetch_add(1, Ordering::SeqCst) == 0 {
                2
            } else {
                7
            };
            let mut manifest = simple_manifest(&["parties"]);
            manifest["data"]["limits"]["pull_page_default"] = json!(default);
            ResponseTemplate::new(200).set_body_json(manifest)
        })
        .mount(&env.server)
        .await;
    let session_calls = Arc::new(AtomicUsize::new(0));
    let s = session_calls.clone();
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(move |request: &Request| {
            let item = parties(request);
            if item["cursor"].is_null() {
                let first = page(
                    "parties",
                    vec![row(A, 1, json!({}))],
                    vec![],
                    cursor(5, Some(A), 0, Some("s9")),
                    true,
                );
                return ResponseTemplate::new(200).set_body_json(pull_response(vec![first]));
            }
            if item["cursor"]["session"] == "s9" {
                let answer = page(
                    "parties",
                    vec![row(B, 1, json!({}))],
                    vec![],
                    cursor(9, None, 0, None),
                    false,
                );
                let response =
                    ResponseTemplate::new(200).set_body_json(pull_response(vec![answer]));
                // The first answer to the second page is lost.
                return if s.fetch_add(1, Ordering::SeqCst) == 0 {
                    response.set_delay(Duration::from_secs(2))
                } else {
                    response
                };
            }
            let answer = page("parties", vec![], vec![], cursor(9, None, 0, None), false);
            ResponseTemplate::new(200).set_body_json(pull_response(vec![answer]))
        })
        .mount(&env.server)
        .await;

    let error = env.engine.run_once(Trigger::Startup).await.unwrap_err();
    assert_eq!(error.code(), "NETWORK_ERROR");
    assert_eq!(env.engine.status().state, SyncState::Offline);
    assert_eq!(
        env.store.local_copy(&name("parties")).unwrap(),
        LocalCopy::Partial
    );

    env.engine.run_once(Trigger::Probe).await.unwrap();
    let sent = bodies(&env.server, PULL).await;
    assert_eq!(sent.len(), 3);
    // Same cursor (session included) and the old limit, not the new 7.
    assert_eq!(sent[2], sent[1]);
    assert_eq!(sent[2]["resources"][0]["limit"], 2);
    assert_eq!(sent[2]["resources"][0]["cursor"]["session"], "s9");
    assert_eq!(ids(&env, "parties"), [A, B]);
    assert_eq!(
        env.store.local_copy(&name("parties")).unwrap(),
        LocalCopy::Complete
    );

    // A new request takes the new page size.
    env.engine.run_once(Trigger::Timer).await.unwrap();
    let sent = bodies(&env.server, PULL).await;
    assert_eq!(sent[3]["resources"][0]["limit"], 7);
}

#[tokio::test]
async fn reset_answers_replace_the_local_copy() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(move |request: &Request| {
            let item = parties(request);
            let answer = match seen.fetch_add(1, Ordering::SeqCst) {
                0 => page(
                    "parties",
                    vec![row(A, 1, json!({})), row(B, 1, json!({}))],
                    vec![],
                    cursor(10, None, 0, None),
                    false,
                ),
                // The incremental cursor is below the tombstone floor.
                1 => {
                    assert_eq!(item["cursor"], cursor(10, None, 0, None));
                    reset_page(
                        "parties",
                        vec![row(C, 3, json!({}))],
                        cursor(70, Some(C), 0, Some("s2")),
                        true,
                        "cursor_expired",
                    )
                }
                2 => {
                    assert_eq!(item["cursor"]["session"], "s2");
                    page(
                        "parties",
                        vec![row(D, 1, json!({}))],
                        vec![],
                        cursor(80, None, 0, None),
                        false,
                    )
                }
                // SYNC_CURSOR_INVALID: the engine drops the copy and starts over.
                3 => {
                    return ResponseTemplate::new(422).set_body_json(error_body(
                        "SYNC_CURSOR_INVALID",
                        "cursor ahead of horizon",
                    ));
                }
                _ => {
                    assert!(item["cursor"].is_null());
                    page(
                        "parties",
                        vec![row(A, 5, json!({}))],
                        vec![],
                        cursor(90, None, 0, None),
                        false,
                    )
                }
            };
            ResponseTemplate::new(200).set_body_json(pull_response(vec![answer]))
        })
        .mount(&env.server)
        .await;

    env.engine.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(ids(&env, "parties"), [A, B]);

    let report = env.engine.run_once(Trigger::Timer).await.unwrap();
    assert_eq!(report.pull_requests, 2);
    assert_eq!(ids(&env, "parties"), [C, D]);
    assert_eq!(
        env.store.local_copy(&name("parties")).unwrap(),
        LocalCopy::Complete
    );

    let report = env.engine.run_once(Trigger::Timer).await.unwrap();
    assert_eq!(report.pull_requests, 2);
    assert_eq!(ids(&env, "parties"), [A]);
    assert_eq!(
        env.store.cursor(&name("parties")).unwrap().unwrap().txid.0,
        90
    );
}

#[tokio::test]
async fn a_new_visibility_generation_resets_and_dropped_resources_are_removed() {
    let env = env().await;
    let manifests = Arc::new(AtomicUsize::new(0));
    let m = manifests.clone();
    Mock::given(method("GET"))
        .and(path("/api/v1/sync/manifest"))
        .respond_with(move |_: &Request| {
            let body = match m.fetch_add(1, Ordering::SeqCst) {
                0 => manifest(
                    USER_A,
                    vec![resource("parties", 0), resource("items", 0)],
                    200,
                    100,
                ),
                // parties: generation 0 -> 3; items: permission lost.
                _ => manifest(USER_A, vec![resource("parties", 3)], 200, 100),
            };
            ResponseTemplate::new(200).set_body_json(body)
        })
        .mount(&env.server)
        .await;
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(|request: &Request| {
            let pages: Vec<Value> = body(request)["resources"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| {
                    let resource = item["resource"].as_str().unwrap();
                    match (resource, item["cursor"].is_null()) {
                        ("parties", true) => page(
                            "parties",
                            vec![row(A, 1, json!({}))],
                            vec![],
                            cursor(10, None, 0, None),
                            false,
                        ),
                        ("items", _) => page(
                            "items",
                            vec![row(B, 1, json!({}))],
                            vec![],
                            cursor(10, None, 0, None),
                            false,
                        ),
                        _ => page(resource, vec![], vec![], cursor(10, None, 0, None), false),
                    }
                })
                .collect();
            ResponseTemplate::new(200).set_body_json(pull_response(pages))
        })
        .mount(&env.server)
        .await;

    env.engine.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(ids(&env, "parties"), [A]);
    assert_eq!(ids(&env, "items"), [B]);
    // A row that the new visibility no longer shows.
    env.store
        .put_row(
            &name("parties"),
            &serde_json::from_value(row(C, 1, json!({}))).unwrap(),
        )
        .unwrap();

    let report = env.engine.run_once(Trigger::Timer).await.unwrap();
    let sent = bodies(&env.server, PULL).await;
    let last = &sent[sent.len() - 1]["resources"];
    assert_eq!(
        last.as_array().unwrap().len(),
        1,
        "items is no longer pulled"
    );
    assert!(
        last[0]["cursor"].is_null(),
        "parties starts a full download"
    );
    assert_eq!(ids(&env, "parties"), [A]);
    assert!(ids(&env, "items").is_empty());
    assert!(env.store.cursor(&name("items")).unwrap().is_none());
    assert!(report.changed.contains(&name("items")));
    assert!(report.changed.contains(&name("parties")));
}
