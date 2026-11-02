//! `GET /auth/me` through `api_request`: a `200` answer is kept, and offline
//! (or with the server gone before the engine noticed) the same body comes
//! from this device while the local data is verified for that sign-in;
//! without a copy, for another sign-in, after sign-out and for every other
//! `/auth` or account path it stays refused.

use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

use crate::dto::api::{ApiResponseDto, ResponseSource};
use crate::router::local_support::*;

const ME: &str = "/api/v1/auth/me";
const USER: &str = "0192f5a0-0000-7000-8000-00000000000a";
const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";

fn me(name: &str) -> Value {
    json!({
        "data": {
            "user": {
                "id": USER, "name": name, "email": "ayse@example.test", "locale": "tr",
                "is_super_admin": false, "must_change_password": false,
                "two_factor_enabled": false,
            },
            "companies": [{ "id": COMPANY, "name": "ACME", "role_names": ["admin"] }],
            "permissions": { COMPANY: ["parties.view"] },
        }
    })
}

async fn mount_me(fx: &Fixture, body: Value, delay_ms: u64) {
    Mock::given(method("GET"))
        .and(path(ME))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(body)
                .set_delay(Duration::from_millis(delay_ms)),
        )
        .mount(&fx.server)
        .await;
}

fn me_call() -> Value {
    get(ME, json!([]))
}

async fn offline_me(fx: &Fixture) -> ApiResponseDto {
    fx.go_offline();
    fx.call(me_call()).await
}

