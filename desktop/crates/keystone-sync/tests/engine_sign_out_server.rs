//! Sign-out tells the server (`POST /api/v1/auth/logout`) before the tokens
//! go, best effort: whatever the server answers, or when it does not, the
//! local sign-out completes, and `server_revoked` says how it went.

mod engine_support;

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine_support::*;
use keystone_sync::auth::TokenStore;
use keystone_sync::engine::{SERVER_SIGN_OUT_TIMEOUT, SignOut, Trigger};
use keystone_sync::wire::MutationOp;
use serde_json::json;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const LOGOUT: &str = "/api/v1/auth/logout";
const REFRESH: &str = "/api/v1/auth/device/refresh";

fn done(server_revoked: bool) -> SignOut {
    SignOut::Done { server_revoked }
}

async fn mount_logout(env: &Env, answer: ResponseTemplate) {
    Mock::given(method("POST"))
        .and(path(LOGOUT))
        .respond_with(answer)
        .mount(&env.server)
        .await;
}

async fn mount_refresh(env: &Env, answer: ResponseTemplate) {
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(answer)
        .mount(&env.server)
        .await;
}

fn new_pair() -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({"data": {
        "token": "access-7-0123456789abcdef",
        "expires_at": "2026-10-26T11:15:00+03:00",
        "refresh_token": "refresh-7-0123456789abcdef",
        "refresh_expires_at": "2026-11-25T09:15:00+03:00",
    }}))
}

fn unauthenticated() -> ResponseTemplate {
    ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Unauthenticated."))
}

/// Requests received on `p`, in order.
async fn requests(env: &Env, p: &str) -> Vec<Request> {
    env.server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|r| r.url.path() == p)
        .collect()
}

/// A verified sign-in with one mirror row, so the wipe is visible.
async fn synced_env() -> Env {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        "0192f5a0-0000-7000-8000-0000000000a1",
        json!({"name": "A Ltd"}),
    );
    env
}

/// Tokens gone and the local data wiped: the local sign-out happened.
fn signed_out_locally(env: &Env) {
    assert_eq!(env.tokens.load(PROFILE).unwrap(), None, "tokens remain");
    assert_eq!(
        env.store.row_count(&name("parties")).unwrap(),
        0,
        "local data remains"
    );
}

#[tokio::test]
async fn a_204_ends_the_server_session_with_the_tokens_still_stored() {
    let env = synced_env().await;
    let stored_at_call = Arc::new(Mutex::new(None));
    let (seen, store) = (stored_at_call.clone(), env.tokens.clone());
    Mock::given(method("POST"))
        .and(path(LOGOUT))
        .respond_with(move |_: &Request| {
            *seen.lock().unwrap() = Some(store.load(PROFILE).unwrap());
            ResponseTemplate::new(204)
        })
        .mount(&env.server)
        .await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    signed_out_locally(&env);
    assert_eq!(
        *stored_at_call.lock().unwrap(),
        Some(Some(tokens(1))),
        "the server was asked after the tokens were removed"
    );
    let calls = requests(&env, LOGOUT).await;
    assert_eq!(calls.len(), 1);
    assert_eq!(
        bearer_of(&calls[0]).as_deref(),
        Some("Bearer access-1-0123456789abcdef")
    );
}

#[tokio::test]
async fn a_200_with_a_body_counts_as_ended() {
    let env = synced_env().await;
    mount_logout(
        &env,
        ResponseTemplate::new(200).set_body_json(json!({"data": null})),
    )
    .await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    signed_out_locally(&env);
}

#[tokio::test]
async fn the_request_carries_the_token_only_in_the_authorization_header() {
    let env = synced_env().await;
    mount_logout(&env, ResponseTemplate::new(204)).await;

    env.engine.sign_out(false).await.unwrap();
    let call = requests(&env, LOGOUT).await.remove(0);
    assert!(call.body.is_empty(), "a body was sent");
    assert_eq!(call.url.query(), None);
    assert_eq!(
        call.headers
            .get("x-company-id")
            .and_then(|v| v.to_str().ok()),
        Some(COMPANY)
    );
    for (name, value) in call.headers.iter() {
        if name.as_str() == "authorization" {
            continue;
        }
        let value = value.to_str().unwrap_or_default();
        assert!(
            !value.contains("access-1") && !value.contains("refresh-1"),
            "token in header {name}"
        );
    }
    assert!(requests(&env, REFRESH).await.is_empty());
}

