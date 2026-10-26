//! Run limits and edges: a lost pull answer whose page size the manifest no
//! longer allows restarts the download instead of mixing cursor and limit;
//! pulls that make no progress or reset again and again fail the run; a
//! cancelled run settles its state and reports what it changed; network
//! failures do not count towards the quarantine.

mod engine_support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use engine_support::*;
use keystone_sync::engine::{SyncState, Trigger};
use keystone_sync::outbox::OutboxState;
use keystone_sync::wire::MutationOp;
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const PULL: &str = "/api/v1/sync/pull";
const PUSH: &str = "/api/v1/sync/push";
const A: &str = "0193b1e8-0000-7d30-8333-000000000001";
const B: &str = "0193b1e8-0000-7d30-8333-000000000002";

fn item(request: &Request) -> Value {
    body(request)["resources"][0].clone()
}

#[tokio::test]
async fn a_lost_answer_beyond_a_lowered_page_max_restarts_the_download() {
    let env = env_with(Duration::from_millis(400)).await;
    let manifests = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            let mut m = simple_manifest(&["parties"]);
            m["data"]["limits"]["pull_page_default"] = json!(2);
            if manifests.fetch_add(1, Ordering::SeqCst) > 0 {
                m["data"]["limits"]["pull_page_max"] = json!(1);
            }
            ResponseTemplate::new(200).set_body_json(m)
        })
        .mount(&env.server)
        .await;
    let pulls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(move |request: &Request| {
            let n = pulls.fetch_add(1, Ordering::SeqCst);
            let cursor_in = item(request)["cursor"].clone();
            let answer = if n == 0 {
                page(
                    "parties",
                    vec![row(A, 1, json!({}))],
                    vec![],
                    cursor(5, Some(A), 0, Some("s7")),
                    true,
                )
            } else if cursor_in.is_null() {
                page(
                    "parties",
                    vec![row(A, 1, json!({}))],
                    vec![],
                    cursor(5, Some(A), 0, Some("s8")),
                    true,
                )
            } else {
                page(
                    "parties",
                    vec![row(B, 1, json!({}))],
                    vec![],
                    cursor(9, None, 0, None),
                    false,
                )
            };
            let response = ResponseTemplate::new(200).set_body_json(pull_response(vec![answer]));
            if n == 1 {
                // The answer to the second page of session s7 is lost.
                response.set_delay(Duration::from_secs(2))
            } else {
                response
            }
        })
        .mount(&env.server)
        .await;

    let error = env.engine.run_once(Trigger::Startup).await.unwrap_err();
    assert_eq!(error.code(), "NETWORK_ERROR");
    let _ = env.engine.run_once(Trigger::Probe).await;
    let sent = bodies(&env.server, PULL).await;
    assert!(sent.len() >= 3, "{sent:?}");
    let retry = &sent[2]["resources"][0];
    assert_eq!(retry["limit"], 1);
    assert!(
        retry["cursor"].is_null(),
        "session s7 was started with limit 2; with limit 1 only a new download is valid: {retry}"
    );
}

#[tokio::test]
async fn a_pull_that_makes_no_progress_fails_the_run() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(|_: &Request| {
            // Always "more", never a step further.
            let answer = page("parties", vec![], vec![], cursor(5, Some(A), 0, None), true);
            ResponseTemplate::new(200).set_body_json(pull_response(vec![answer]))
        })
        .mount(&env.server)
        .await;
    let run = tokio::time::timeout(
        Duration::from_secs(60),
        env.engine.run_once(Trigger::Startup),
    )
    .await
    .expect("bounded");
    assert!(
        run.is_err(),
        "a run that did not finish the pull is no success"
    );
    assert!(matches!(env.engine.status().state, SyncState::Failed(_)));
    assert!(hits(&env.server, PULL).await <= 10);
}

