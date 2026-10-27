//! `HttpClient::proxy` against a wiremock server: reserved paths, header
//! allowlists, refresh and retry, deactivation compare-and-set, generation
//! binding, `Retry-After`, body limit and redaction.

use std::sync::Arc;
use std::time::Duration;

use keystone_sync::SyncError;
use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore};
use keystone_sync::client::{
    ApiConfig, ClientOptions, DeviceAuthApi, HttpClient, PROXY_BODY_LIMIT, ProxyMethod,
    ProxyRequest, ProxyResponse,
};
use keystone_sync::wire::{DeviceLoginRequest, Timestamp};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

const PROFILE: &str = "proxy";
const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";
const LOGIN: &str = "/api/v1/auth/device";
const REFRESH: &str = "/api/v1/auth/device/refresh";
const QUOTES: &str = "/api/v1/sales-quotes";
const PAD: &str = "0123456789abcdef0123456789abcdef";
const LEAK: &str = "LEAKED-SECRET-xyz789";

// ---------------------------------------------------------------- helpers

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
        request_timeout: Duration::from_secs(10),
        allow_http_localhost: true,
    }
}

fn client_with(
    server: &MockServer,
    store: &Arc<MemoryTokenStore>,
    options: &ClientOptions,
) -> HttpClient {
    let config = ApiConfig {
        base_url: server.uri(),
        company_id: Uuid::parse_str(COMPANY).expect("uuid"),
        user_agent: "keystone-desktop-test/0.1".into(),
    };
    HttpClient::new(&config, PROFILE, Arc::clone(store), options).expect("client")
}

fn client(server: &MockServer, store: &Arc<MemoryTokenStore>) -> HttpClient {
    client_with(server, store, &options())
}

fn signed_in(n: u8) -> Arc<MemoryTokenStore> {
    Arc::new(MemoryTokenStore::signed_in(PROFILE, &tokens(n)))
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

fn get(path: &str) -> ProxyRequest {
    ProxyRequest {
        method: ProxyMethod::Get,
        path: path.to_owned(),
        query: Vec::new(),
        headers: Vec::new(),
        body: None,
    }
}

fn post(path: &str, body: &Value) -> ProxyRequest {
    ProxyRequest {
        method: ProxyMethod::Post,
        path: path.to_owned(),
        query: Vec::new(),
        headers: vec![("Idempotency-Key".into(), "idem-1".into())],
        body: Some(serde_json::to_vec(body).expect("json")),
    }
}

async fn received(server: &MockServer) -> Vec<Request> {
    server.received_requests().await.expect("recording")
}

async fn requests_to(server: &MockServer, endpoint: &str) -> Vec<Request> {
    received(server)
        .await
        .into_iter()
        .filter(|r| r.url.path() == endpoint)
        .collect()
}

fn header_of<'a>(request: &'a Request, name: &str) -> Option<&'a str> {
    request.headers.get(name).and_then(|v| v.to_str().ok())
}

fn assert_no_leak(texts: &[String]) {
    for text in texts {
        for secret in ["access-", "refresh-", "hunter2", LEAK] {
            assert!(!text.contains(secret), "{secret} leaked in {text}");
        }
    }
}

fn shown(error: &SyncError) -> Vec<String> {
    vec![format!("{error}"), format!("{error:?}")]
}

// ---------------------------------------------------------------- paths

