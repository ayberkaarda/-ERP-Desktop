//! `HttpClient` against a wiremock server: request/response shapes checked
//! against `contracts/sync`, device login with 2FA, single-flight refresh,
//! a lost refresh response, error mapping and URL rules.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use jsonschema::{Registry, Validator};
use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore};
use keystone_sync::client::{
    ApiConfig, ClientOptions, DeviceAuthApi, HttpClient, ServerUrl, SyncApi, fetch_server_meta,
};
use keystone_sync::error::Code;
use keystone_sync::wire::{
    DeviceLoginRequest, DeviceRefreshRequest, ErrorCode, ManifestResponse, PullRequest,
    PullResponse, PushRequest, PushResponse, Timestamp,
};
use keystone_sync::{Result, SyncError};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{body_json, body_partial_json, header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const BASE_URI: &str = "https://keystone-erp.invalid/contracts/sync/";
const PROFILE: &str = "test";
const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";

// ---------------------------------------------------------------- helpers

fn sync_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../contracts/sync")
}

fn read_json(path: &Path) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn fixture(name: &str) -> Value {
    read_json(&sync_dir().join("fixtures").join(name))
}

fn validator(schema: &str) -> Validator {
    let mut registry = Registry::new();
    let mut names: Vec<String> = fs::read_dir(sync_dir())
        .expect("contracts/sync")
        .map(|e| e.expect("entry").file_name().into_string().expect("utf-8"))
        .filter(|n| n.ends_with(".schema.json"))
        .collect();
    names.sort();
    for name in names {
        registry = registry
            .add(
                format!("{BASE_URI}{name}"),
                read_json(&sync_dir().join(&name)),
            )
            .expect("register schema");
    }
    let registry = registry.prepare().expect("prepare registry");
    jsonschema::options()
        .with_registry(&registry)
        .build(&json!({ "$ref": format!("{BASE_URI}{schema}") }))
        .unwrap_or_else(|e| panic!("{schema}: {e}"))
}

fn assert_valid(schema: &str, value: &Value) {
    let errors: Vec<String> = validator(schema)
        .iter_errors(value)
        .map(|e| format!("{} at {}", e, e.instance_path()))
        .collect();
    assert!(errors.is_empty(), "{schema}: {errors:#?}\n{value:#}");
}

const PAD: &str = "0123456789abcdef0123456789abcdef";

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
    json!({
        "data": {
            "token": access(n),
            "expires_at": "2026-10-26T10:15:00+03:00",
            "refresh_token": refresh(n),
            "refresh_expires_at": "2026-11-25T09:15:00+03:00"
        }
    })
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
        company_id: Uuid::parse_str(COMPANY).expect("uuid"),
        user_agent: "keystone-desktop-test/0.1".into(),
    }
}

fn client_with(
    server: &MockServer,
    store: &Arc<MemoryTokenStore>,
    options: &ClientOptions,
) -> HttpClient<MemoryTokenStore> {
    HttpClient::new(&config(server), PROFILE, Arc::clone(store), options).expect("client")
}

fn signed_in(n: u8) -> Arc<MemoryTokenStore> {
    let store = Arc::new(MemoryTokenStore::default());
    store.save(PROFILE, &tokens(n)).expect("save");
    store
}

async fn requests_to(server: &MockServer, endpoint: &str) -> Vec<Request> {
    server
        .received_requests()
        .await
        .expect("recording")
        .into_iter()
        .filter(|r| r.url.path() == endpoint)
        .collect()
}

fn header_of<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
    request.headers.get(name).and_then(|v| v.to_str().ok())
}

fn body_of(request: &Request) -> Value {
    serde_json::from_slice(&request.body).expect("json body")
}

fn expect_api(result: Result<impl std::fmt::Debug>) -> SyncError {
    let error = result.expect_err("expected an error");
    assert!(matches!(error, SyncError::Api { .. }), "{error:?}");
    error
}

fn status_of(error: &SyncError) -> u16 {
    match error {
        SyncError::Api { status, .. } => *status,
        other => panic!("not an API error: {other:?}"),
    }
}

