//! The kept `GET /auth/me` answer of a sign-in (`put_session_copy` /
//! `session_copy`): served only to the verified sign-in, user and company
//! that fetched it, refused for another sign-in, a signed-out or
//! deactivated one and a body carrying a credential, and removed by
//! sign-out, a new sign-in, another user, `UNAUTHENTICATED`, deactivation,
//! company loss and a company change. It lives in the encrypted store only.

mod engine_support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use engine_support::*;
use keystone_sync::auth::TokenStore;
use keystone_sync::client::{ApiConfig, ClientOptions, HttpClient};
use keystone_sync::engine::{SignOut, SyncEngine, Trigger};
use keystone_sync::store::raw::prelude::*;
use keystone_sync::wire::Timestamp;
use serde_json::{Map, Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const REFRESH: &str = "/api/v1/auth/device/refresh";
const OTHER_COMPANY: &str = "0192f5a0-0000-7000-8000-000000000002";
/// A name only the kept body holds: looked for in the database file.
const MARKER: &str = "Zeynep-Session-Marker-7f3a";

fn at() -> Timestamp {
    Timestamp("2026-11-02T21:40:00.000Z".into())
}

/// A `GET /auth/me` answer of `user`.
fn me(user: &str) -> Value {
    let mut permissions = Map::new();
    permissions.insert(COMPANY.into(), json!(["parties.view", "parties.create"]));
    json!({
        "data": {
            "user": {
                "id": user,
                "name": MARKER,
                "email": "zeynep@example.test",
                "locale": "tr",
                "is_super_admin": false,
                "must_change_password": false,
                "two_factor_enabled": false,
            },
            "companies": [{ "id": COMPANY, "name": "ACME", "role_names": ["admin"] }],
            "permissions": permissions,
        }
    })
}

/// Rows of `session_copy` in `engine_meta`, read straight from the store.
fn kept_rows(env: &Env) -> i64 {
    env.store
        .read(|c| {
            Ok(c.query_row(
                "SELECT count(*) FROM engine_meta WHERE key = 'session_copy'",
                [],
                |r| r.get(0),
            )?)
        })
        .unwrap()
}

fn served(env: &Env) -> Option<Value> {
    env.engine.session_copy().unwrap().map(|copy| copy.data)
}

/// The manifest answers `user`'s manifest for every call.
async fn mount_user(env: &Env, user: &'static str) {
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
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
}

/// Verified local data of user A, generation 1, and A's kept answer.
async fn verified_with_copy() -> Env {
    let env = env().await;
    mount_user(&env, USER_A).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine.put_session_copy(&me(USER_A), &at(), 1).unwrap();
    env
}

#[tokio::test]
async fn the_kept_answer_is_served_whole_to_the_verified_sign_in() {
    let env = verified_with_copy().await;
    let copy = env.engine.session_copy().unwrap().unwrap();
    assert_eq!(copy.data, me(USER_A));
    assert_eq!(copy.fetched_at, at());
    // A newer answer replaces it.
    let mut newer = me(USER_A);
    newer["data"]["companies"] = json!([]);
    let later = Timestamp("2026-11-02T22:00:00.000Z".into());
    env.engine.put_session_copy(&newer, &later, 1).unwrap();
    let copy = env.engine.session_copy().unwrap().unwrap();
    assert_eq!((copy.data, copy.fetched_at), (newer, later));
    assert_eq!(kept_rows(&env), 1);
    // Debug never prints the body.
    let text = format!("{:?}", env.engine.session_copy().unwrap());
    assert!(!text.contains(MARKER), "{text}");
}

#[tokio::test]
async fn an_answer_kept_before_the_first_run_is_served_once_verified() {
    let env = env().await;
    mount_user(&env, USER_A).await;
    env.engine.put_session_copy(&me(USER_A), &at(), 1).unwrap();
    // Not verified yet: closed like every local read.
    assert_eq!(
        env.engine.session_copy().unwrap_err().code(),
        "OFFLINE_UNAVAILABLE"
    );
    env.engine.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(served(&env), Some(me(USER_A)));
}

#[tokio::test]
async fn nothing_is_served_without_a_kept_answer() {
    let env = env().await;
    mount_user(&env, USER_A).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(served(&env), None);
}

#[tokio::test]
async fn an_answer_of_an_older_sign_in_is_refused_and_not_served() {
    let env = verified_with_copy().await;
    let second = sign_in_as(&env.tokens, 2).await;
    assert_eq!(second, 2);
    // Fetched in generation 1, arriving after sign-in 2.
    let error = env
        .engine
        .put_session_copy(&me(USER_A), &at(), 1)
        .unwrap_err();
    assert_eq!(error.code(), "UNAUTHENTICATED");
    // The same user verified again in generation 2: the copy of 1 is gone.
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(served(&env), None);
    assert_eq!(kept_rows(&env), 0);
    // The answer of generation 2 is served.
    env.engine.put_session_copy(&me(USER_A), &at(), 2).unwrap();
    assert_eq!(served(&env), Some(me(USER_A)));
}

#[tokio::test]
async fn another_user_never_sees_the_previous_users_answer() {
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
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine.put_session_copy(&me(USER_A), &at(), 1).unwrap();

    // User B signs in; B's own answer arrives before B's first run.
    let b = sign_in_as(&env.tokens, 3).await;
    env.engine.put_session_copy(&me(USER_B), &at(), b).unwrap();
    env.engine.run_once(Trigger::Manual).await.unwrap();
    // The wipe of A's data kept only B's answer of this sign-in.
    assert_eq!(served(&env), Some(me(USER_B)));
    assert_eq!(kept_rows(&env), 1);
}

/// Writes a kept answer straight into the store, as any code path could.
fn put_raw(env: &Env, generation: u64, user: &str, company: &str, format: u32) {
    let value = json!({
        "format": format, "generation": generation, "user_id": user,
        "company_id": company, "fetched_at": "2026-11-02T21:40:00.000Z", "body": me(user),
    })
    .to_string();
    env.store
        .write(|tx| {
            tx.execute(
                "INSERT OR REPLACE INTO engine_meta (key, value) VALUES ('session_copy', ?1)",
                [value],
            )?;
            Ok(())
        })
        .unwrap();
}

#[tokio::test]
async fn a_stored_answer_of_another_sign_in_company_or_format_is_never_served() {
    let env = env().await;
    mount_user(&env, USER_A).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_raw(&env, 1, USER_A, COMPANY, 1);
    assert_eq!(served(&env), Some(me(USER_A)), "positive control");
    for (generation, company, format) in [
        (2, COMPANY, 1),
        (0, COMPANY, 1),
        (1, OTHER_COMPANY, 1),
        (1, COMPANY, 2),
    ] {
        put_raw(&env, generation, USER_A, company, format);
        assert_eq!(served(&env), None, "{generation} {company} {format}");
    }
    // An unreadable value is no copy.
    env.store
        .write(|tx| {
            tx.execute(
                "UPDATE engine_meta SET value = 'x' WHERE key = 'session_copy'",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    assert_eq!(served(&env), None);
}

#[tokio::test]
async fn an_answer_of_another_user_than_the_local_data_is_not_served() {
    let env = env().await;
    mount_user(&env, USER_A).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    // A body of user B in A's sign-in (the server would never send it).
    env.engine.put_session_copy(&me(USER_B), &at(), 1).unwrap();
    assert_eq!(served(&env), None);
    // The next run drops it.
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(kept_rows(&env), 0);
}

#[tokio::test]
async fn another_user_signing_in_drops_the_previous_answer_from_disk() {
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
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine.put_session_copy(&me(USER_A), &at(), 1).unwrap();
    sign_in_as(&env.tokens, 3).await;
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(kept_rows(&env), 0);
    assert_eq!(served(&env), None);
}

#[tokio::test]
async fn sign_out_removes_the_answer_and_a_late_one_is_refused() {
    let env = verified_with_copy().await;
    assert_eq!(env.engine.sign_out(false).await.unwrap(), SignOut::Done);
    assert_eq!(kept_rows(&env), 0);
    // An answer fetched before the sign-out and arriving after it.
    let error = env
        .engine
        .put_session_copy(&me(USER_A), &at(), 1)
        .unwrap_err();
    assert_eq!(error.code(), "OFFLINE_UNAVAILABLE");
    assert_eq!(kept_rows(&env), 0);
}

#[tokio::test]
async fn an_unfinished_sign_out_refuses_the_answer() {
    let env = env().await;
    mount_user(&env, USER_A).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    leave_sign_out_unfinished(&env.store, 1, "revoke");
    let error = env
        .engine
        .put_session_copy(&me(USER_A), &at(), 1)
        .unwrap_err();
    assert_eq!(error.code(), "OFFLINE_UNAVAILABLE");
    assert_eq!(kept_rows(&env), 0);
}

/// Writers and readers keep going until well after the sign-out returned;
/// in no round does an answer outlive it or get served after it. (The
/// exact interleaving is pinned by the engine's unit test
/// `a_sign_out_cannot_land_between_the_session_answer_check_and_its_write`.)
#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn answers_racing_a_sign_out_never_survive_it() {
    use std::sync::atomic::AtomicBool;
    let mut survived = 0;
    for _ in 0..25 {
        let env = verified_with_copy().await;
        let engine = env.engine.clone();
        let done = Arc::new(AtomicBool::new(false));
        let signed_out = Arc::new(AtomicBool::new(false));
        let served_after = Arc::new(AtomicUsize::new(0));
        let mut workers: Vec<_> = (0..6)
            .map(|_| {
                let (engine, done) = (engine.clone(), done.clone());
                tokio::task::spawn_blocking(move || {
                    while !done.load(Ordering::SeqCst) {
                        let _ = engine.put_session_copy(&me(USER_A), &at(), 1);
                    }
                })
            })
            .collect();
        for _ in 0..2 {
            let (engine, done) = (engine.clone(), done.clone());
            let (signed_out, served_after) = (signed_out.clone(), served_after.clone());
            workers.push(tokio::task::spawn_blocking(move || {
                while !done.load(Ordering::SeqCst) {
                    let after = signed_out.load(Ordering::SeqCst);
                    if after && matches!(engine.session_copy(), Ok(Some(_))) {
                        served_after.fetch_add(1, Ordering::SeqCst);
                    }
                }
            }));
        }
        assert_eq!(engine.sign_out(true).await.unwrap(), SignOut::Done);
        signed_out.store(true, Ordering::SeqCst);
        // Writes already past their checks would land now, if not excluded.
        tokio::time::sleep(Duration::from_millis(15)).await;
        done.store(true, Ordering::SeqCst);
        for worker in workers {
            worker.await.unwrap();
        }
        if kept_rows(&env) != 0 || served_after.load(Ordering::SeqCst) != 0 {
            survived += 1;
        }
    }
    assert_eq!(
        survived, 0,
        "an answer outlived the sign-out in {survived}/25 rounds"
    );
}

#[tokio::test]
async fn an_older_answer_arriving_last_never_replaces_a_newer_one() {
    let env = verified_with_copy().await;
    let t = |s: &str| Timestamp(format!("2026-11-02T21:{s}Z"));
    let named = |name: &str| {
        let mut body = me(USER_A);
        body["data"]["user"]["name"] = json!(name);
        body
    };
    // The newer request (sent 21:45) answered first.
    assert!(
        env.engine
            .put_session_copy(&named("Yeni"), &t("45:00.000"), 1)
            .unwrap()
    );
    // The older one (sent 21:44) answered last: refused, the newer stays.
    assert!(
        !env.engine
            .put_session_copy(&named("Eski"), &t("44:00.000"), 1)
            .unwrap()
    );
    let copy = env.engine.session_copy().unwrap().unwrap();
    assert_eq!(copy.data["data"]["user"]["name"], "Yeni");
    assert_eq!(copy.fetched_at, t("45:00.000"));
    // Down to the millisecond; the same time replaces it.
    assert!(
        !env.engine
            .put_session_copy(&named("Eski"), &t("44:59.999"), 1)
            .unwrap()
    );
    assert!(
        env.engine
            .put_session_copy(&named("Ayni"), &t("45:00.000"), 1)
            .unwrap()
    );
    assert!(
        env.engine
            .put_session_copy(&named("Sonra"), &t("46:00.000"), 1)
            .unwrap()
    );
    assert_eq!(served(&env).unwrap()["data"]["user"]["name"], "Sonra");
}

#[tokio::test]
async fn a_new_sign_in_replaces_a_later_answer_of_the_old_one() {
    let env = verified_with_copy().await;
    env.engine
        .put_session_copy(
            &me(USER_A),
            &Timestamp("2026-11-02T23:00:00.000Z".into()),
            1,
        )
        .unwrap();
    let second = sign_in_as(&env.tokens, 2).await;
    // Sent earlier by the clock, but in the new sign-in: it wins.
    assert!(
        env.engine
            .put_session_copy(&me(USER_A), &at(), second)
            .unwrap()
    );
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(env.engine.session_copy().unwrap().unwrap().fetched_at, at());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_answers_keep_the_latest_sent() {
    let env = verified_with_copy().await;
    let times: Vec<String> = (0..40)
        .map(|i| {
            format!(
                "2026-11-02T22:{:02}:{:02}.000Z",
                10 + i % 7 * 3,
                (i * 13) % 60
            )
        })
        .collect();
    let latest = times.iter().max().unwrap().clone();
    let handles: Vec<_> = times
        .into_iter()
        .map(|time| {
            let engine = env.engine.clone();
            tokio::task::spawn_blocking(move || {
                let mut body = me(USER_A);
                body["data"]["user"]["name"] = json!(time.clone());
                engine.put_session_copy(&body, &Timestamp(time), 1).unwrap();
            })
        })
        .collect();
    for handle in handles {
        handle.await.unwrap();
    }
    let copy = env.engine.session_copy().unwrap().unwrap();
    assert_eq!(copy.fetched_at.0, latest);
    assert_eq!(copy.data["data"]["user"]["name"], latest.as_str());
}

#[tokio::test]
async fn an_unfinished_sign_out_closes_a_kept_answer() {
    let env = verified_with_copy().await;
    assert!(served(&env).is_some(), "positive control");
    for stage in ["revoke", "wipe"] {
        leave_sign_out_unfinished(&env.store, 1, stage);
        assert!(
            env.engine.session_copy().is_err(),
            "served during an unfinished sign-out ({stage})"
        );
    }
}

#[tokio::test]
async fn password_keys_other_than_the_change_flag_are_refused() {
    let env = env().await;
    mount_user(&env, USER_A).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    for key in ["password", "new_password", "current_password", "Password"] {
        let mut body = me(USER_A);
        body["data"]["user"][key] = json!("hunter2");
        let error = env.engine.put_session_copy(&body, &at(), 1).unwrap_err();
        assert_eq!(error.code(), "INVALID_REQUEST", "{key}");
    }
    assert_eq!(kept_rows(&env), 0);
}

#[tokio::test]
async fn unauthenticated_closes_and_removes_the_answer() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            move |_: &Request| match seen.fetch_add(1, Ordering::SeqCst) {
                0 => ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"])),
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
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine.put_session_copy(&me(USER_A), &at(), 1).unwrap();
    assert!(served(&env).is_some());

    let error = env.engine.run_once(Trigger::Timer).await.unwrap_err();
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert!(env.engine.session_copy().is_err());
    assert_eq!(kept_rows(&env), 0);
}

#[tokio::test]
async fn a_revoked_sign_in_without_tokens_is_not_served() {
    let env = verified_with_copy().await;
    // The server announced the revocation (realtime `session.revoked`): the
    // tokens go, the local data stays verified until the engine runs.
    let session = keystone_sync::auth::Session::shared(PROFILE, env.tokens.clone());
    assert!(session.forget_tokens(1).await.unwrap());
    assert!(env.engine.session_copy().is_err());
    assert_eq!(
        env.engine
            .put_session_copy(&me(USER_A), &at(), 1)
            .unwrap_err()
            .code(),
        "OFFLINE_UNAVAILABLE"
    );
}

#[tokio::test]
async fn deactivation_removes_the_answer() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            move |_: &Request| match seen.fetch_add(1, Ordering::SeqCst) {
                0 => ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"])),
                _ => ResponseTemplate::new(403)
                    .set_body_json(error_body("USER_DEACTIVATED", "inactive")),
            },
        )
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine.put_session_copy(&me(USER_A), &at(), 1).unwrap();

    let error = env.engine.run_once(Trigger::Timer).await.unwrap_err();
    assert_eq!(error.code(), "USER_DEACTIVATED");
    assert!(env.engine.session_copy().is_err());
    assert_eq!(kept_rows(&env), 0);
    assert!(env.engine.put_session_copy(&me(USER_A), &at(), 1).is_err());
}

#[tokio::test]
async fn losing_the_company_removes_the_answer() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let seen = calls.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            move |_: &Request| match seen.fetch_add(1, Ordering::SeqCst) {
                0 => ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"])),
                _ => ResponseTemplate::new(403)
                    .set_body_json(error_body("COMPANY_FORBIDDEN", "no access")),
            },
        )
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine.put_session_copy(&me(USER_A), &at(), 1).unwrap();

    env.engine.run_once(Trigger::Timer).await.unwrap_err();
    assert!(env.engine.session_copy().is_err());
    assert_eq!(kept_rows(&env), 0);
}