#[tokio::test]
async fn reserved_and_bad_paths_are_refused_unsent() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    for reserved in [
        "/api/v1/auth/device",
        "/api/v1/auth/device/refresh",
        "/api/v1/auth/devices",
        "/api/v1/AUTH/Device",
        "/api/v1/sync/pull",
        "/api/v1/sync/push",
        "/api/v1/sync/manifest",
        "/api/v1/sync",
        "/api/v1/Sync/Pull",
        "/api/v1/broadcasting/auth",
        "/api/v2/sales-quotes",
        "/api/v1/../sync/pull",
        "/api/v1/x/%2e%2e/sync/pull",
        "/api/v1/sales-quotes?x=1",
        "https://evil.example/api/v1/sales-quotes",
    ] {
        for request in [get(reserved), post(reserved, &json!({}))] {
            let error = client.proxy(&request).await.expect_err(reserved);
            assert_eq!(error.code(), "INVALID_SERVER_URL", "{reserved}");
        }
    }
    assert!(received(&server).await.is_empty(), "nothing was sent");
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(1)));

    // Positive control: neighbours of the reserved paths go out.
    for allowed in [
        "/api/v1/me/devices",
        "/api/v1/auth/me",
        "/api/v1/broadcasting/authx",
        "/api/v1/synchronize",
    ] {
        let response = client.proxy(&get(allowed)).await.expect(allowed);
        assert_eq!(response.status, 200, "{allowed}");
    }
    assert_eq!(received(&server).await.len(), 4);
}

// ---------------------------------------------------------------- headers

#[tokio::test]
async fn only_allowed_headers_pass_in_both_directions() {
    let server = MockServer::start().await;
    let binary: Vec<u8> = (0..=255u8).cycle().take(4096).collect();
    Mock::given(method("POST"))
        .and(path(QUOTES))
        .respond_with(
            ResponseTemplate::new(201)
                .insert_header("content-type", "application/pdf")
                .insert_header("content-disposition", "attachment; filename=\"q.pdf\"")
                .insert_header("etag", "\"v7\"")
                .insert_header("retry-after", "3")
                .insert_header("x-request-id", "req-42")
                .insert_header("set-cookie", "laravel_session=abc")
                .insert_header("x-internal", "secret")
                .insert_header("authorization", "Bearer echo")
                .set_body_bytes(binary.clone()),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let request = ProxyRequest {
        method: ProxyMethod::Post,
        path: QUOTES.into(),
        query: vec![
            ("filter[status]".into(), "draft".into()),
            ("search".into(), "a&b=c ç".into()),
        ],
        headers: vec![
            ("Idempotency-Key".into(), "idem-123".into()),
            ("accept-language".into(), "tr".into()),
            ("If-None-Match".into(), "\"v6\"".into()),
            ("Content-Type".into(), "application/merge-patch+json".into()),
            ("Authorization".into(), "Bearer forged".into()),
            (
                "X-Company-Id".into(),
                "0192f5a0-0000-7000-8000-00000000dead".into(),
            ),
            ("Cookie".into(), "laravel_session=forged".into()),
            ("Accept".into(), "text/html".into()),
            ("Host".into(), "evil.example".into()),
            ("X-Custom".into(), "x".into()),
        ],
        body: Some(b"{\"a\":1}".to_vec()),
    };
    let response = client.proxy(&request).await.expect("proxy");

    let sent = requests_to(&server, QUOTES).await;
    assert_eq!(sent.len(), 1);
    let sent = &sent[0];
    assert_eq!(header_of(sent, "authorization"), Some(bearer(1).as_str()));
    assert_eq!(header_of(sent, "x-company-id"), Some(COMPANY));
    assert_eq!(sent.headers.get_all("authorization").iter().count(), 1);
    assert_eq!(sent.headers.get_all("x-company-id").iter().count(), 1);
    assert_eq!(header_of(sent, "idempotency-key"), Some("idem-123"));
    assert_eq!(header_of(sent, "accept-language"), Some("tr"));
    assert_eq!(header_of(sent, "if-none-match"), Some("\"v6\""));
    assert_eq!(
        header_of(sent, "content-type"),
        Some("application/merge-patch+json")
    );
    assert_eq!(header_of(sent, "accept"), Some("application/json"));
    assert_eq!(header_of(sent, "cookie"), None);
    assert_eq!(header_of(sent, "x-custom"), None);
    assert_ne!(header_of(sent, "host"), Some("evil.example"));
    assert_eq!(sent.body, b"{\"a\":1}");
    let pairs: Vec<(String, String)> = sent
        .url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    assert_eq!(pairs, request.query);

    assert_eq!(response.status, 201);
    assert_eq!(response.body, binary, "body unchanged");
    let names: Vec<&str> = response.headers.iter().map(|(n, _)| n.as_str()).collect();
    for name in &names {
        assert!(
            [
                "content-type",
                "content-disposition",
                "etag",
                "retry-after",
                "x-request-id"
            ]
            .contains(name),
            "{name} must not come back"
        );
    }
    assert_eq!(response.header("Content-Type"), Some("application/pdf"));
    assert_eq!(
        response.header("content-disposition"),
        Some("attachment; filename=\"q.pdf\"")
    );
    assert_eq!(response.header("etag"), Some("\"v7\""));
    assert_eq!(response.header("x-request-id"), Some("req-42"));
    assert_eq!(response.header("retry-after"), Some("3"));
    assert_eq!(response.header("set-cookie"), None);
    assert_eq!(response.header("authorization"), None);
}

#[tokio::test]
async fn company_header_is_the_profile_company() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/me"))
        .and(header("x-company-id", COMPANY))
        .and(header("authorization", bearer(1)))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": {}})))
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let mut request = get("/api/v1/me");
    request
        .headers
        .push(("x-company-id".into(), Uuid::nil().to_string()));
    let response = client.proxy(&request).await.expect("proxy");
    assert_eq!(response.status, 200);
    assert_eq!(response.body, br#"{"data":{}}"#);
}

#[tokio::test]
async fn a_body_without_content_type_is_sent_as_json() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(QUOTES))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let response = client
        .proxy(&post(QUOTES, &json!({"x": 1})))
        .await
        .expect("proxy");
    assert_eq!(response.status, 204);
    let sent = requests_to(&server, QUOTES).await;
    assert_eq!(
        header_of(&sent[0], "content-type"),
        Some("application/json")
    );
    assert_eq!(header_of(&sent[0], "idempotency-key"), Some("idem-1"));
}

