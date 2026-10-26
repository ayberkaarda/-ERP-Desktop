//! A sync run belongs to one sign-in generation: nothing of it is sent with
//! the tokens of a later sign-in, late answers are not committed, local
//! reads and writes close as soon as another sign-in happens, and wipes
//! never take the new session with them.

mod engine_support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine_support::*;
use keystone_sync::auth::{MemoryTokenStore, SessionRecord, StoredTokens, TokenStore};
use keystone_sync::engine::{SignOut, Trigger};
use keystone_sync::outbox::OutboxState;
use keystone_sync::store::{ListQuery, MirrorStore};
use keystone_sync::wire::MutationOp;
use serde_json::json;
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const PUSH: &str = "/api/v1/sync/push";
const P1: &str = "0193b1e8-0000-7d30-8333-0000000000a1";

/// Manifest answers by call number; `None` answers 500.
async fn mount_manifests(
    env: &Env,
    answer: impl Fn(usize) -> Option<&'static str> + Send + Sync + 'static,
) {
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            move |_: &Request| match answer(calls.fetch_add(1, Ordering::SeqCst)) {
                Some(user) => ResponseTemplate::new(200).set_body_json(manifest(
                    user,
                    vec![resource("parties", 0)],
                    200,
                    100,
                )),
                None => {
                    ResponseTemplate::new(500).set_body_json(error_body("SERVER_ERROR", "down"))
                }
            },
        )
        .mount(&env.server)
        .await;
}

/// One full run for user A, one mirror row and one create draft.
async fn seed(env: &Env) -> Uuid {
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(&env.store, "parties", P1, json!({"name": "A Ltd"}));
    let id = Uuid::now_v7();
    env.engine
        .enqueue(draft(
            MutationOp::Create,
            "parties",
            id,
            json!({"name": "Taslak A"}),
        ))
        .unwrap();
    id
}

#[tokio::test]
async fn a_run_never_sends_with_the_tokens_of_a_later_sign_in() {
    let env = env().await;
    let tokens = env.tokens.clone();
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            let user = match calls.fetch_add(1, Ordering::SeqCst) {
                0 => USER_A,
                1 => {
                    // User B signs in while A's manifest answer is on its way.
                    tokens.sign_in(PROFILE, &self::tokens(2)).unwrap();
                    USER_A
                }
                _ => USER_B,
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
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(apply_all)
        .mount(&env.server)
        .await;
    seed(&env).await;

    env.engine.run_once(Trigger::Manual).await.unwrap();
    let pushes: Vec<Option<String>> = env
        .server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.url.path() == PUSH)
        .map(bearer_of)
        .collect();
    assert!(
        pushes.is_empty(),
        "user A's draft must not be pushed with user B's token: {pushes:?}"
    );
    // The follow-up run under B's sign-in wiped A's data.
    assert!(outbox_list(&env.store).is_empty());
    assert_eq!(env.store.row_count(&name("parties")).unwrap(), 0);
}

#[tokio::test]
async fn a_late_push_answer_after_a_new_sign_in_is_not_committed() {
    let env = env().await;
    mount_manifests(&env, |n| (n < 2).then_some(USER_A)).await;
    mount_empty_pull(&env.server).await;
    let tokens = env.tokens.clone();
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(move |request: &Request| {
            tokens.sign_in(PROFILE, &self::tokens(2)).unwrap();
            apply_all(request)
        })
        .mount(&env.server)
        .await;
    let id = seed(&env).await;

    let _ = env.engine.run_once(Trigger::Manual).await;
    assert!(
        env.store.get_row(&name("parties"), id).unwrap().is_none(),
        "the answer to A's push arrived after B signed in"
    );
    let entries = outbox_list(&env.store);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].state, OutboxState::Pending);
}

