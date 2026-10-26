//! Review follow-ups: refresh tokens are consumed atomically and never sent
//! twice (also across clients of one profile), every non-success refresh
//! answer spends the token, deactivation beats late refresh answers and is
//! handled on every call, auth errors stay redacted, raw base URL paths.

use std::sync::Arc;
use std::time::Duration;

use keystone_sync::auth::{MemoryTokenStore, Secret, SessionRecord, StoredTokens, TokenStore};
use keystone_sync::client::{
    ApiConfig, ClientOptions, DeviceAuthApi, HttpClient, ServerUrl, SyncApi,
};
use keystone_sync::error::Code;
use keystone_sync::wire::{DeviceLoginRequest, DeviceRefreshRequest, ErrorCode, Timestamp};
use keystone_sync::{Result, SyncError};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PROFILE: &str = "session-test";
const PAD: &str = "0123456789abcdef0123456789abcdef";
const MANIFEST: &str = "/api/v1/sync/manifest";
const PUSH: &str = "/api/v1/sync/push";
const LOGIN: &str = "/api/v1/auth/device";
const REFRESH: &str = "/api/v1/auth/device/refresh";

fn access(n: u8) -> String {
    format!("access-{n}-{PAD}")
}

fn refresh(n: u8) -> String {
    format!("refresh-{n}-{PAD}")
}

fn bearer(n: u8) -> String {
    format!("Bearer {}", access(n))
}

fn tokens(n: u8) -> StoredTokens {
    StoredTokens {
        access_token: Secret::new(access(n)),
        access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
        refresh_token: Secret::new(refresh(n)),
        refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
    }
}

fn token_body(n: u8) -> Value {
    json!({ "data": {
        "token": access(n),
        "expires_at": "2026-10-26T10:15:00+03:00",
        "refresh_token": refresh(n),
        "refresh_expires_at": "2026-11-25T09:15:00+03:00"
    }})
}

fn error_body(code: &str, message: &str) -> Value {
    json!({ "errors": { "message": message, "code": code } })
}

fn options() -> ClientOptions {
    ClientOptions {
        connect_timeout: Duration::from_secs(2),
        request_timeout: Duration::from_secs(5),
        allow_http_localhost: true,
    }
}

fn config(server: &MockServer) -> ApiConfig {
    ApiConfig {
        base_url: server.uri(),
        company_id: Uuid::nil(),
        user_agent: "keystone-desktop-test/0.1".into(),
    }
}

fn client<T: TokenStore + 'static>(server: &MockServer, store: &Arc<T>) -> HttpClient<T> {
    HttpClient::new(&config(server), PROFILE, Arc::clone(store), &options()).expect("client")
}

fn signed_in(n: u8) -> Arc<MemoryTokenStore> {
    let store = Arc::new(MemoryTokenStore::default());
    store.save(PROFILE, &tokens(n)).expect("save");
    store
}

async fn count(server: &MockServer, endpoint: &str) -> usize {
    server
        .received_requests()
        .await
        .expect("recording")
        .iter()
        .filter(|r| r.url.path() == endpoint)
        .count()
}

fn code_of<T: std::fmt::Debug>(result: Result<T>) -> String {
    result.expect_err("expected an error").code().to_owned()
}

async fn expired_manifest(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(header("authorization", bearer(1)))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Expired.")),
        )
        .mount(server)
        .await;
}

fn login_request() -> DeviceLoginRequest {
    DeviceLoginRequest {
        email: "user@example.com".into(),
        password: "hunter2".into(),
        two_factor_code: None,
        device_name: "Desk PC".into(),
        fingerprint: "fp-0001-desk-pc-0000".into(),
    }
}

// (1) explicit refresh -----------------------------------------------------