// ---------------------------------------------------------------- 401 and refresh

#[tokio::test]
async fn unauthorized_refreshes_once_and_retries_with_the_new_token() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(QUOTES))
        .and(header("authorization", bearer(1)))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Expired.")),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(QUOTES))
        .and(header("authorization", bearer(2)))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"data": {"id": 1}})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(2)))
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let generation = store.load_record(PROFILE).expect("record").generation;
    let client = client(&server, &store);
    let request = post(QUOTES, &json!({"customer": "c-1"}));
    let response = client.proxy(&request).await.expect("retried");
    assert_eq!(response.status, 201);

    let sent = requests_to(&server, QUOTES).await;
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].body, sent[1].body, "the same body is resent");
    assert_eq!(header_of(&sent[1], "idempotency-key"), Some("idem-1"));
    let record = store.load_record(PROFILE).expect("record");
    assert_eq!(record.tokens, Some(tokens(2)));
    assert_eq!(
        record.generation, generation,
        "a refresh keeps the generation"
    );
}

#[tokio::test]
async fn a_second_401_is_unauthenticated_and_redacted() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "errors": {
                "message": format!("token {LEAK} revoked"),
                "code": "UNAUTHENTICATED",
                "fields": { LEAK: ["x"] }
            }
        })))
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
    let client = client(&server, &store);
    let error = client.proxy(&get(QUOTES)).await.expect_err("401");
    assert_eq!(error.code(), "UNAUTHENTICATED");
    match &error {
        SyncError::Api { status, fields, .. } => {
            assert_eq!(*status, 401);
            assert!(fields.is_empty());
        }
        other => panic!("{other:?}"),
    }
    assert_no_leak(&shown(&error));
}