#[tokio::test]
async fn a_401_whose_refresh_is_refused_means_already_ended() {
    let env = synced_env().await;
    mount_logout(&env, unauthenticated()).await;
    mount_refresh(&env, unauthenticated()).await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    signed_out_locally(&env);
    assert_eq!(requests(&env, LOGOUT).await.len(), 1, "sent again");
    assert_eq!(requests(&env, REFRESH).await.len(), 1);
}

#[tokio::test]
async fn an_expired_access_token_is_refreshed_once_and_the_logout_sent_again() {
    let env = synced_env().await;
    let calls = AtomicUsize::new(0);
    Mock::given(method("POST"))
        .and(path(LOGOUT))
        .respond_with(
            move |_: &Request| match calls.fetch_add(1, Ordering::SeqCst) {
                0 => unauthenticated(),
                _ => ResponseTemplate::new(204),
            },
        )
        .mount(&env.server)
        .await;
    mount_refresh(&env, new_pair()).await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    signed_out_locally(&env);
    let calls = requests(&env, LOGOUT).await;
    assert_eq!(calls.len(), 2);
    assert_eq!(
        bearer_of(&calls[1]).as_deref(),
        Some("Bearer access-7-0123456789abcdef"),
        "the retry did not use the refreshed token"
    );
    assert_eq!(
        body(&requests(&env, REFRESH).await[0])["refresh_token"],
        "refresh-1-0123456789abcdef"
    );
}

#[tokio::test]
async fn a_second_401_after_a_refresh_ends_without_a_loop() {
    let env = synced_env().await;
    mount_logout(&env, unauthenticated()).await;
    mount_refresh(&env, new_pair()).await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    signed_out_locally(&env);
    assert_eq!(requests(&env, LOGOUT).await.len(), 2);
    assert_eq!(requests(&env, REFRESH).await.len(), 1);
}

#[tokio::test]
async fn a_refresh_that_fails_otherwise_is_not_confirmed() {
    for status in [500, 429] {
        let env = synced_env().await;
        mount_logout(&env, unauthenticated()).await;
        mount_refresh(&env, ResponseTemplate::new(status)).await;

        assert_eq!(
            env.engine.sign_out(false).await.unwrap(),
            done(false),
            "refresh {status}"
        );
        signed_out_locally(&env);
    }
}

#[tokio::test]
async fn refusals_and_server_errors_still_sign_out_locally() {
    for status in [403, 404, 419, 429, 500, 502, 503] {
        let env = synced_env().await;
        mount_logout(
            &env,
            ResponseTemplate::new(status).set_body_json(error_body("FORBIDDEN", "no")),
        )
        .await;

        assert_eq!(
            env.engine.sign_out(false).await.unwrap(),
            done(false),
            "HTTP {status}"
        );
        signed_out_locally(&env);
        assert_eq!(requests(&env, LOGOUT).await.len(), 1, "HTTP {status}");
        assert!(requests(&env, REFRESH).await.is_empty(), "HTTP {status}");
    }
}

#[tokio::test]
async fn no_server_signs_out_locally_at_once() {
    // Port 1: nothing listens there, and no test server can take it over.
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(
        keystone_sync::store::Store::open(
            dir.path().join("offline.db"),
            &keystone_sync::store::DbKey::from_bytes([9; 32]),
        )
        .unwrap(),
    );
    let tokens = Arc::new(keystone_sync::auth::MemoryTokenStore::default());
    sign_in_as(&tokens, 1).await;
    let client = keystone_sync::client::HttpClient::new(
        &keystone_sync::client::ApiConfig {
            base_url: "http://127.0.0.1:1".into(),
            company_id: Uuid::parse_str(COMPANY).unwrap(),
            user_agent: "keystone-desktop-test".into(),
        },
        PROFILE,
        tokens.clone(),
        &keystone_sync::client::ClientOptions {
            connect_timeout: Duration::from_secs(30),
            request_timeout: Duration::from_secs(30),
            allow_http_localhost: true,
        },
    )
    .unwrap();
    let engine = keystone_sync::engine::SyncEngine::new(client, store);

    let started = std::time::Instant::now();
    assert_eq!(engine.sign_out(false).await.unwrap(), done(false));
    // Ended by the refused connection, not by the timeout.
    assert!(
        started.elapsed() < SERVER_SIGN_OUT_TIMEOUT,
        "waited {:?} for a refused connection",
        started.elapsed()
    );
    assert_eq!(tokens.load(PROFILE).unwrap(), None);
}

#[tokio::test]
async fn a_silent_server_is_given_up_on_after_the_timeout() {
    let env = synced_env().await;
    mount_logout(
        &env,
        ResponseTemplate::new(204).set_delay(Duration::from_secs(300)),
    )
    .await;
    tokio::time::pause();

    let started = tokio::time::Instant::now();
    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(false));
    let waited = started.elapsed();
    tokio::time::resume();
    assert!(
        waited >= SERVER_SIGN_OUT_TIMEOUT
            && waited < SERVER_SIGN_OUT_TIMEOUT + Duration::from_secs(1),
        "waited {waited:?}"
    );
    signed_out_locally(&env);
}

