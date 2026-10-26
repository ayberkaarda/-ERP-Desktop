//! One way in: a sign-in goes through `Session::sign_in`, in order with
//! token work of the profile (a refresh in flight finishes first), and
//! sign-out revokes the tokens before it removes local data.

mod engine_support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use engine_support::*;
use keystone_sync::auth::{
    MemoryTokenStore, Session, SessionRecord, StoredTokens, TokenStore, TokenWrite,
};
use keystone_sync::engine::Trigger;
use keystone_sync::wire::MutationOp;
use serde_json::json;
use uuid::Uuid;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const REFRESH: &str = "/api/v1/auth/device/refresh";

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
        let session = Session::shared(PROFILE, store.as_ref());
        session.sign_in(store.as_ref(), &tokens(7)).await.unwrap()
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