#[tokio::test]
async fn a_lost_refresh_leaves_the_store_empty_and_asks_for_sign_in() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "Expired.")),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_body(2))
                .set_delay(Duration::from_secs(3)),
        )
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let short = ClientOptions {
        request_timeout: Duration::from_secs(1),
        ..options()
    };
    let client = client_with(&server, &store, &short);
    let error = client.proxy(&get(QUOTES)).await.expect_err("lost refresh");
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert_eq!(
        store.load(PROFILE).expect("load"),
        None,
        "refresh token spent"
    );
    assert_no_leak(&shown(&error));

    // Nothing is sent afterwards until a sign-in.
    let again = client.proxy(&get(QUOTES)).await.expect_err("signed out");
    assert_eq!(again.code(), "UNAUTHENTICATED");
    assert_eq!(requests_to(&server, QUOTES).await.len(), 1);
}

#[tokio::test]
async fn a_refresh_answered_with_an_error_also_spends_the_token() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(ResponseTemplate::new(500).set_body_json(error_body("SERVER_ERROR", LEAK)))
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let error = client
        .proxy(&get(QUOTES))
        .await
        .expect_err("refresh failed");
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert_eq!(store.load(PROFILE).expect("load"), None);
    assert_no_leak(&shown(&error));
}

// ---------------------------------------------------------------- deactivation and generations

#[tokio::test]
async fn user_deactivated_marks_the_session_and_stops_later_calls() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(error_body("USER_DEACTIVATED", &format!("bye {LEAK}"))),
        )
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let error = client.proxy(&get(QUOTES)).await.expect_err("403");
    assert_eq!(error.code(), "USER_DEACTIVATED");
    assert_no_leak(&shown(&error));
    let record = store.load_record(PROFILE).expect("record");
    assert!(record.deactivated);
    assert_eq!(record.tokens, None);

    let local = client.proxy(&get(QUOTES)).await.expect_err("local");
    assert_eq!(local.code(), "USER_DEACTIVATED");
    assert_eq!(
        requests_to(&server, QUOTES).await.len(),
        1,
        "not sent again"
    );
}

#[tokio::test]
async fn a_stale_user_deactivated_keeps_the_newer_sign_in() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES))
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
    let store = signed_in(1);
    let old_generation = store.load_record(PROFILE).expect("record").generation;
    let client = Arc::new(client(&server, &store));
    let proxied = {
        let client = Arc::clone(&client);
        tokio::spawn(async move { client.proxy(&get(QUOTES)).await })
    };
    tokio::time::sleep(Duration::from_millis(100)).await;
    client.login(&login_request()).await.expect("login");
    let error = proxied.await.expect("join").expect_err("403");
    assert_eq!(error.code(), "USER_DEACTIVATED");
    let record = store.load_record(PROFILE).expect("record");
    assert!(
        !record.deactivated,
        "old answer must not mark the new session"
    );
    assert_eq!(record.tokens, Some(tokens(3)));
    assert_ne!(record.generation, old_generation);
}

#[tokio::test]
async fn a_retry_never_uses_the_token_of_a_newer_sign_in() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(QUOTES))
        .and(header("authorization", bearer(1)))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(error_body("UNAUTHENTICATED", "Expired."))
                .set_delay(Duration::from_millis(400)),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(QUOTES))
        .and(header("authorization", bearer(3)))
        .respond_with(ResponseTemplate::new(201))
        .expect(0)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(LOGIN))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(3)))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = Arc::new(client(&server, &store));
    let proxied = {
        let client = Arc::clone(&client);
        tokio::spawn(async move { client.proxy(&post(QUOTES, &json!({"a": 1}))).await })
    };
    tokio::time::sleep(Duration::from_millis(100)).await;
    client.login(&login_request()).await.expect("login");
    let error = proxied.await.expect("join").expect_err("session changed");
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert_eq!(requests_to(&server, QUOTES).await.len(), 1);
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(3)));
}

