//! Snapshot resources through the engine: read and stored only while the
//! local data is verified for the current sign-in, stored only for the
//! generation the answer was fetched in, gone with a seal or a wipe.

mod engine_support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use engine_support::*;
use keystone_sync::auth::TokenStore;
use keystone_sync::engine::Trigger;
use keystone_sync::store::raw::prelude::*;
use keystone_sync::wire::Timestamp;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";

fn snapshot_resource(name: &str) -> Value {
    let mut entry = resource(name, 0);
    entry["source"] = json!("snapshot");
    entry["read"] = json!("online-first");
    entry
}

fn manifest_of(user: &str) -> Value {
    manifest(
        user,
        vec![resource("parties", 0), snapshot_resource("units")],
        200,
        100,
    )
}

fn at() -> Timestamp {
    Timestamp("2026-10-26T09:30:00+03:00".into())
}

fn units() -> Value {
    json!({"data": [{"id": 1, "code": "pcs"}]})
}

fn generation(env: &Env) -> u64 {
    env.tokens.load_record(PROFILE).unwrap().generation
}

/// Manifest answers by call: user A until `switch_at`, user B after it.
async fn mount_users(env: &Env, switch_at: usize) {
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            let user = if calls.fetch_add(1, Ordering::SeqCst) < switch_at {
                USER_A
            } else {
                USER_B
            };
            ResponseTemplate::new(200).set_body_json(manifest_of(user))
        })
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
}

#[tokio::test]
async fn nothing_is_read_or_stored_before_a_run_verified_the_sign_in() {
    let env = env().await;
    mount_users(&env, usize::MAX).await;
    let units = name("units");
    let g = generation(&env);
    assert_eq!(
        env.engine.snapshot(&units).unwrap_err().code(),
        "OFFLINE_UNAVAILABLE"
    );
    assert_eq!(
        env.engine
            .put_snapshot(&units, &self::units(), &at(), g)
            .unwrap_err()
            .code(),
        "OFFLINE_UNAVAILABLE"
    );
    assert_eq!(
        env.engine.prune().unwrap_err().code(),
        "OFFLINE_UNAVAILABLE"
    );
    assert!(env.store.snapshot(&units).unwrap().is_none());

    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine
        .put_snapshot(&units, &self::units(), &at(), g)
        .unwrap();
    let stored = env.engine.snapshot(&units).unwrap().expect("stored");
    assert_eq!((stored.data, stored.fetched_at), (self::units(), at()));
    env.engine.prune().unwrap();
}

#[tokio::test]
async fn an_answer_of_an_earlier_sign_in_is_never_stored() {
    let env = env().await;
    mount_users(&env, usize::MAX).await;
    let units = name("units");
    env.engine.run_once(Trigger::Startup).await.unwrap();
    let fetched_in = generation(&env);

    // The same user signs in again while the answer is on its way.
    sign_in_as(&env.tokens, 2).await;
    env.engine.run_once(Trigger::Manual).await.unwrap();
    let error = env
        .engine
        .put_snapshot(&units, &self::units(), &at(), fetched_in)
        .unwrap_err();
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert!(env.store.snapshot(&units).unwrap().is_none());

    env.engine
        .put_snapshot(&units, &self::units(), &at(), generation(&env))
        .unwrap();
    assert!(env.engine.snapshot(&units).unwrap().is_some());
}

#[tokio::test]
async fn only_snapshot_resources_of_the_manifest_are_stored() {
    let env = env().await;
    mount_users(&env, usize::MAX).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    let g = generation(&env);
    let pulled = env
        .engine
        .put_snapshot(&name("parties"), &units(), &at(), g)
        .unwrap_err();
    assert_eq!(pulled.code(), "INVALID_REQUEST");
    let unknown = env
        .engine
        .put_snapshot(&name("warehouses"), &units(), &at(), g)
        .unwrap_err();
    assert_eq!(unknown.code(), "FORBIDDEN");
    assert!(env.store.snapshot_resources().unwrap().is_empty());
    assert_eq!(
        env.engine.snapshot(&name("warehouses")).unwrap_err().code(),
        "FORBIDDEN"
    );
}

#[tokio::test]
async fn a_new_user_reads_no_snapshot_of_the_previous_one() {
    let env = env().await;
    mount_users(&env, 1).await;
    let units = name("units");
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine
        .put_snapshot(&units, &self::units(), &at(), generation(&env))
        .unwrap();

    // User B signs in: until a run checked who it is, nothing is served.
    sign_in_as(&env.tokens, 2).await;
    assert_eq!(
        env.engine.snapshot(&units).unwrap_err().code(),
        "OFFLINE_UNAVAILABLE"
    );
    // The run sees another user and wipes the local data, snapshots included.
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert!(env.engine.snapshot(&units).unwrap().is_none());
    assert!(env.store.snapshot(&units).unwrap().is_none());
}

#[tokio::test]
async fn a_sealed_store_neither_serves_nor_takes_snapshots() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            move |_: &Request| match calls.fetch_add(1, Ordering::SeqCst) {
                0 => ResponseTemplate::new(200).set_body_json(manifest_of(USER_A)),
                _ => {
                    ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "off"))
                }
            },
        )
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    let units = name("units");
    env.engine.run_once(Trigger::Startup).await.unwrap();
    let g = generation(&env);
    env.engine
        .put_snapshot(&units, &self::units(), &at(), g)
        .unwrap();

    let error = env.engine.run_once(Trigger::Timer).await.unwrap_err();
    assert_eq!(error.code(), "USER_DEACTIVATED");
    assert!(env.store.snapshot(&units).unwrap().is_none(), "sealed");
    assert_eq!(
        env.engine.snapshot(&units).unwrap_err().code(),
        "OFFLINE_UNAVAILABLE"
    );
    assert_eq!(
        env.engine
            .put_snapshot(&units, &self::units(), &at(), g)
            .unwrap_err()
            .code(),
        "OFFLINE_UNAVAILABLE"
    );
    assert!(env.store.snapshot(&units).unwrap().is_none());
}
