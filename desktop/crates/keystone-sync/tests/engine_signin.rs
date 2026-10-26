//! One way in: a sign-in goes through `Session::sign_in`, in order with
//! token work of the profile (a refresh in flight finishes first), and
//! sign-out revokes the tokens before it removes local data, also when it
//! is finished later for the generation it began in.

mod engine_support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine_support::*;
use keystone_sync::auth::{
    MemoryTokenStore, Session, SessionRecord, StoredTokens, TokenStore, TokenWrite,
};
use keystone_sync::engine::{SignOut, SyncState, Trigger};
use keystone_sync::store::ListQuery;
use keystone_sync::wire::MutationOp;
use serde_json::json;
use uuid::Uuid;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const REFRESH: &str = "/api/v1/auth/device/refresh";

fn other_client(env: &Env) -> keystone_sync::client::HttpClient {
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

#[tokio::test]
async fn a_sign_in_waits_for_a_refresh_in_flight() {
    let env = env().await;
    let (entered_tx, entered_rx) = std::sync::mpsc::channel::<()>();
    let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
    let (entered_tx, release_rx) = (Mutex::new(entered_tx), Mutex::new(release_rx));
    Mock::given(method("POST"))
        .and(path(REFRESH))
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
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(header("authorization", "Bearer access-1-0123456789abcdef"))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "expired")),
        )
        .mount(&env.server)
        .await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    let other = other_client(&env);
    let refreshing = tokio::spawn(async move {
        use keystone_sync::client::SyncApi;
        let _ = other.manifest().await;
    });
    tokio::task::spawn_blocking(move || entered_rx.recv_timeout(Duration::from_secs(10)))
        .await
        .unwrap()
        .expect("refresh in flight");

    // User B signs in while A's refresh waits for its answer.
    let store = env.tokens.clone();
    let mut signing_in = tokio::spawn(async move {
        let session = Session::shared(PROFILE, store);
        session.sign_in(&tokens(7)).await.unwrap()
    });
    let finished_early = tokio::time::timeout(Duration::from_millis(300), &mut signing_in)
        .await
        .is_ok();
    release_tx.send(()).unwrap();
    refreshing.await.unwrap();
    if !finished_early {
        signing_in.await.unwrap();
    }
    let record = env.tokens.load_record(PROFILE).unwrap();
    assert_eq!(
        record.tokens,
        Some(tokens(7)),
        "A's refresh wrote its tokens into B's sign-in (sign-in finished early: {finished_early})"
    );
    assert_eq!(record.generation, 2);
}

/// Token store whose generation-bound sign-out fails (like a locked
/// keychain): it does not implement `sign_out`.
#[derive(Debug, Default)]
struct NoSignOut(MemoryTokenStore);

impl TokenStore for NoSignOut {
    fn identity(&self) -> String {
        self.0.identity()
    }
    fn load_record(&self, profile: &str) -> keystone_sync::error::Result<SessionRecord> {
        self.0.load_record(profile)
    }
    fn load(&self, profile: &str) -> keystone_sync::error::Result<Option<StoredTokens>> {
        self.0.load(profile)
    }
    fn save(
        &self,
        w: &TokenWrite,
        profile: &str,
        tokens: &StoredTokens,
    ) -> keystone_sync::error::Result<()> {
        self.0.save(w, profile, tokens)
    }
    fn clear(&self, w: &TokenWrite, profile: &str) -> keystone_sync::error::Result<()> {
        self.0.clear(w, profile)
    }
    fn take(
        &self,
        w: &TokenWrite,
        profile: &str,
    ) -> keystone_sync::error::Result<Option<StoredTokens>> {
        self.0.take(w, profile)
    }
    fn sign_in(
        &self,
        w: &TokenWrite,
        profile: &str,
        tokens: &StoredTokens,
    ) -> keystone_sync::error::Result<u64> {
        self.0.sign_in(w, profile, tokens)
    }
    fn deactivate(
        &self,
        w: &TokenWrite,
        profile: &str,
        expected: u64,
    ) -> keystone_sync::error::Result<bool> {
        self.0.deactivate(w, profile, expected)
    }
}

#[tokio::test]
async fn sign_out_keeps_local_data_when_the_tokens_cannot_be_revoked() {
    let store = Arc::new(NoSignOut::default());
    let env = env_on(store.clone(), Duration::from_secs(10)).await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        "0193b1e8-0000-7d30-8333-0000000000d1",
        json!({"name": "A"}),
    );
    env.engine
        .enqueue(draft(
            MutationOp::Create,
            "parties",
            Uuid::now_v7(),
            json!({"name": "T"}),
        ))
        .unwrap();

    assert!(env.engine.sign_out(true).await.is_err());
    assert_eq!(
        env.store.row_count(&name("parties")).unwrap(),
        1,
        "local data deleted although the sign-out failed"
    );
    assert_eq!(outbox_list(&env.store).len(), 1);
    assert!(store.0.load(PROFILE).unwrap().is_some());
}