#[tokio::test]
async fn local_reads_and_writes_close_until_the_new_sign_in_is_verified() {
    let env = env().await;
    // Seed, then offline (500) after the new sign-in, then A again.
    mount_manifests(&env, |n| match n {
        0 => Some(USER_A),
        1 => None,
        _ => Some(USER_A),
    })
    .await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(apply_all)
        .mount(&env.server)
        .await;
    let draft_id = seed(&env).await;
    let parties = name("parties");
    assert_eq!(
        env.engine
            .list(&parties, &ListQuery::default())
            .unwrap()
            .total,
        2
    );

    env.tokens.sign_in(PROFILE, &tokens(2)).unwrap();
    assert!(env.engine.list(&parties, &ListQuery::default()).is_err());
    assert!(env.engine.get(&parties, draft_id).is_err());
    assert!(
        env.engine
            .enqueue(draft(
                MutationOp::Create,
                "parties",
                Uuid::now_v7(),
                json!({})
            ))
            .is_err()
    );
    // Still unverified after a failed run.
    env.engine.run_once(Trigger::Manual).await.unwrap_err();
    assert!(env.engine.list(&parties, &ListQuery::default()).is_err());

    // The manifest names the same user again: reads open, the draft goes out.
    env.engine.run_once(Trigger::Manual).await.unwrap();
    let page = env.engine.list(&parties, &ListQuery::default()).unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(hits(&env.server, PUSH).await, 1);
}

/// Memory store that signs user B in right after it hands out a record
/// carrying the deactivation mark (once): a sign-in between the engine's
/// check and its wipe.
#[derive(Debug, Default)]
struct SignInAfterDeactivated {
    inner: MemoryTokenStore,
    next: Mutex<Option<StoredTokens>>,
}

impl TokenStore for SignInAfterDeactivated {
    fn identity(&self) -> String {
        self.inner.identity()
    }
    fn load_record(&self, profile: &str) -> keystone_sync::error::Result<SessionRecord> {
        let record = self.inner.load_record(profile)?;
        if record.deactivated {
            let next = self.next.lock().unwrap().take();
            if let Some(tokens) = next {
                self.inner.sign_in(profile, &tokens)?;
            }
        }
        Ok(record)
    }
    fn load(&self, profile: &str) -> keystone_sync::error::Result<Option<StoredTokens>> {
        self.inner.load(profile)
    }
    fn save(&self, profile: &str, tokens: &StoredTokens) -> keystone_sync::error::Result<()> {
        self.inner.save(profile, tokens)
    }
    fn clear(&self, profile: &str) -> keystone_sync::error::Result<()> {
        self.inner.clear(profile)
    }
    fn take(&self, profile: &str) -> keystone_sync::error::Result<Option<StoredTokens>> {
        self.inner.take(profile)
    }
    fn sign_in(&self, profile: &str, tokens: &StoredTokens) -> keystone_sync::error::Result<u64> {
        self.inner.sign_in(profile, tokens)
    }
    fn deactivate(&self, profile: &str, expected: u64) -> keystone_sync::error::Result<bool> {
        self.inner.deactivate(profile, expected)
    }
}

#[tokio::test]
async fn a_deactivation_wipe_keeps_a_sign_in_that_happened_after_the_check() {
    let store = Arc::new(SignInAfterDeactivated::default());
    let env = env_on(store.clone(), Duration::from_secs(10)).await;
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            move |_: &Request| match calls.fetch_add(1, Ordering::SeqCst) {
                0 => ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"])),
                1 => ResponseTemplate::new(403)
                    .set_body_json(error_body("USER_DEACTIVATED", "inactive")),
                _ => ResponseTemplate::new(200).set_body_json(manifest(
                    USER_B,
                    vec![resource("parties", 0)],
                    200,
                    100,
                )),
            },
        )
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(&env.store, "parties", P1, json!({"name": "A Ltd"}));
    *store.next.lock().unwrap() = Some(tokens(2));

    let _ = env.engine.run_once(Trigger::Timer).await;
    let record = store.inner.load_record(PROFILE).unwrap();
    assert!(!record.deactivated);
    assert_eq!(
        record.tokens,
        Some(tokens(2)),
        "B's sign-in survives the wipe"
    );
    assert_eq!(
        env.store.row_count(&name("parties")).unwrap(),
        0,
        "A's data is gone"
    );
}