#[tokio::test]
async fn proxy_in_another_generation_is_refused_unsent() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let generation = store.load_record(PROFILE).expect("record").generation;
    let client = client(&server, &store);
    let error = client
        .proxy_in(&get(QUOTES), generation + 1)
        .await
        .expect_err("other generation");
    assert_eq!(error.code(), "UNAUTHENTICATED");
    let response = client
        .proxy_in(&get(QUOTES), generation)
        .await
        .expect("same generation");
    assert_eq!(response.status, 200);
}

#[tokio::test]
async fn without_tokens_nothing_is_sent() {
    let server = MockServer::start().await;
    let store = Arc::new(MemoryTokenStore::default());
    let client = client(&server, &store);
    let error = client.proxy(&get(QUOTES)).await.expect_err("signed out");
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert!(received(&server).await.is_empty());
}

// ---------------------------------------------------------------- pass-through, Retry-After

#[tokio::test]
async fn retry_after_comes_back_with_the_answer() {
    let server = MockServer::start().await;
    let body = error_body("TOO_MANY_ATTEMPTS", "Slow down.");
    Mock::given(method("GET"))
        .and(path(QUOTES))
        .respond_with(
            ResponseTemplate::new(429)
                .insert_header("retry-after", "7")
                .set_body_json(&body),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let response = client.proxy(&get(QUOTES)).await.expect("passed through");
    assert_eq!(response.status, 429);
    assert_eq!(response.header("retry-after"), Some("7"));
    assert_eq!(
        serde_json::from_slice::<Value>(&response.body).expect("json"),
        body
    );
}

#[tokio::test]
async fn retry_after_is_kept_on_a_sign_in_error() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES))
        .respond_with(
            ResponseTemplate::new(403)
                .insert_header("retry-after", "11")
                .set_body_json(error_body("PASSWORD_CHANGE_REQUIRED", "Change it.")),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let error = client.proxy(&get(QUOTES)).await.expect_err("password");
    assert_eq!(error.code(), "PASSWORD_CHANGE_REQUIRED");
    assert_eq!(error.retry_after(), Some(Duration::from_secs(11)));
}

#[tokio::test]
async fn error_bodies_other_than_sign_in_codes_pass_unchanged() {
    let server = MockServer::start().await;
    let validation = json!({
        "errors": {
            "message": "The customer field is required.",
            "code": "VALIDATION_ERROR",
            "fields": { "customer_id": ["The customer field is required."] }
        }
    });
    let forbidden = error_body("COMPANY_FORBIDDEN", "Not a member.");
    Mock::given(method("POST"))
        .and(path(QUOTES))
        .respond_with(ResponseTemplate::new(422).set_body_json(&validation))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(QUOTES))
        .respond_with(ResponseTemplate::new(403).set_body_json(&forbidden))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let response = client
        .proxy(&post(QUOTES, &json!({})))
        .await
        .expect("422 passed through");
    assert_eq!(response.status, 422);
    assert_eq!(
        serde_json::from_slice::<Value>(&response.body).expect("json"),
        validation
    );
    let response = client
        .proxy(&get(QUOTES))
        .await
        .expect("COMPANY_FORBIDDEN passed through");
    assert_eq!(response.status, 403);
    assert_eq!(
        serde_json::from_slice::<Value>(&response.body).expect("json"),
        forbidden
    );
    let record = store.load_record(PROFILE).expect("record");
    assert!(
        !record.deactivated,
        "the proxy leaves COMPANY_FORBIDDEN to the engine"
    );
    assert_eq!(record.tokens, Some(tokens(1)));
}