fn refused(answer: &ApiResponseDto) {
    assert_eq!(answer.status, 503, "{answer:?}");
    assert_eq!(code(answer), "OFFLINE_UNAVAILABLE");
    assert_eq!(answer.source, ResponseSource::Local);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_online_answer_comes_back_offline_with_the_same_body() {
    let fx = fixture(vec![]).await;
    mount_me(&fx, me("Ayşe"), 0).await;
    let online = fx.call(me_call()).await;
    assert_eq!(
        (online.status, online.source),
        (200, ResponseSource::Network)
    );
    assert_eq!(online.json(), Some(&me("Ayşe")));

    let offline = offline_me(&fx).await;

    assert_eq!(offline.status, 200);
    assert_eq!(offline.source, ResponseSource::Local);
    let body = offline.json().unwrap();
    // What `loadSession` reads is the server's `data`, unchanged.
    assert_eq!(body["data"], me("Ayşe")["data"]);
    let meta = &body["meta"]["offline"];
    assert_eq!(meta["stale"], true);
    assert_eq!(meta["partial"], false);
    assert!(meta["as_of"].as_str().is_some_and(|at| at.ends_with('Z')));
    assert_eq!(offline.header("content-type"), Some("application/json"));
    // Answered here: the server saw only the online call.
    assert_eq!(fx.received(ME).await, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn without_a_kept_answer_offline_stays_refused() {
    let fx = fixture(vec![]).await;
    let answer = offline_me(&fx).await;
    refused(&answer);
    let details = &answer.json().unwrap()["errors"]["details"];
    assert_eq!(details, &json!({ "method": "GET", "path": "/auth/me" }));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_gone_before_the_engine_noticed_answers_from_the_copy() {
    let fx = fixture(vec![]).await;
    mount_me(&fx, me("Ayşe"), 0).await;
    fx.call(me_call()).await;
    // A reload right after the server went away: still "online".
    fx.lose_server();

    let answer = fx.call(me_call()).await;

    assert_eq!((answer.status, answer.source), (200, ResponseSource::Local));
    assert_eq!(answer.json().unwrap()["data"], me("Ayşe")["data"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_gone_without_a_copy_is_a_network_error() {
    let fx = fixture(vec![]).await;
    fx.lose_server();
    let error = fx
        .try_call(crate::router::local_resolver(), me_call())
        .await
        .unwrap_err();
    assert_eq!(error.code, "NETWORK_ERROR");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_later_online_answer_refreshes_the_copy() {
    let fx = fixture(vec![]).await;
    mount_me(&fx, me("Eski Ad"), 0).await;
    fx.call(me_call()).await;
    Mock::given(method("GET"))
        .and(path(ME))
        .respond_with(ResponseTemplate::new(200).set_body_json(me("Yeni Ad")))
        .with_priority(1)
        .mount(&fx.server)
        .await;
    fx.go_online();
    fx.call(me_call()).await;

    let answer = offline_me(&fx).await;

    assert_eq!(answer.json().unwrap()["data"], me("Yeni Ad")["data"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_or_odd_answer_is_not_kept() {
    let fx = fixture(vec![]).await;
    Mock::given(method("GET"))
        .and(path(ME))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({
            "errors": { "message": "x", "code": "SERVER_ERROR" }
        })))
        .up_to_n_times(1)
        .mount(&fx.server)
        .await;
    let mut tokened = me("Ayşe");
    tokened["data"]["token"] = json!("plain-token");
    Mock::given(method("GET"))
        .and(path(ME))
        .respond_with(ResponseTemplate::new(200).set_body_json(tokened))
        .mount(&fx.server)
        .await;
    assert_eq!(fx.call(me_call()).await.status, 500);
    // Passed to the web unchanged, never kept.
    assert_eq!(fx.call(me_call()).await.status, 200);

    refused(&offline_me(&fx).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_query_or_another_auth_path_is_neither_kept_nor_served() {
    let fx = fixture(vec![]).await;
    mount_me(&fx, me("Ayşe"), 0).await;
    // With a query the answer is not the session read.
    fx.call(get(ME, json!([["include", "x"]]))).await;
    refused(&offline_me(&fx).await);

    fx.go_online();
    fx.call(me_call()).await;
    fx.go_offline();
    refused(&fx.call(get(ME, json!([["include", "x"]]))).await);
    for account in ["/api/v1/me/devices", "/api/v1/me/sessions"] {
        refused(&fx.call(get(account, json!([]))).await);
    }
    // Other `/auth` paths are reserved, offline too.
    for reserved in [
        send("POST", ME, None, Some(json!({}))),
        get("/api/v1/auth/me/devices", json!([])),
        send("POST", "/api/v1/auth/password", None, Some(json!({}))),
    ] {
        let error = fx
            .try_call(crate::router::local_resolver(), reserved)
            .await
            .unwrap_err();
        assert_eq!(error.code, "INVALID_REQUEST");
    }
    // The session read itself is still answered.
    assert_eq!(fx.call(me_call()).await.status, 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_sign_in_is_not_served_the_previous_answer() {
    let fx = fixture(vec![]).await;
    mount_me(&fx, me("Ayşe"), 0).await;
    fx.call(me_call()).await;
    fx.sign_in_again().await;

    refused(&offline_me(&fx).await);
    // Verified for the new sign-in: the answer of the old one is gone.
    fx.engine
        .run_once(keystone_sync::engine::Trigger::Manual)
        .await
        .unwrap();
    refused(&fx.call(me_call()).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn sign_out_leaves_no_copy() {
    let fx = fixture(vec![]).await;
    mount_me(&fx, me("Ayşe"), 0).await;
    fx.call(me_call()).await;

    fx.engine.sign_out(true).await.unwrap();

    refused(&offline_me(&fx).await);
    // The same user signs in again, verified, still offline: nothing kept.
    fx.sign_in_again().await;
    fx.go_online();
    fx.engine
        .run_once(keystone_sync::engine::Trigger::Manual)
        .await
        .unwrap();
    refused(&offline_me(&fx).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_answer_of_an_earlier_sign_in_is_not_kept() {
    let fx = Arc::new(fixture(vec![]).await);
    mount_me(&fx, me("Ayşe"), 600).await;
    let call = {
        let fx = fx.clone();
        tokio::spawn(async move { fx.call(me_call()).await })
    };
    fx.request_arrived(ME).await;
    fx.sign_in_again().await;
    fx.engine
        .run_once(keystone_sync::engine::Trigger::Manual)
        .await
        .unwrap();

    assert_eq!(call.await.unwrap().status, 200);

    refused(&offline_me(&fx).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_answer_of_a_replaced_engine_or_left_profile_is_not_kept() {
    for leave in [Fixture::replace_engine, Fixture::switch_profile] {
        let fx = Arc::new(fixture(vec![]).await);
        mount_me(&fx, me("Ayşe"), 400).await;
        let call = {
            let fx = fx.clone();
            tokio::spawn(async move { fx.call(me_call()).await })
        };
        fx.request_arrived(ME).await;
        leave(&fx);
        assert_eq!(call.await.unwrap().status, 200);
        assert!(fx.engine.session_copy().unwrap().is_none());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sign_out_during_the_call_leaves_no_copy() {
    let fx = Arc::new(fixture(vec![]).await);
    mount_me(&fx, me("Ayşe"), 400).await;
    let call = {
        let fx = fx.clone();
        tokio::spawn(async move { fx.call(me_call()).await })
    };
    fx.request_arrived(ME).await;
    fx.engine.sign_out(true).await.unwrap();
    // The answer still reaches the web; it is not kept.
    assert_eq!(call.await.unwrap().status, 200);
    fx.sign_in_again().await;
    fx.engine
        .run_once(keystone_sync::engine::Trigger::Manual)
        .await
        .unwrap();
    refused(&offline_me(&fx).await);
}

/// The kept answer is fetched once; later calls get `status` and `body`.
async fn kept_then(fx: &Fixture, status: u16, body: Value) {
    Mock::given(method("GET"))
        .and(path(ME))
        .respond_with(ResponseTemplate::new(200).set_body_json(me("Ayşe")))
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&fx.server)
        .await;
    Mock::given(method("GET"))
        .and(path(ME))
        .respond_with(ResponseTemplate::new(status).set_body_json(body))
        .with_priority(2)
        .mount(&fx.server)
        .await;
    let first = fx.call(me_call()).await;
    assert_eq!((first.status, first.source), (200, ResponseSource::Network));
    assert!(
        fx.engine.session_copy().unwrap().is_some(),
        "positive control"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_or_client_error_is_passed_on_not_replaced_by_the_copy() {
    for (status, code) in [
        (503, "SERVER_ERROR"),
        (500, "SERVER_ERROR"),
        (429, "RATE_LIMITED"),
    ] {
        let fx = fixture(vec![]).await;
        kept_then(
            &fx,
            status,
            json!({ "errors": { "code": code, "message": "x" } }),
        )
        .await;
        let answer = fx.call(me_call()).await;
        assert_eq!(
            (answer.status, answer.source),
            (status, ResponseSource::Network)
        );
        // Still kept for a later offline start.
        assert!(fx.engine.session_copy().unwrap().is_some());
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn another_path_never_gets_the_session_copy() {
    let fx = fixture(vec![]).await;
    kept_then(&fx, 200, me("Ayşe")).await;
    fx.lose_server();
    for other in ["/api/v1/me/devices", "/api/v1/me/sessions", "/api/v1/meta"] {
        // First the failed connection, then the offline refusal.
        for _ in 0..2 {
            match fx
                .try_call(crate::router::local_resolver(), get(other, json!([])))
                .await
            {
                Err(error) => assert_eq!(error.code, "NETWORK_ERROR", "{other}"),
                Ok(answer) => refused(&answer),
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_offline_meta_of_the_copy_is_exactly_as_of_partial_and_stale() {
    let fx = fixture(vec![]).await;
    kept_then(&fx, 200, me("Ayşe")).await;
    let answer = offline_me(&fx).await;
    let body = answer.json().unwrap();
    let meta = body["meta"].as_object().unwrap();
    assert_eq!(meta.keys().collect::<Vec<_>>(), ["offline"]);
    let offline = meta["offline"].as_object().unwrap();
    let mut keys: Vec<_> = offline.keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["as_of", "partial", "stale"]);
    assert_eq!(
        (offline["partial"].clone(), offline["stale"].clone()),
        (json!(false), json!(true))
    );
    assert_eq!(body["data"], me("Ayşe")["data"]);
    let mut top: Vec<_> = body.as_object().unwrap().keys().cloned().collect();
    top.sort();
    assert_eq!(top, ["data", "meta"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_copy_is_as_of_the_request_not_its_answer() {
    let fx = Arc::new(fixture(vec![]).await);
    mount_me(&fx, me("Ayşe"), 500).await;
    let before = crate::router::local_read::now().unwrap().0;
    let call = {
        let fx = fx.clone();
        tokio::spawn(async move { fx.call(me_call()).await })
    };
    fx.request_arrived(ME).await;
    // Well before the answer comes (it is held back 500 ms).
    let in_flight = crate::router::local_read::now().unwrap().0;
    assert_eq!(call.await.unwrap().status, 200);

    let answer = offline_me(&fx).await;

    let as_of = answer.json().unwrap()["meta"]["offline"]["as_of"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(before <= as_of, "{before} > {as_of}");
    assert!(
        as_of <= in_flight,
        "as_of {as_of} is later than the request in flight at {in_flight}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn an_older_request_answered_last_does_not_replace_the_newer_answer() {
    let fx = Arc::new(fixture(vec![]).await);
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(ME))
        .respond_with(move |_: &wiremock::Request| {
            if seen.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                ResponseTemplate::new(200)
                    .set_body_json(me("Eski Ad"))
                    .set_delay(Duration::from_millis(700))
            } else {
                ResponseTemplate::new(200).set_body_json(me("Yeni Ad"))
            }
        })
        .mount(&fx.server)
        .await;
    let old = {
        let fx = fx.clone();
        tokio::spawn(async move { fx.call(me_call()).await })
    };
    fx.request_arrived(ME).await;
    // Sent a moment later: a clearly later request time.
    tokio::time::sleep(Duration::from_millis(5)).await;
    let new = fx.call(me_call()).await;
    assert_eq!(new.json().unwrap()["data"]["user"]["name"], "Yeni Ad");
    let old = old.await.unwrap();
    assert_eq!(old.json().unwrap()["data"]["user"]["name"], "Eski Ad");

    let answer = offline_me(&fx).await;

    assert_eq!(answer.json().unwrap()["data"]["user"]["name"], "Yeni Ad");
}

const LOGOUT: &str = "/api/v1/auth/logout";

/// The server's logout answers after `delay_ms`.
async fn mount_logout(fx: &Fixture, delay_ms: u64) {
    Mock::given(method("POST"))
        .and(path(LOGOUT))
        .respond_with(ResponseTemplate::new(204).set_delay(Duration::from_millis(delay_ms)))
        .mount(&fx.server)
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn after_a_sign_out_the_session_read_is_refused_and_nothing_is_kept() {
    let fx = fixture(vec![]).await;
    mount_me(&fx, me("Ayşe"), 0).await;
    mount_logout(&fx, 0).await;
    fx.call(me_call()).await;
    assert!(
        fx.engine.session_copy().unwrap().is_some(),
        "positive control"
    );

    let done = fx.engine.sign_out(false).await.unwrap();

    assert_eq!(
        done,
        keystone_sync::engine::SignOut::Done {
            server_revoked: true
        }
    );
    assert!(fx.engine.session_copy().is_err());
    refused(&offline_me(&fx).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_copy_is_closed_while_the_server_is_asked_to_end_the_sign_in() {
    let fx = Arc::new(fixture(vec![]).await);
    mount_me(&fx, me("Ayşe"), 0).await;
    mount_logout(&fx, 1500).await;
    fx.call(me_call()).await;
    assert!(
        fx.engine.session_copy().unwrap().is_some(),
        "positive control"
    );
    let sign_out = {
        let fx = fx.clone();
        tokio::spawn(async move { fx.engine.sign_out(false).await })
    };
    // The sign-out is in its revoke stage: tokens still here, server asked.
    fx.request_arrived(LOGOUT).await;

    assert!(fx.engine.session_copy().is_err());
    refused(&offline_me(&fx).await);
    let at = keystone_sync::wire::Timestamp("2026-11-03T10:00:00.000Z".into());
    let kept = fx.engine.put_session_copy(&me("Ayşe"), &at, 1);
    assert_eq!(kept.unwrap_err().code(), "OFFLINE_UNAVAILABLE");
    // The server cannot be reached for it either: still refused.
    fx.lose_server();
    assert_ne!(
        fx.try_call(crate::router::local_resolver(), me_call())
            .await
            .map(|a| a.status)
            .ok(),
        Some(200)
    );

    let done = sign_out.await.unwrap().unwrap();
    assert_eq!(
        done,
        keystone_sync::engine::SignOut::Done {
            server_revoked: true
        }
    );
    assert!(fx.engine.session_copy().is_err());
    refused(&offline_me(&fx).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn session_reads_racing_a_sign_out_leave_no_copy() {
    for logout_ms in [0, 100, 300] {
        let fx = Arc::new(fixture(vec![]).await);
        mount_me(&fx, me("Ayşe"), 20).await;
        mount_logout(&fx, logout_ms).await;
        fx.call(me_call()).await;
        let reads: Vec<_> = (0..8)
            .map(|i| {
                let fx = fx.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(i * 15)).await;
                    for _ in 0..4 {
                        let _ = fx
                            .try_call(crate::router::local_resolver(), me_call())
                            .await;
                    }
                })
            })
            .collect();
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(matches!(
            fx.engine.sign_out(true).await.unwrap(),
            keystone_sync::engine::SignOut::Done { .. }
        ));
        for read in reads {
            read.await.unwrap();
        }
        assert!(fx.engine.session_copy().is_err(), "logout {logout_ms} ms");
        refused(&offline_me(&fx).await);
        // A new sign-in of the same user, verified: nothing of the old one.
        fx.sign_in_again().await;
        fx.go_online();
        fx.engine
            .run_once(keystone_sync::engine::Trigger::Manual)
            .await
            .unwrap();
        assert!(
            fx.engine.session_copy().unwrap().is_none(),
            "logout {logout_ms} ms"
        );
    }
}