#[tokio::test]
async fn endless_server_resets_fail_the_run() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(|_: &Request| {
            let answer = reset_page(
                "parties",
                vec![row(A, 1, json!({}))],
                cursor(5, Some(A), 0, Some("s1")),
                true,
                "cursor_expired",
            );
            ResponseTemplate::new(200).set_body_json(pull_response(vec![answer]))
        })
        .mount(&env.server)
        .await;
    let run = tokio::time::timeout(
        Duration::from_secs(60),
        env.engine.run_once(Trigger::Startup),
    )
    .await
    .expect("bounded");
    assert!(run.is_err());
    assert!(matches!(env.engine.status().state, SyncState::Failed(_)));
    assert!(hits(&env.server, PULL).await <= 10);
}

#[tokio::test]
async fn a_cancelled_run_settles_its_state_and_reports_changes() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    let pulls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(move |request: &Request| {
            let response = empty_pull(request);
            if pulls.fetch_add(1, Ordering::SeqCst) == 0 {
                response
            } else {
                response.set_delay(Duration::from_secs(5))
            }
        })
        .mount(&env.server)
        .await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(apply_all)
        .mount(&env.server)
        .await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine
        .enqueue(draft(
            MutationOp::Create,
            "parties",
            Uuid::now_v7(),
            json!({"name": "X"}),
        ))
        .unwrap();
    let mut changes = env.engine.subscribe_changes();
    while changes.try_recv().is_ok() {}

    // Push is applied, then the run is dropped while the pull waits.
    let cut = tokio::time::timeout(
        Duration::from_millis(1500),
        env.engine.run_once(Trigger::Manual),
    )
    .await;
    assert!(cut.is_err(), "the run was cancelled");
    assert_eq!(hits(&env.server, PUSH).await, 1);
    assert_ne!(env.engine.status().state, SyncState::Syncing);
    let mut changed = Vec::new();
    while let Ok(event) = changes.try_recv() {
        changed.extend(event.resources);
    }
    assert!(
        changed.contains(&name("parties")),
        "pushed rows are announced: {changed:?}"
    );
    // The engine is usable again.
    assert!(
        !env.engine
            .run_once(Trigger::Manual)
            .await
            .is_ok_and(|r| r.coalesced)
    );
}

#[tokio::test]
async fn lost_push_answers_end_in_quarantine() {
    let env = env_with(Duration::from_millis(300)).await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        // The answer never arrives in time: outcome unknown, no HTTP status.
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(2)))
        .mount(&env.server)
        .await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine
        .enqueue(draft(
            MutationOp::Create,
            "parties",
            Uuid::now_v7(),
            json!({"name": "X"}),
        ))
        .unwrap();
    // Outcome unknown each time: it may have been applied. After the
    // attempt limit the entry waits for the user instead of holding the
    // queue forever (a never-sent push does not count, see the unit tests).
    for _ in 0..5 {
        let error = env.engine.run_once(Trigger::Probe).await.unwrap_err();
        assert_eq!(error.code(), "NETWORK_ERROR");
    }
    let entries = outbox_list(&env.store);
    assert_eq!(entries[0].state, OutboxState::Quarantined);
    assert_eq!(env.engine.status().quarantined, 1);
    env.engine.run_once(Trigger::Probe).await.unwrap();
    assert_eq!(hits(&env.server, PUSH).await, 5);
}

#[tokio::test]
async fn a_follow_up_promised_to_a_coalesced_caller_survives_cancellation() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(|request: &Request| empty_pull(request).set_delay(Duration::from_secs(5)))
        .mount(&env.server)
        .await;
    let mut running = Box::pin(env.engine.run_once(Trigger::Manual));
    tokio::select! {
        _ = &mut running => panic!("the pull answers late"),
        () = tokio::time::sleep(Duration::from_millis(300)) => {}
    }
    let second = env
        .engine
        .run_once(Trigger::Realtime(name("parties")))
        .await
        .unwrap();
    assert!(second.coalesced, "a follow-up run was promised");
    drop(running);

    let requested =
        tokio::time::timeout(Duration::from_secs(2), env.engine.follow_up_requested()).await;
    assert!(
        requested.is_ok(),
        "the promised follow-up run was dropped with the cancelled run"
    );
}