#[tokio::test]
async fn explicit_refresh_never_resends_a_spent_or_foreign_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(2)))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let first = DeviceRefreshRequest {
        refresh_token: refresh(1),
    };
    client.refresh(&first).await.expect("first refresh");
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(2)));

    // Same (now spent) token again, and a token the store never had.
    assert_eq!(code_of(client.refresh(&first).await), "UNAUTHENTICATED");
    let foreign = DeviceRefreshRequest {
        refresh_token: refresh(9),
    };
    assert_eq!(code_of(client.refresh(&foreign).await), "UNAUTHENTICATED");
    assert_eq!(count(&server, REFRESH).await, 1, "only the first was sent");
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(2)));
}

// (2) one lock per profile/store ----------------------------------------------

#[tokio::test]
async fn two_clients_of_one_profile_share_one_refresh() {
    let server = MockServer::start().await;
    expired_manifest(&server).await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(header("authorization", bearer(2)))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_body(2))
                .set_delay(Duration::from_millis(300)),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let a = Arc::new(client(&server, &store));
    let b = Arc::new(client(&server, &store));
    let mut calls = Vec::new();
    for c in [&a, &b, &a, &b] {
        let c = Arc::clone(c);
        calls.push(tokio::spawn(async move { c.manifest().await }));
    }
    for call in calls {
        // The body is not a manifest; only the refresh count matters here.
        let _ = call.await.expect("join");
    }
    assert_eq!(count(&server, REFRESH).await, 1);
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(2)));
}

// (3) + (6) every answer except "never connected" spends the token ----------

#[tokio::test]
async fn any_refresh_answer_spends_the_token_and_asks_for_sign_in() {
    let answers = [
        ResponseTemplate::new(503).insert_header("Retry-After", "5"),
        ResponseTemplate::new(429).set_body_json(error_body("TOO_MANY_ATTEMPTS", "Slow.")),
        ResponseTemplate::new(422).set_body_json(error_body("VALIDATION_ERROR", "Bad.")),
        ResponseTemplate::new(500).set_body_json(error_body("SERVER_ERROR", "Oops.")),
        ResponseTemplate::new(200).set_body_string("not json"),
    ];
    for answer in answers {
        let server = MockServer::start().await;
        expired_manifest(&server).await;
        Mock::given(method("POST"))
            .and(path(REFRESH))
            .respond_with(answer)
            .mount(&server)
            .await;
        let store = signed_in(1);
        let client = client(&server, &store);
        assert_eq!(code_of(client.manifest().await), "UNAUTHENTICATED");
        assert_eq!(store.load(PROFILE).expect("load"), None);
        assert_eq!(code_of(client.manifest().await), "UNAUTHENTICATED");
        assert_eq!(count(&server, REFRESH).await, 1, "never resent");
    }
}

// (4) deactivation vs a late refresh answer ---------------------------------

#[tokio::test]
async fn deactivation_wins_over_a_refresh_in_flight() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(error_body("UNAUTHENTICATED", "Expired."))
                .set_delay(Duration::from_millis(100)),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(error_body("USER_DEACTIVATED", "Disabled."))
                .set_delay(Duration::from_millis(250)),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_body(2))
                .set_delay(Duration::from_millis(600)),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = Arc::new(client(&server, &store));
    let push_request = serde_json::from_value(json!({
        "schema_version": 1,
        "mutations": [{
            "idempotency_key": "0192f5a0-0000-7000-8000-0000000000a1",
            "op": "delete",
            "resource": "parties",
            "id": "0192f5a0-0000-7000-8000-0000000000b1",
            "base_version": 3,
            "changed_fields": [],
            "occurred_at": "2026-10-26T09:00:00+03:00",
            "payload": {}
        }]
    }))
    .expect("push request");
    let pusher = {
        let client = Arc::clone(&client);
        tokio::spawn(async move { client.push(&push_request).await })
    };
    let syncer = {
        let client = Arc::clone(&client);
        tokio::spawn(async move { client.manifest().await })
    };
    let push = pusher.await.expect("join").expect_err("deactivated");
    assert_eq!(push.kind(), Code::Server(ErrorCode::UserDeactivated));
    // The refresh may finish first (its tokens are cleared right after);
    // either way the manifest call fails.
    let manifest = syncer.await.expect("join").expect_err("deactivated");
    assert!(
        matches!(manifest.code(), "USER_DEACTIVATED" | "UNAUTHENTICATED"),
        "{manifest:?}"
    );
    assert_eq!(
        store.load(PROFILE).expect("load"),
        None,
        "late refresh answer must not be saved"
    );
    let before = server.received_requests().await.expect("recording").len();
    assert_eq!(code_of(client.manifest().await), "USER_DEACTIVATED");
    assert_eq!(
        server.received_requests().await.expect("recording").len(),
        before,
        "deactivated session stays offline"
    );
}