#[test]
fn the_timeout_is_short() {
    assert!(SERVER_SIGN_OUT_TIMEOUT >= Duration::from_secs(3));
    assert!(SERVER_SIGN_OUT_TIMEOUT <= Duration::from_secs(5));
}

#[tokio::test]
async fn unsent_work_asks_first_and_tells_the_server_nothing() {
    let env = synced_env().await;
    mount_logout(&env, ResponseTemplate::new(204)).await;
    env.engine
        .enqueue(draft(
            MutationOp::Create,
            "parties",
            Uuid::now_v7(),
            json!({"name": "unsent"}),
        ))
        .unwrap();

    let refused = env.engine.sign_out(false).await.unwrap();
    assert!(matches!(refused, SignOut::PendingWork { outbox: 1, .. }));
    assert!(
        requests(&env, LOGOUT).await.is_empty(),
        "told before the dialog"
    );
    assert_eq!(env.tokens.load(PROFILE).unwrap(), Some(tokens(1)));

    assert_eq!(env.engine.sign_out(true).await.unwrap(), done(true));
    assert_eq!(requests(&env, LOGOUT).await.len(), 1);
    signed_out_locally(&env);
    assert!(outbox_list(&env.store).is_empty());
}

#[tokio::test]
async fn a_second_sign_out_has_nothing_to_tell() {
    let env = synced_env().await;
    mount_logout(&env, ResponseTemplate::new(204)).await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    // No token left to ask with: not confirmed by this call.
    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(false));
    assert_eq!(requests(&env, LOGOUT).await.len(), 1);
}

#[tokio::test]
async fn a_deactivated_account_counts_as_ended() {
    let env = synced_env().await;
    mount_logout(
        &env,
        ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "off")),
    )
    .await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    signed_out_locally(&env);
    assert!(requests(&env, REFRESH).await.is_empty());
}

#[tokio::test]
async fn an_unfinished_sign_out_at_its_revoke_tells_the_server() {
    let env = synced_env().await;
    mount_logout(&env, ResponseTemplate::new(204)).await;
    leave_sign_out_unfinished(&env.store, 1, "revoke");

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    let calls = requests(&env, LOGOUT).await;
    assert_eq!(
        calls.len(),
        1,
        "the unfinished sign-out never told the server"
    );
    assert_eq!(
        bearer_of(&calls[0]).as_deref(),
        Some("Bearer access-1-0123456789abcdef")
    );
    signed_out_locally(&env);
}

#[tokio::test]
async fn a_run_finishing_a_sign_out_at_its_revoke_tells_the_server() {
    let env = synced_env().await;
    mount_logout(&env, ResponseTemplate::new(204)).await;
    leave_sign_out_unfinished(&env.store, 1, "revoke");

    let _ = env.engine.run_once(Trigger::Manual).await;
    let calls = requests(&env, LOGOUT).await;
    assert_eq!(
        calls.len(),
        1,
        "the run removed the tokens without telling the server"
    );
    assert_eq!(
        bearer_of(&calls[0]).as_deref(),
        Some("Bearer access-1-0123456789abcdef")
    );
    signed_out_locally(&env);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sign_in_cannot_land_while_the_server_is_asked() {
    let env = synced_env().await;
    let landed = Arc::new(AtomicBool::new(false));
    let worker = Arc::new(Mutex::new(None));
    let (flag, slot, store) = (landed.clone(), worker.clone(), env.tokens.clone());
    Mock::given(method("POST"))
        .and(path(LOGOUT))
        .respond_with(move |_: &Request| {
            let store = store.clone();
            let sign_in = std::thread::spawn(move || sign_in_blocking(store, 2));
            std::thread::sleep(Duration::from_millis(400));
            flag.store(sign_in.is_finished(), Ordering::SeqCst);
            *slot.lock().unwrap() = Some(sign_in);
            ResponseTemplate::new(204)
        })
        .mount(&env.server)
        .await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    worker.lock().unwrap().take().unwrap().join().unwrap();
    assert!(
        !landed.load(Ordering::SeqCst),
        "a sign-in landed in the middle of the sign-out"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_timeout_also_bounds_the_refresh() {
    let env = synced_env().await;
    mount_logout(&env, unauthenticated()).await;
    mount_refresh(&env, new_pair().set_delay(Duration::from_secs(8))).await;

    let started = std::time::Instant::now();
    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(false));
    let waited = started.elapsed();
    assert!(
        waited < SERVER_SIGN_OUT_TIMEOUT + Duration::from_millis(500),
        "waited {waited:?}"
    );
    signed_out_locally(&env);
}

#[tokio::test]
async fn a_failed_retry_after_the_refresh_is_not_confirmed() {
    let env = synced_env().await;
    let calls = AtomicUsize::new(0);
    Mock::given(method("POST"))
        .and(path(LOGOUT))
        .respond_with(
            move |_: &Request| match calls.fetch_add(1, Ordering::SeqCst) {
                0 => unauthenticated(),
                _ => ResponseTemplate::new(500),
            },
        )
        .mount(&env.server)
        .await;
    mount_refresh(&env, new_pair()).await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(false));
    signed_out_locally(&env);
}

#[tokio::test]
async fn a_refresh_refused_for_a_deactivated_account_counts_as_ended() {
    let env = synced_env().await;
    mount_logout(&env, unauthenticated()).await;
    mount_refresh(
        &env,
        ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "off")),
    )
    .await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    signed_out_locally(&env);
    assert_eq!(requests(&env, LOGOUT).await.len(), 1, "sent again");
}