/// Nothing secret in what a caller might log.
fn assert_no_secrets(error: &SyncError) {
    for text in [format!("{error}"), format!("{error:?}")] {
        for secret in ["access-", "refresh-", "hunter2", "123456"] {
            assert!(!text.contains(secret), "{secret} leaked in {text}");
        }
    }
}

const MANIFEST: &str = "/api/v1/sync/manifest";
const PULL: &str = "/api/v1/sync/pull";
const PUSH: &str = "/api/v1/sync/push";
const LOGIN: &str = "/api/v1/auth/device";
const REFRESH: &str = "/api/v1/auth/device/refresh";

// ---------------------------------------------------------------- shapes

#[tokio::test]
async fn manifest_pull_and_push_match_the_contract() {
    let server = MockServer::start().await;
    let manifest = fixture("manifest.response.sales-user.json");
    let pull = fixture("pull.response.page.json");
    let push = fixture("push.response.mixed.json");
    assert_valid("manifest.response.schema.json", &manifest);
    assert_valid("pull.response.schema.json", &pull);
    assert_valid("push.response.schema.json", &push);

    for (verb, endpoint, body) in [
        ("GET", MANIFEST, &manifest),
        ("POST", PULL, &pull),
        ("POST", PUSH, &push),
    ] {
        Mock::given(method(verb))
            .and(path(endpoint))
            .and(header("authorization", bearer(1)))
            .and(header("x-company-id", COMPANY))
            .and(header("accept", "application/json"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .expect(1)
            .mount(&server)
            .await;
    }

    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    let pull_request: PullRequest =
        serde_json::from_value(fixture("pull.request.initial-and-incremental.json"))
            .expect("pull request");
    let push_request: PushRequest =
        serde_json::from_value(fixture("push.request.outbox-batch.json")).expect("push request");

    let got_manifest = client.manifest().await.expect("manifest");
    let got_pull = client.pull(&pull_request).await.expect("pull");
    let got_push = client.push(&push_request).await.expect("push");

    assert_eq!(
        got_manifest,
        serde_json::from_value::<ManifestResponse>(manifest).expect("typed")
    );
    assert_eq!(
        got_pull,
        serde_json::from_value::<PullResponse>(pull).expect("typed")
    );
    assert_eq!(
        got_push,
        serde_json::from_value::<PushResponse>(push).expect("typed")
    );

    let manifest_requests = requests_to(&server, MANIFEST).await;
    assert!(manifest_requests[0].body.is_empty());
    for (endpoint, schema, sent) in [
        (
            PULL,
            "pull.request.schema.json",
            fixture("pull.request.initial-and-incremental.json"),
        ),
        (
            PUSH,
            "push.request.schema.json",
            fixture("push.request.outbox-batch.json"),
        ),
    ] {
        let requests = requests_to(&server, endpoint).await;
        assert_eq!(requests.len(), 1);
        assert_eq!(
            header_of(&requests[0], "content-type"),
            Some("application/json")
        );
        let body = body_of(&requests[0]);
        assert_valid(schema, &body);
        assert_eq!(body, sent, "{endpoint} body differs from the fixture");
    }
}

#[tokio::test]
async fn server_meta_is_public_and_tolerates_new_fields() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/meta"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": {
                "name": "ERP Server",
                "version": "2.4.0",
                "api_version": "v1",
                "reverb": { "host": "socket.example.test", "port": 9443, "scheme": "wss", "key": "public-key" },
                "desktop": { "min_version": "1.2.0", "update_channel": "beta", "download_url": "x" },
                "sync": { "schema_version": 1, "min_schema_version": 1 },
                "added_later": true
            }
        })))
        .expect(1)
        .mount(&server)
        .await;

    let meta = fetch_server_meta(&server.uri(), "test-agent", &options())
        .await
        .expect("meta");
    assert_eq!(meta.data.name, "ERP Server");
    assert_eq!(meta.data.reverb.port, Some(9443));
    assert_eq!(meta.data.sync.min_schema_version, 1);
    let request = &requests_to(&server, "/api/v1/meta").await[0];
    assert_eq!(header_of(request, "authorization"), None);
    assert_eq!(header_of(request, "user-agent"), Some("test-agent"));
}