/// A session is bound to the store it was made from: a sign-in through it
/// lands there and nowhere else (the cross-store call does not compile, see
/// the `compile_fail` blocks of `auth::Session`).
#[tokio::test]
async fn a_session_signs_in_to_the_store_it_was_made_from() {
    let own = Arc::new(MemoryTokenStore::default());
    let other = Arc::new(MemoryTokenStore::default());
    let generation = Session::shared("bound", own.clone())
        .sign_in(&tokens(3))
        .await
        .unwrap();
    assert_eq!(generation, 1);
    assert_eq!(own.load("bound").unwrap(), Some(tokens(3)));
    assert_eq!(
        other.load_record("bound").unwrap(),
        SessionRecord::default()
    );
}

/// A's sign-out revoked A's tokens and the process died before the local
/// data went. B signed in since. Finishing A's sign-out removes A's local
/// data and leaves B's tokens alone.
#[tokio::test]
async fn a_sign_out_finished_after_a_new_sign_in_keeps_the_new_tokens() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        "0193b1e8-0000-7d30-8333-0000000000d1",
        json!({"name": "A"}),
    );
    leave_sign_out_unfinished(&env.store, 1, "wipe");
    sign_in_as(&env.tokens, 2).await;

    assert_eq!(env.engine.sign_out(false).await.unwrap(), SignOut::Done);
    assert_eq!(
        env.tokens.load(PROFILE).unwrap(),
        Some(tokens(2)),
        "finishing A's sign-out revoked B's tokens"
    );
    assert_eq!(env.store.row_count(&name("parties")).unwrap(), 0);
}

/// Same, finished by a run instead of a sign-out.
#[tokio::test]
async fn a_run_finishing_an_old_sign_out_keeps_the_new_tokens() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        "0193b1e8-0000-7d30-8333-0000000000d1",
        json!({"name": "A"}),
    );
    leave_sign_out_unfinished(&env.store, 1, "revoke");
    sign_in_as(&env.tokens, 2).await;

    env.engine.run_once(Trigger::Startup).await.unwrap();
    assert_eq!(
        env.tokens.load(PROFILE).unwrap(),
        Some(tokens(2)),
        "finishing A's sign-out revoked B's tokens"
    );
    assert_eq!(env.engine.status().state, SyncState::Idle);
}

/// The process died after the sign-out was recorded and before the tokens
/// were revoked. The next run revokes them first and only then removes
/// the local data.
#[tokio::test]
async fn a_run_revokes_the_tokens_before_it_wipes_a_sign_out_cut_short() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        "0193b1e8-0000-7d30-8333-0000000000d1",
        json!({"name": "A"}),
    );
    leave_sign_out_unfinished(&env.store, 1, "revoke");

    let error = env.engine.run_once(Trigger::Startup).await.unwrap_err();
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert!(
        env.tokens.load(PROFILE).unwrap().is_none(),
        "local data went while the tokens stayed"
    );
    assert_eq!(env.store.row_count(&name("parties")).unwrap(), 0);
    assert_eq!(env.engine.status().state, SyncState::AuthRequired);
}

/// Same, but the revoke fails: nothing local goes, access stays closed.
#[tokio::test]
async fn a_run_keeps_local_data_while_the_revoke_of_a_cut_short_sign_out_fails() {
    let store = Arc::new(NoSignOut::default());
    let env = env_on(store.clone(), Duration::from_secs(10)).await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        "0193b1e8-0000-7d30-8333-0000000000d1",
        json!({"name": "A"}),
    );
    leave_sign_out_unfinished(&env.store, 1, "revoke");

    let error = env.engine.run_once(Trigger::Startup).await.unwrap_err();
    assert_eq!(error.code(), "TOKEN_STORE_ERROR");
    assert_eq!(
        env.store.row_count(&name("parties")).unwrap(),
        1,
        "local data went although the tokens could not be revoked"
    );
    assert!(store.0.load(PROFILE).unwrap().is_some());
    assert_eq!(
        env.engine
            .list(&name("parties"), &ListQuery::default())
            .unwrap_err()
            .code(),
        "OFFLINE_UNAVAILABLE"
    );
}