// (5) USER_DEACTIVATED on every call, cleanup failures visible ---------------

#[tokio::test]
async fn deactivation_on_login_and_meta_clears_tokens_until_next_login() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "Disabled.")),
        )
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(3)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    assert_eq!(
        code_of(client.login(&login_request()).await),
        "USER_DEACTIVATED"
    );
    assert_eq!(store.load(PROFILE).expect("load"), None);
    assert_eq!(code_of(client.manifest().await), "USER_DEACTIVATED");
    assert_eq!(count(&server, MANIFEST).await, 0);

    // Reactivated user signs in again.
    client.login(&login_request()).await.expect("login");
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(3)));
    let _ = client.manifest().await;
    assert_eq!(count(&server, MANIFEST).await, 1);

    let meta_server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/meta"))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "Disabled.")),
        )
        .mount(&meta_server)
        .await;
    let meta_store = signed_in(1);
    let meta_client = client_for(&meta_server, &meta_store);
    assert_eq!(code_of(meta_client.server_meta().await), "USER_DEACTIVATED");
    assert_eq!(meta_store.load(PROFILE).expect("load"), None);
}

fn client_for(server: &MockServer, store: &Arc<MemoryTokenStore>) -> HttpClient<MemoryTokenStore> {
    client(server, store)
}

/// Store whose deactivation write always fails.
#[derive(Default)]
struct StuckStore(MemoryTokenStore);

impl TokenStore for StuckStore {
    fn identity(&self) -> String {
        format!("stuck:{}", self.0.identity())
    }
    fn load_record(&self, profile: &str) -> Result<SessionRecord> {
        self.0.load_record(profile)
    }
    fn load(&self, profile: &str) -> Result<Option<StoredTokens>> {
        self.0.load(profile)
    }
    fn save(&self, profile: &str, tokens: &StoredTokens) -> Result<()> {
        self.0.save(profile, tokens)
    }
    fn clear(&self, profile: &str) -> Result<()> {
        self.0.clear(profile)
    }
    fn take(&self, profile: &str) -> Result<Option<StoredTokens>> {
        self.0.take(profile)
    }
    fn sign_in(&self, profile: &str, tokens: &StoredTokens) -> Result<u64> {
        self.0.sign_in(profile, tokens)
    }
    fn deactivate(&self, _profile: &str, _expected_generation: u64) -> Result<bool> {
        Err(SyncError::TokenStore("keychain locked".into()))
    }
}

#[tokio::test]
async fn failed_cleanup_after_deactivation_is_reported() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "Disabled.")),
        )
        .mount(&server)
        .await;
    let store = Arc::new(StuckStore::default());
    store.save(PROFILE, &tokens(1)).expect("save");
    let client = client(&server, &store);
    assert_eq!(code_of(client.manifest().await), "TOKEN_STORE_ERROR");
    // Nothing was recorded, so the failure stays visible on every attempt.
    assert_eq!(code_of(client.manifest().await), "TOKEN_STORE_ERROR");
    assert_eq!(count(&server, MANIFEST).await, 2);
}

// (7) redaction ---------------------------------------------------------------