// ---------------------------------------------------------------- login

#[tokio::test]
async fn login_asks_for_two_factor_then_saves_tokens() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .and(body_partial_json(json!({ "two_factor_code": "123456" })))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(1)))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(401).set_body_json(error_body(
            "TWO_FACTOR_REQUIRED",
            "Two-factor code required.",
        )))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;

    let store = Arc::new(MemoryTokenStore::default());
    let client = client_with(&server, &store, &options());
    let mut request = DeviceLoginRequest {
        email: "user@example.com".into(),
        password: "hunter2".into(),
        two_factor_code: None,
        device_name: "Desk PC".into(),
        fingerprint: "fp-0001-desk-pc-0000".into(),
    };

    let error = expect_api(client.login(&request).await);
    assert_eq!(error.code(), "TWO_FACTOR_REQUIRED");
    assert_eq!(status_of(&error), 401);
    assert_no_secrets(&error);
    assert_eq!(store.load(PROFILE).expect("load"), None);

    request.two_factor_code = Some(Some("123456".into()));
    let response = client.login(&request).await.expect("login");
    assert_eq!(response.data.token, access(1));
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(1)));

    let logins = requests_to(&server, LOGIN).await;
    assert_eq!(logins.len(), 2);
    for login in &logins {
        assert_eq!(header_of(login, "authorization"), None);
        assert_eq!(header_of(login, "x-company-id"), None);
        assert_valid("device-login.request.schema.json", &body_of(login));
    }
    assert!(body_of(&logins[0]).get("two_factor_code").is_none());
}

#[tokio::test]
async fn invalid_two_factor_code_is_reported() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({
            "errors": { "message": "Invalid code.", "code": "INVALID_TWO_FACTOR_CODE", "fields": { "two_factor_code": ["Invalid code."] } }
        })))
        .mount(&server)
        .await;
    let store = Arc::new(MemoryTokenStore::default());
    let client = client_with(&server, &store, &options());
    let error = expect_api(
        client
            .login(&DeviceLoginRequest {
                email: "user@example.com".into(),
                password: "hunter2".into(),
                two_factor_code: Some(Some("000000".into())),
                device_name: "Desk PC".into(),
                fingerprint: "fp-0001-desk-pc-0000".into(),
            })
            .await,
    );
    assert_eq!(error.code(), "INVALID_TWO_FACTOR_CODE");
    match &error {
        SyncError::Api { fields, .. } => assert!(fields.contains_key("two_factor_code")),
        other => panic!("{other:?}"),
    }
}

// ---------------------------------------------------------------- refresh

#[tokio::test]
async fn concurrent_401s_share_one_refresh() {
    let server = MockServer::start().await;
    let manifest = fixture("manifest.response.sales-user.json");
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(header("authorization", bearer(1)))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Expired.")),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(header("authorization", bearer(2)))
        .respond_with(ResponseTemplate::new(200).set_body_json(&manifest))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .and(body_json(json!({ "refresh_token": refresh(1) })))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_body(2))
                .set_delay(Duration::from_millis(300)),
        )
        .expect(1)
        .mount(&server)
        .await;

    let store = signed_in(1);
    let client = Arc::new(client_with(&server, &store, &options()));
    let calls: Vec<_> = (0..8)
        .map(|_| {
            let client = Arc::clone(&client);
            tokio::spawn(async move { client.manifest().await })
        })
        .collect();
    for call in calls {
        call.await.expect("join").expect("manifest after refresh");
    }

    let refreshes = requests_to(&server, REFRESH).await;
    assert_eq!(refreshes.len(), 1, "exactly one refresh request");
    assert_eq!(header_of(&refreshes[0], "authorization"), None);
    assert_valid(
        "device-refresh.request.schema.json",
        &body_of(&refreshes[0]),
    );
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(2)));

    // A later call goes straight to the new token.
    client.manifest().await.expect("manifest");
    assert_eq!(requests_to(&server, REFRESH).await.len(), 1);
}

