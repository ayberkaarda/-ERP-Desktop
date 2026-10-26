//! One run at a time: concurrent triggers coalesce into a single follow-up
//! run, and the loop collapses queued triggers.

mod engine_support;

use std::time::Duration;

use engine_support::*;
use keystone_sync::engine::{SyncState, Trigger, sync_loop};
use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";

async fn wait_for_hits(env: &Env, at_least: usize) {
    for _ in 0..200 {
        if hits(&env.server, MANIFEST).await >= at_least {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("no {at_least} manifest requests");
}

#[tokio::test]
async fn concurrent_triggers_run_once_plus_one_follow_up() {
    let env = env().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(simple_manifest(&["parties"]))
                .set_delay(Duration::from_millis(300)),
        )
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;

    let e = &env.engine;
    let first = e.run_once(Trigger::Startup);
    let others = async {
        // Let the first call take the run.
        tokio::time::sleep(Duration::from_millis(50)).await;
        tokio::join!(
            e.run_once(Trigger::Manual),
            e.run_once(Trigger::NetworkChanged),
            e.run_once(Trigger::Realtime(name("parties"))),
            e.run_once(Trigger::Timer),
        )
    };
    let (first, (a, b, c, d)) = tokio::join!(first, others);
    assert!(!first.unwrap().coalesced);
    for other in [a, b, c, d] {
        assert!(other.unwrap().coalesced);
    }
    // The running call did exactly one follow-up for the four triggers.
    assert_eq!(hits(&env.server, MANIFEST).await, 2);
    assert_eq!(e.status().state, SyncState::Idle);

    // Idle again: the next call runs itself.
    assert!(!e.run_once(Trigger::Manual).await.unwrap().coalesced);
    assert_eq!(hits(&env.server, MANIFEST).await, 3);
}

#[tokio::test]
async fn the_loop_runs_at_startup_and_collapses_queued_triggers() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    let mut status = env.engine.subscribe();

    let (handle, sync) = sync_loop(env.engine.clone());
    let task = tokio::spawn(sync.run());
    wait_for_hits(&env, 1).await;
    status
        .wait_for(|s| s.state == SyncState::Idle)
        .await
        .unwrap();

    // Three triggers while the loop waits for its 60 s timer: one run.
    assert!(handle.trigger(Trigger::NetworkChanged));
    assert!(handle.trigger(Trigger::Manual));
    assert!(handle.trigger(Trigger::Realtime(name("parties"))));
    wait_for_hits(&env, 2).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(hits(&env.server, MANIFEST).await, 2);

    drop(handle);
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .expect("loop stops when the handles are gone")
        .unwrap();
}