#[tokio::test]
async fn auth_error_text_is_not_carried_into_display_or_debug() {
    let leak = "LEAKED-SECRET-abc123";
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "errors": { "message": format!("bad token {leak}"), "code": "UNAUTHENTICATED",
                        "fields": { "password": [leak] } }
        })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "errors": { "message": "x", "code": format!("weird {leak}") }
        })))
        .mount(&server)
        .await;
    let store = Arc::new(MemoryTokenStore::default());
    let client = client(&server, &store);
    for _ in 0..2 {
        let error = client.login(&login_request()).await.expect_err("401");
        for text in [format!("{error}"), format!("{error:?}")] {
            assert!(!text.contains(leak), "{text}");
        }
    }
    let unknown = ErrorCode::from_wire(&format!("weird {leak}"));
    assert!(!format!("{unknown:?} {unknown}").contains(leak));
    let shaped = ErrorCode::from_wire("SYNC_NEW_CODE");
    assert_eq!(format!("{shaped:?}"), "Unknown(<redacted>)");
    assert_eq!(shaped.as_str(), "SYNC_NEW_CODE");
}

// (10) raw base path ------------------------------------------------------------

#[test]
fn base_url_path_is_checked_before_normalization() {
    for base in [
        "https://erp.example.com/a/..",
        "https://erp.example.com/%2e%2e",
        "https://erp.example.com/.",
        "https://erp.example.com//",
    ] {
        assert!(ServerUrl::parse(base, false).is_err(), "{base}");
    }
    assert!(ServerUrl::parse("https://erp.example.com/", false).is_ok());
    assert!(ServerUrl::parse("https://erp.example.com", false).is_ok());
}

// Round 2 ----------------------------------------------------------------------

/// A second store object over the same medium (like two keychain handles).
struct Handle(Arc<MemoryTokenStore>);

impl TokenStore for Handle {
    fn identity(&self) -> String {
        self.0.identity()
    }
    fn load_record(&self, profile: &str) -> Result<SessionRecord> {
        self.0.load_record(profile)
    }
    fn load(&self, profile: &str) -> Result<Option<StoredTokens>> {
        self.0.load(profile)
    }
    fn save(&self, profile: &str, tokens: &StoredTokens) -> Result<()> {
        self.0.save(profile, tokens)
    }
    fn clear(&self, profile: &str) -> Result<()> {
        self.0.clear(profile)
    }
    fn take(&self, profile: &str) -> Result<Option<StoredTokens>> {
        self.0.take(profile)
    }
    fn sign_in(&self, profile: &str, tokens: &StoredTokens) -> Result<u64> {
        self.0.sign_in(profile, tokens)
    }
    fn deactivate(&self, profile: &str, expected_generation: u64) -> Result<bool> {
        self.0.deactivate(profile, expected_generation)
    }
}

#[tokio::test]
async fn distinct_store_objects_of_one_profile_share_one_refresh() {
    let server = MockServer::start().await;
    expired_manifest(&server).await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(header("authorization", bearer(2)))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_body(2))
                .set_delay(Duration::from_millis(300)),
        )
        .mount(&server)
        .await;
    let medium = signed_in(1);
    let a = Arc::new(client(&server, &Arc::new(Handle(Arc::clone(&medium)))));
    let b = Arc::new(client(&server, &Arc::new(Handle(Arc::clone(&medium)))));
    assert!(
        Arc::ptr_eq(a.session(), b.session()),
        "one session per profile"
    );
    let mut calls = Vec::new();
    for c in [&a, &b, &a, &b] {
        let c = Arc::clone(c);
        calls.push(tokio::spawn(async move { c.manifest().await }));
    }
    for call in calls {
        let _ = call.await.expect("join");
    }
    assert_eq!(count(&server, REFRESH).await, 1);
    assert_eq!(medium.load(PROFILE).expect("load"), Some(tokens(2)));
}

#[tokio::test]
async fn deactivation_is_persistent_across_clients() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "Disabled.")),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    {
        let first = client(&server, &store);
        assert_eq!(code_of(first.manifest().await), "USER_DEACTIVATED");
    }
    assert!(store.load_record(PROFILE).expect("record").deactivated);
    // A fresh client (new session object) still knows, without a request.
    let second = client(&server, &store);
    assert_eq!(code_of(second.manifest().await), "USER_DEACTIVATED");
    assert_eq!(count(&server, MANIFEST).await, 1);
}