#[tokio::test]
async fn second_401_after_refresh_is_returned_without_another_refresh() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Revoked.")),
        )
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(2)))
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    let request: PullRequest =
        serde_json::from_value(fixture("pull.request.initial-and-incremental.json"))
            .expect("pull request");
    let error = expect_api(client.pull(&request).await);
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert_eq!(
        requests_to(&server, PULL).await[1]
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok()),
        Some(bearer(2).as_str())
    );
}

#[tokio::test]
async fn lost_refresh_response_never_resends_the_refresh_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Expired.")),
        )
        .mount(&server)
        .await;
    // The server rotates the token, but the answer arrives after the timeout.
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_body(2))
                .set_delay(Duration::from_secs(3)),
        )
        .mount(&server)
        .await;

    let store = signed_in(1);
    let short = ClientOptions {
        request_timeout: Duration::from_millis(400),
        ..options()
    };
    let client = client_with(&server, &store, &short);

    let error = expect_api(client.manifest().await);
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert_no_secrets(&error);
    assert_eq!(
        store.load(PROFILE).expect("load"),
        None,
        "spent refresh token must leave the store"
    );

    // Later calls ask for a new sign-in instead of retrying the refresh.
    let again = expect_api(client.manifest().await);
    assert_eq!(again.code(), "UNAUTHENTICATED");
    assert_eq!(requests_to(&server, REFRESH).await.len(), 1);
    assert_eq!(
        requests_to(&server, MANIFEST).await.len(),
        1,
        "second manifest call stopped before the network"
    );
}

#[tokio::test]
async fn throttled_refresh_keeps_the_unused_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Expired.")),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("Retry-After", "60")
                .set_body_json(error_body("TOO_MANY_ATTEMPTS", "Slow down.")),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    let error = expect_api(client.manifest().await);
    assert_eq!(error.code(), "TOO_MANY_ATTEMPTS");
    assert_eq!(error.retry_after(), Some(Duration::from_secs(60)));
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(1)));
}

#[tokio::test]
async fn rejected_refresh_signs_out() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Expired.")),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Reused.")),
        )
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    assert_eq!(
        expect_api(client.manifest().await).code(),
        "UNAUTHENTICATED"
    );
    assert_eq!(store.load(PROFILE).expect("load"), None);
}

// ---------------------------------------------------------------- errors

#[tokio::test]
async fn user_deactivated_is_distinct_and_clears_tokens() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(error_body("USER_DEACTIVATED", "Account disabled.")),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    let request: PushRequest =
        serde_json::from_value(fixture("push.request.outbox-batch.json")).expect("push request");
    let error = expect_api(client.push(&request).await);
    assert_eq!(error.kind(), Code::Server(ErrorCode::UserDeactivated));
    assert_eq!(error.code(), "USER_DEACTIVATED");
    assert_eq!(status_of(&error), 403);
    assert_eq!(store.load(PROFILE).expect("load"), None);
}

#[tokio::test]
async fn user_deactivated_on_refresh_clears_tokens() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Expired.")),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(error_body("USER_DEACTIVATED", "Account disabled.")),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    let error = expect_api(client.manifest().await);
    assert_eq!(error.kind(), Code::Server(ErrorCode::UserDeactivated));
    assert_eq!(store.load(PROFILE).expect("load"), None);
}

#[tokio::test]
async fn too_many_attempts_carries_retry_after() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("Retry-After", "7")
                .set_body_json(error_body("TOO_MANY_ATTEMPTS", "Too many requests.")),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("Retry-After", "3")
                .set_body_string("rate limited"),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    let pull: PullRequest =
        serde_json::from_value(fixture("pull.request.initial-and-incremental.json"))
            .expect("pull request");
    let error = expect_api(client.pull(&pull).await);
    assert_eq!(error.code(), "TOO_MANY_ATTEMPTS");
    assert_eq!(error.retry_after(), Some(Duration::from_secs(7)));

    // No error envelope (proxy): the status decides the code.
    let push: PushRequest =
        serde_json::from_value(fixture("push.request.outbox-batch.json")).expect("push request");
    let error = expect_api(client.push(&push).await);
    assert_eq!(error.code(), "TOO_MANY_ATTEMPTS");
    assert_eq!(error.retry_after(), Some(Duration::from_secs(3)));
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(1)));
}