/// An engine over the same store whose client works in `company`.
fn engine_in(env: &Env, company: &str) -> SyncEngine<HttpClient> {
    let client = HttpClient::new(
        &ApiConfig {
            base_url: env.server.uri(),
            company_id: Uuid::parse_str(company).unwrap(),
            user_agent: "keystone-desktop-test".into(),
        },
        PROFILE,
        env.tokens.clone(),
        &ClientOptions {
            connect_timeout: Duration::from_secs(2),
            request_timeout: Duration::from_secs(10),
            allow_http_localhost: true,
        },
    )
    .unwrap();
    SyncEngine::new(client, env.store.clone())
}

#[tokio::test]
async fn a_company_change_invalidates_the_answer() {
    let env = verified_with_copy().await;
    // The profile restarts in another company over the same store, same
    // sign-in: nothing is served before the new company's answer.
    let other = engine_in(&env, OTHER_COMPANY);
    assert_eq!(other.session_copy().unwrap(), None);
    // Not even the new company's own answer, while the local data is still
    // the old company's (no run of the new one yet).
    other.put_session_copy(&me(USER_A), &at(), 1).unwrap();
    assert_eq!(other.session_copy().unwrap(), None);
    // The first run of the new company keeps that answer and serves it.
    let mut manifest = manifest(USER_A, vec![resource("parties", 0)], 200, 100);
    manifest["data"]["company_id"] = json!(OTHER_COMPANY);
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(ResponseTemplate::new(200).set_body_json(manifest))
        .with_priority(1)
        .mount(&env.server)
        .await;
    other.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(kept_rows(&env), 1);
    assert_eq!(
        other.session_copy().unwrap().map(|c| c.data),
        Some(me(USER_A))
    );
    // The old company's engine is never served it.
    assert!(env.engine.session_copy().unwrap_or(None).is_none());
}