#[tokio::test]
async fn a_draft_queued_after_sign_out_never_reaches_the_next_user() {
    let env = env().await;
    mount_manifests(&env, |n| Some(if n == 0 { USER_A } else { USER_B })).await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(apply_all)
        .mount(&env.server)
        .await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(env.engine.sign_out(false).await.unwrap(), SignOut::Done);

    // A's window still open: a late write after the wipe.
    let late = env.engine.enqueue(draft(
        MutationOp::Create,
        "parties",
        Uuid::now_v7(),
        json!({"name": "A"}),
    ));
    assert!(
        late.is_err(),
        "nothing may be queued without a verified sign-in"
    );

    env.tokens.sign_in(PROFILE, &tokens(2)).unwrap();
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(hits(&env.server, PUSH).await, 0);
    assert!(outbox_list(&env.store).is_empty());
}

#[tokio::test]
async fn sign_out_waits_for_a_refresh_instead_of_racing_it() {
    let env = env().await;
    mount_manifests(&env, |_| Some(USER_A)).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();

    // Another client of the same profile refreshes; the server answers only
    // when the test lets it.
    let (entered_tx, entered_rx) = std::sync::mpsc::channel::<()>();
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let entered_tx = Mutex::new(entered_tx);
    let release_rx = Mutex::new(release_rx);
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/device/refresh"))
        .respond_with(move |_: &Request| {
            let _ = entered_tx.lock().unwrap().send(());
            let _ = release_rx
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(10));
            ResponseTemplate::new(200).set_body_json(json!({"data": {
                "token": "access-5-0123456789abcdef",
                "expires_at": "2026-10-26T10:15:00+03:00",
                "refresh_token": "refresh-5-0123456789abcdef",
                "refresh_expires_at": "2026-11-25T09:15:00+03:00",
            }}))
        })
        .mount(&env.server)
        .await;
    let other = other_client(&env);
    // The access token is rejected once, so this call refreshes.
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(wiremock::matchers::header(
            "authorization",
            "Bearer access-1-0123456789abcdef",
        ))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "expired")),
        )
        .with_priority(1)
        .mount(&env.server)
        .await;
    let refreshing = tokio::spawn(async move {
        use keystone_sync::client::SyncApi;
        let _ = other.manifest().await;
    });
    tokio::task::spawn_blocking(move || entered_rx.recv_timeout(Duration::from_secs(10)))
        .await
        .unwrap()
        .expect("refresh in flight");

    let engine = env.engine.clone();
    let mut signing_out = tokio::spawn(async move { engine.sign_out(true).await });
    let finished_early = tokio::time::timeout(Duration::from_millis(300), &mut signing_out)
        .await
        .is_ok();
    release_tx.send(()).unwrap();
    refreshing.await.unwrap();
    if !finished_early {
        signing_out.await.unwrap().unwrap();
    }
    assert!(
        env.tokens.load(PROFILE).unwrap().is_none(),
        "the refresh wrote tokens back after sign-out (sign-out finished early: {finished_early})"
    );
}

/// A second client of the same store and profile (it shares the session).
fn other_client(env: &Env) -> keystone_sync::client::HttpClient<MemoryTokenStore> {
    keystone_sync::client::HttpClient::new(
        &keystone_sync::client::ApiConfig {
            base_url: env.server.uri(),
            company_id: Uuid::parse_str(COMPANY).unwrap(),
            user_agent: "keystone-desktop-test".into(),
        },
        PROFILE,
        env.tokens.clone(),
        &keystone_sync::client::ClientOptions {
            connect_timeout: Duration::from_secs(2),
            request_timeout: Duration::from_secs(20),
            allow_http_localhost: true,
        },
    )
    .unwrap()
}