#[tokio::test]
async fn unknown_error_code_is_a_generic_server_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(ResponseTemplate::new(409).set_body_json(json!({
            "errors": { "message": "New rule.", "code": "SYNC_SOMETHING_NEW", "hint": "added later" }
        })))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    let error = expect_api(client.manifest().await);
    assert_eq!(error.code(), "SERVER_ERROR");
    assert_eq!(
        error.kind(),
        Code::Server(ErrorCode::Unknown("SYNC_SOMETHING_NEW".into()))
    );
    assert_eq!(status_of(&error), 409);
}

#[tokio::test]
async fn non_envelope_errors_map_by_status() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(ResponseTemplate::new(502).set_body_string("<html>Bad Gateway</html>"))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    let error = expect_api(client.manifest().await);
    assert_eq!(error.code(), "SERVER_ERROR");
    assert_eq!(status_of(&error), 502);
}

#[test]
fn unknown_codes_round_trip_and_known_codes_stay_typed() {
    let unknown: ErrorCode = serde_json::from_value(json!("BRAND_NEW")).expect("decode");
    assert_eq!(unknown, ErrorCode::Unknown("BRAND_NEW".into()));
    assert_eq!(unknown.as_str(), "BRAND_NEW");
    assert_eq!(unknown.ui_code(), "SERVER_ERROR");
    assert_eq!(unknown.http_status(), None);
    assert!(!unknown.is_known());
    assert_eq!(
        serde_json::to_value(&unknown).expect("encode"),
        json!("BRAND_NEW")
    );
    let known: ErrorCode = serde_json::from_value(json!("DOCUMENT_LOCKED")).expect("decode");
    assert_eq!(known, ErrorCode::DocumentLocked);
    assert!(ErrorCode::ALL.iter().all(ErrorCode::is_known));
}

#[tokio::test]
async fn responses_ignore_unknown_fields_requests_do_not() {
    let server = MockServer::start().await;
    let mut manifest = fixture("manifest.response.sales-user.json");
    manifest["added_later"] = json!(1);
    manifest["data"]["added_later"] = json!({ "x": 1 });
    manifest["data"]["resources"][0]["added_later"] = json!("y");
    manifest["data"]["limits"]["added_later"] = json!(2);
    let mut pull = fixture("pull.response.page.json");
    pull["data"]["added_later"] = json!(true);
    pull["data"]["resources"][0]["added_later"] = json!(true);
    pull["data"]["resources"][0]["next_cursor"]["added_later"] = json!(true);
    let mut push = fixture("push.response.rejected-and-merged.json");
    push["data"]["added_later"] = json!(true);
    push["data"]["results"][0]["added_later"] = json!(true);
    let mut token = token_body(2);
    token["data"]["device_id"] = json!("0192f5a0-0000-7000-8000-0000000000aa");
    token["meta"] = json!({ "note": "added later" });

    for (verb, endpoint, body) in [
        ("GET", MANIFEST, &manifest),
        ("POST", PULL, &pull),
        ("POST", PUSH, &push),
        ("POST", REFRESH, &token),
    ] {
        Mock::given(method(verb))
            .and(path(endpoint))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(&server)
            .await;
    }
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    client.manifest().await.expect("manifest with new fields");
    let pull_request: PullRequest =
        serde_json::from_value(fixture("pull.request.initial-and-incremental.json"))
            .expect("pull request");
    client
        .pull(&pull_request)
        .await
        .expect("pull with new fields");
    let push_request: PushRequest =
        serde_json::from_value(fixture("push.request.outbox-batch.json")).expect("push request");
    client
        .push(&push_request)
        .await
        .expect("push with new fields");
    client
        .refresh(&DeviceRefreshRequest {
            refresh_token: refresh(1),
        })
        .await
        .expect("token with new fields");
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(2)));

    let mut extra = fixture("pull.request.initial-and-incremental.json");
    extra["added_later"] = json!(1);
    assert!(serde_json::from_value::<PullRequest>(extra).is_err());
    let mut extra = fixture("push.request.outbox-batch.json");
    extra["mutations"][0]["added_later"] = json!(1);
    assert!(serde_json::from_value::<PushRequest>(extra).is_err());
}