#[tokio::test]
async fn sign_in_codes_are_redacted() {
    let server = MockServer::start().await;
    for (verb, code) in [
        ("GET", "PASSWORD_CHANGE_REQUIRED"),
        ("POST", "TWO_FACTOR_REQUIRED"),
    ] {
        Mock::given(method(verb))
            .and(path(QUOTES))
            .respond_with(ResponseTemplate::new(403).set_body_json(json!({
                "errors": {
                    "message": format!("{code} for {LEAK}"),
                    "code": code,
                    "fields": { "password": [LEAK] }
                }
            })))
            .mount(&server)
            .await;
    }
    let store = signed_in(1);
    let client = client(&server, &store);
    let password = client.proxy(&get(QUOTES)).await.expect_err("password");
    assert_eq!(password.code(), "PASSWORD_CHANGE_REQUIRED");
    let two_factor = client
        .proxy(&post(QUOTES, &json!({})))
        .await
        .expect_err("2fa");
    assert_eq!(two_factor.code(), "TWO_FACTOR_REQUIRED");
    for error in [&password, &two_factor] {
        match error {
            SyncError::Api { fields, .. } => assert!(fields.is_empty()),
            other => panic!("{other:?}"),
        }
        assert_no_leak(&shown(error));
    }
    assert_eq!(store.load(PROFILE).expect("load"), Some(tokens(1)));
}

// ---------------------------------------------------------------- body limit

#[tokio::test]
async fn response_bodies_over_the_limit_are_refused() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/files/at-limit"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![7u8; PROXY_BODY_LIMIT]))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/files/over-limit"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![7u8; PROXY_BODY_LIMIT + 1]))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let at = client
        .proxy(&get("/api/v1/files/at-limit"))
        .await
        .expect("at the limit");
    assert_eq!(at.body.len(), PROXY_BODY_LIMIT);
    let over = client
        .proxy(&get("/api/v1/files/over-limit"))
        .await
        .expect_err("over the limit");
    assert_eq!(over.code(), "DECODE_ERROR");
}

#[tokio::test]
async fn request_bodies_over_the_limit_are_refused_unsent() {
    let server = MockServer::start().await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let mut request = get("/api/v1/files");
    request.method = ProxyMethod::Post;
    request.body = Some(vec![b' '; PROXY_BODY_LIMIT + 1]);
    let error = client.proxy(&request).await.expect_err("too large");
    assert_eq!(error.code(), "DECODE_ERROR");
    assert!(received(&server).await.is_empty());
}

// ---------------------------------------------------------------- nothing secret in what is logged

#[tokio::test]
async fn tokens_and_bodies_never_show_in_debug_output() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/password/change"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "data": { "token": access(9), "note": LEAK }
        })))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let request = ProxyRequest {
        method: ProxyMethod::Post,
        path: "/api/v1/auth/password/change".into(),
        query: vec![("token".into(), access(1))],
        headers: vec![("idempotency-key".into(), "k".into())],
        body: Some(
            serde_json::to_vec(&json!({"password": "hunter2", "refresh": refresh(1)}))
                .expect("json"),
        ),
    };
    let response: ProxyResponse = client.proxy(&request).await.expect("proxy");
    assert!(
        String::from_utf8_lossy(&response.body).contains(LEAK),
        "the body itself is unchanged"
    );
    let texts = vec![
        format!("{client:?}"),
        format!("{request:?}"),
        format!("{response:?}"),
        format!("{:?}", get(QUOTES)),
    ];
    assert_no_leak(&texts);
    assert!(texts[1].contains("body_len"), "{}", texts[1]);
}

#[test]
fn methods_parse_by_name() {
    assert_eq!(ProxyMethod::from_name("get"), Some(ProxyMethod::Get));
    assert_eq!(ProxyMethod::from_name("PATCH"), Some(ProxyMethod::Patch));
    assert_eq!(ProxyMethod::from_name("Delete"), Some(ProxyMethod::Delete));
    for other in ["TRACE", "CONNECT", "OPTIONS", ""] {
        assert_eq!(ProxyMethod::from_name(other), None, "{other}");
    }
}

#[tokio::test]
async fn a_second_401_without_an_error_envelope_is_still_unauthenticated() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(QUOTES))
        .respond_with(ResponseTemplate::new(401).set_body_string(format!("<html>{LEAK}</html>")))
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
    let client = client(&server, &store);
    let error = client.proxy(&get(QUOTES)).await.expect_err("401");
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert_no_leak(&shown(&error));
}