#[tokio::test]
async fn a_refresh_refused_with_another_403_is_not_confirmed() {
    for code in ["FORBIDDEN", "PASSWORD_CHANGE_REQUIRED", "COMPANY_FORBIDDEN"] {
        let env = synced_env().await;
        mount_logout(&env, unauthenticated()).await;
        mount_refresh(
            &env,
            ResponseTemplate::new(403).set_body_json(error_body(code, "no")),
        )
        .await;

        assert_eq!(
            env.engine.sign_out(false).await.unwrap(),
            done(false),
            "{code}"
        );
        signed_out_locally(&env);
    }
}

#[tokio::test]
async fn a_logout_refused_with_another_403_is_not_confirmed() {
    for code in ["PASSWORD_CHANGE_REQUIRED", "COMPANY_FORBIDDEN", "FORBIDDEN"] {
        let env = synced_env().await;
        mount_logout(
            &env,
            ResponseTemplate::new(403).set_body_json(error_body(code, "no")),
        )
        .await;

        assert_eq!(
            env.engine.sign_out(false).await.unwrap(),
            done(false),
            "{code}"
        );
        signed_out_locally(&env);
        assert!(requests(&env, REFRESH).await.is_empty(), "{code}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_lost_refresh_answer_is_not_confirmed() {
    let env = env_with(Duration::from_millis(700)).await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    mount_logout(&env, unauthenticated()).await;
    mount_refresh(&env, new_pair().set_delay(Duration::from_secs(2))).await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(false));
    assert_eq!(env.tokens.load(PROFILE).unwrap(), None);
}

#[tokio::test]
async fn a_sign_in_during_the_call_waits_and_keeps_its_tokens() {
    let env = synced_env().await;
    let worker = Arc::new(Mutex::new(None));
    let (slot, store) = (worker.clone(), env.tokens.clone());
    Mock::given(method("POST"))
        .and(path(LOGOUT))
        .respond_with(move |_: &Request| {
            let store = store.clone();
            *slot.lock().unwrap() = Some(std::thread::spawn(move || sign_in_blocking(store, 2)));
            // Give the sign-in time to land if nothing held it.
            std::thread::sleep(Duration::from_millis(200));
            ResponseTemplate::new(204)
        })
        .mount(&env.server)
        .await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), done(true));
    let generation = worker
        .lock()
        .unwrap()
        .take()
        .expect("logout reached")
        .join()
        .unwrap();
    assert_eq!(generation, 2);
    let record = env.tokens.load_record(PROFILE).unwrap();
    assert_eq!(record.generation, 2);
    assert_eq!(record.tokens, Some(tokens(2)), "B's sign-in was signed out");
    let calls = requests(&env, LOGOUT).await;
    assert_eq!(calls.len(), 1);
    assert_eq!(
        bearer_of(&calls[0]).as_deref(),
        Some("Bearer access-1-0123456789abcdef")
    );
}

#[tokio::test]
async fn no_token_appears_in_the_outcome() {
    let env = synced_env().await;
    mount_logout(
        &env,
        ResponseTemplate::new(500).set_body_string("access-1-0123456789abcdef"),
    )
    .await;

    let outcome = env.engine.sign_out(false).await.unwrap();
    let shown = format!("{outcome:?}");
    assert!(
        !shown.contains("access-") && !shown.contains("refresh-"),
        "{shown}"
    );
    assert_eq!(outcome, done(false));
}