#[tokio::test]
async fn malformed_token_body_does_not_echo_tokens() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "token": "access-9", "expires_at": 5, "refresh_token": "refresh-9" }
        })))
        .mount(&server)
        .await;
    let store = Arc::new(MemoryTokenStore::default());
    let client = client_with(&server, &store, &options());
    let error = client
        .login(&DeviceLoginRequest {
            email: "user@example.com".into(),
            password: "hunter2".into(),
            two_factor_code: None,
            device_name: "Desk PC".into(),
            fingerprint: "fp-0001-desk-pc-0000".into(),
        })
        .await
        .expect_err("malformed");
    assert_eq!(error.code(), "DECODE_ERROR");
    assert_no_secrets(&error);
    assert_eq!(store.load(PROFILE).expect("load"), None);
}

// ---------------------------------------------------------------- URL rules

#[tokio::test]
async fn http_and_foreign_paths_are_rejected() {
    let server = MockServer::start().await;
    let store = signed_in(1);

    // http only for loopback, and only when allowed.
    let strict = ClientOptions {
        allow_http_localhost: false,
        ..options()
    };
    let error = HttpClient::new(&config(&server), PROFILE, Arc::clone(&store), &strict)
        .expect_err("plain http");
    assert_eq!(error.code(), "INVALID_SERVER_URL");
    let mut remote = config(&server);
    remote.base_url = "http://erp.example.com".into();
    let error =
        HttpClient::new(&remote, PROFILE, Arc::clone(&store), &options()).expect_err("remote http");
    assert_eq!(error.code(), "INVALID_SERVER_URL");
    let mut with_path = config(&server);
    with_path.base_url = format!("{}/other", server.uri());
    assert!(HttpClient::new(&with_path, PROFILE, Arc::clone(&store), &options()).is_err());
    assert!(
        fetch_server_meta("http://erp.example.com", "ua", &options())
            .await
            .is_err()
    );

    let url = ServerUrl::parse("https://erp.example.com", false).expect("https");
    for bad in [
        "/api/v2/sync/pull",
        "/sanctum/csrf-cookie",
        "/api/v1/../x",
        "/api/v1",
    ] {
        assert_eq!(
            url.endpoint(bad).expect_err(bad).code(),
            "INVALID_SERVER_URL"
        );
    }
    assert!(
        server
            .received_requests()
            .await
            .expect("recording")
            .is_empty()
    );
}

#[tokio::test]
async fn redirects_are_not_followed() {
    let server = MockServer::start().await;
    let other = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(302)
                .insert_header("Location", format!("{}/api/v1/sync/manifest", other.uri())),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client_with(&server, &store, &options());
    let error = expect_api(client.manifest().await);
    assert_eq!(error.code(), "HTTP_ERROR");
    assert!(
        other
            .received_requests()
            .await
            .expect("recording")
            .is_empty()
    );
}

#[tokio::test]
async fn signed_out_calls_do_not_reach_the_network() {
    let server = MockServer::start().await;
    let store = Arc::new(MemoryTokenStore::default());
    let client = client_with(&server, &store, &options());
    let error = expect_api(client.manifest().await);
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert!(
        server
            .received_requests()
            .await
            .expect("recording")
            .is_empty()
    );
}

#[tokio::test]
async fn refresh_that_never_connected_keeps_the_token() {
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .expect("bind")
        .local_addr()
        .expect("addr")
        .port();
    let server = MockServer::start().await;
    let mut closed = config(&server);
    closed.base_url = format!("http://127.0.0.1:{port}");
    let store = signed_in(1);
    let client = HttpClient::new(&closed, PROFILE, Arc::clone(&store), &options()).expect("client");
    let error = client
        .refresh(&DeviceRefreshRequest {
            refresh_token: refresh(1),
        })
        .await
        .expect_err("server is gone");
    assert_eq!(error.code(), "NETWORK_ERROR");
    assert_no_secrets(&error);
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(1)));
}