fn delete_push() -> keystone_sync::wire::PushRequest {
    serde_json::from_value(json!({
        "schema_version": 1,
        "mutations": [{
            "idempotency_key": "0192f5a0-0000-7000-8000-0000000000a1",
            "op": "delete",
            "resource": "parties",
            "id": "0192f5a0-0000-7000-8000-0000000000b1",
            "base_version": 3,
            "changed_fields": [],
            "occurred_at": "2026-10-26T09:00:00+03:00",
            "payload": {}
        }]
    }))
    .expect("push request")
}

#[tokio::test]
async fn stale_deactivation_after_a_new_login_keeps_the_new_tokens() {
    let server = MockServer::start().await;
    // Answered to a request sent with the old session, after the re-login.
    Mock::given(method("POST"))
        .and(path(PUSH))
        .and(header("authorization", bearer(1)))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(error_body("USER_DEACTIVATED", "Disabled."))
                .set_delay(Duration::from_millis(400)),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(3)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(header("authorization", bearer(3)))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = Arc::new(client(&server, &store));
    let pusher = {
        let client = Arc::clone(&client);
        tokio::spawn(async move { client.push(&delete_push()).await })
    };
    tokio::time::sleep(Duration::from_millis(100)).await;
    client.login(&login_request()).await.expect("login");
    let push = pusher.await.expect("join").expect_err("403");
    assert_eq!(push.code(), "USER_DEACTIVATED");
    let record = store.load_record(PROFILE).expect("record");
    assert!(
        !record.deactivated,
        "old deactivation must not mark the new session"
    );
    assert_eq!(record.tokens, Some(tokens(3)));
    let _ = client.manifest().await;
    assert_eq!(
        count(&server, MANIFEST).await,
        1,
        "new session keeps working"
    );
}

#[tokio::test]
async fn deactivation_on_a_request_with_the_new_token_applies() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(3)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(header("authorization", bearer(3)))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "Disabled.")),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = Arc::new(client(&server, &store));
    // Login and sync calls race; the generation a call reports is always
    // the one of the token it sent.
    let syncer = {
        let client = Arc::clone(&client);
        tokio::spawn(async move {
            loop {
                match client.manifest().await {
                    Err(e) if e.code() == "USER_DEACTIVATED" => return e,
                    _ => tokio::time::sleep(Duration::from_millis(5)).await,
                }
            }
        })
    };
    client.login(&login_request()).await.expect("login");
    let error = tokio::time::timeout(Duration::from_secs(5), syncer)
        .await
        .expect("deactivation seen")
        .expect("join");
    assert_eq!(error.code(), "USER_DEACTIVATED");
    let record = store.load_record(PROFILE).expect("record");
    assert!(record.deactivated);
    assert_eq!(record.tokens, None);
}

#[tokio::test]
async fn login_errors_are_fully_redacted() {
    let leak = "LEAKED-SECRET-xyz789";
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "errors": {
                "message": format!("email {leak} invalid"),
                "code": "VALIDATION_ERROR",
                "fields": { "email": [format!("{leak} is not valid")], leak: ["x"] }
            }
        })))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({
            "errors": { "message": format!("stack {leak}"), "code": "SERVER_ERROR" }
        })))
        .mount(&server)
        .await;
    let store = Arc::new(MemoryTokenStore::default());
    let client = client(&server, &store);
    let validation = client.login(&login_request()).await.expect_err("422");
    assert_eq!(validation.code(), "VALIDATION_ERROR");
    match &validation {
        SyncError::Api { fields, .. } => {
            assert!(fields.contains_key("email"), "field names are kept");
        }
        other => panic!("{other:?}"),
    }
    let server_error = client.login(&login_request()).await.expect_err("500");
    assert_eq!(server_error.code(), "SERVER_ERROR");
    for error in [&validation, &server_error] {
        for text in [format!("{error}"), format!("{error:?}")] {
            assert!(!text.contains(leak), "{text}");
        }
    }
}