#[tokio::test]
async fn an_answer_kept_just_before_a_company_switch_does_not_survive_it() {
    let env = env().await;
    // The old company's engine keeps an answer of generation 1 ...
    env.engine.put_session_copy(&me(USER_A), &at(), 1).unwrap();
    // ... and the first run happens in the new company.
    let other = engine_in(&env, OTHER_COMPANY);
    let mut manifest = manifest(USER_A, vec![resource("parties", 0)], 200, 100);
    manifest["data"]["company_id"] = json!(OTHER_COMPANY);
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(ResponseTemplate::new(200).set_body_json(manifest))
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    other.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(kept_rows(&env), 0);
    assert_eq!(other.session_copy().unwrap(), None);
}

#[tokio::test]
async fn an_answer_carrying_a_credential_or_another_shape_is_refused() {
    let env = env().await;
    mount_user(&env, USER_A).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    let mut with_key = me(USER_A);
    with_key["data"]["token"] = json!("abc");
    let mut nested_key = me(USER_A);
    nested_key["data"]["user"]["Access_Token"] = json!("abc");
    let mut password = me(USER_A);
    password["data"]["user"]["password_hash"] = json!("x");
    let mut secret = me(USER_A);
    secret["data"]["companies"][0]["client_secret"] = json!("x");
    let mut access_value = me(USER_A);
    access_value["data"]["user"]["name"] = json!(format!("x {}", "access-1-0123456789abcdef"));
    let mut refresh_value = me(USER_A);
    refresh_value["data"]["companies"][0]["name"] = json!("refresh-1-0123456789abcdef");
    for body in [
        with_key,
        nested_key,
        password,
        secret,
        access_value,
        refresh_value,
    ] {
        let error = env.engine.put_session_copy(&body, &at(), 1).unwrap_err();
        assert_eq!(error.code(), "INVALID_REQUEST", "{body}");
        assert!(!error.to_string().contains("abc"));
    }
    let mut no_user = me(USER_A);
    no_user["data"]["user"] = json!({});
    let mut bad_id = me(USER_A);
    bad_id["data"]["user"]["id"] = json!("42");
    let mut no_companies = me(USER_A);
    no_companies["data"]
        .as_object_mut()
        .unwrap()
        .remove("companies");
    let mut no_permissions = me(USER_A);
    no_permissions["data"]["permissions"] = json!([]);
    for body in [
        json!({}),
        json!({ "errors": { "code": "X" } }),
        no_user,
        bad_id,
        no_companies,
        no_permissions,
    ] {
        let error = env.engine.put_session_copy(&body, &at(), 1).unwrap_err();
        assert_eq!(error.code(), "INVALID_REQUEST", "{body}");
    }
    assert_eq!(kept_rows(&env), 0);
    // The flag `must_change_password` is not a credential.
    let mut must_change = me(USER_A);
    must_change["data"]["user"]["must_change_password"] = json!(true);
    env.engine.put_session_copy(&must_change, &at(), 1).unwrap();
    assert_eq!(served(&env), Some(must_change));
}

#[tokio::test]
async fn the_answer_is_only_in_the_encrypted_store() {
    let env = verified_with_copy().await;
    assert!(served(&env).is_some());
    let mut seen = 0;
    for entry in std::fs::read_dir(env.dir.path()).unwrap() {
        let path = entry.unwrap().path();
        let bytes = std::fs::read(&path).unwrap();
        seen += bytes.len();
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains(MARKER), "{} holds the body", path.display());
        assert!(!text.contains("zeynep@example.test"), "{}", path.display());
    }
    assert!(seen > 0, "the store wrote nothing");
    // Positive control: the same marker is readable through the store.
    let raw: String = env
        .store
        .read(|c| {
            Ok(c.query_row(
                "SELECT value FROM engine_meta WHERE key = 'session_copy'",
                [],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    assert!(raw.contains(MARKER));
    // No token of the sign-in is in it.
    let tokens = env.tokens.load(PROFILE).unwrap().unwrap();
    assert!(!raw.contains(tokens.access_token.expose()));
    assert!(!raw.contains(tokens.refresh_token.expose()));
}
