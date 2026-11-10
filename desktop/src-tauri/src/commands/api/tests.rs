//! `api_request` end to end against a wiremock server: the online path,
//! request checks, offline refusals, local fallbacks and the re-sign-in
//! retry.

use std::sync::Mutex;

use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore};
use keystone_sync::client::{ApiConfig, ClientOptions};
use keystone_sync::engine::SyncEngine;
use keystone_sync::store::{DbKey, Store};
use keystone_sync::wire::{ResourceName, Timestamp};
use serde_json::{Value, json};
use wiremock::matchers::{header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::dto::api::ResponseSource;
use crate::router::NoLocalCopy;
use crate::state::ActiveProfile;

const PROFILE: &str = "api-request";
const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";
const PAD: &str = "0123456789abcdef0123456789abcdef";
const ID: &str = "0192f5a0-0000-7000-8000-00000000000a";

fn access(n: u8) -> String {
    format!("access-{n}-{PAD}")
}

fn tokens(n: u8) -> StoredTokens {
    StoredTokens {
        access_token: Secret::new(access(n)),
        access_expires_at: Timestamp("2026-10-27T10:15:00+03:00".into()),
        refresh_token: Secret::new(format!("refresh-{n}-{PAD}")),
        refresh_expires_at: Timestamp("2026-11-26T09:15:00+03:00".into()),
    }
}

fn bearer(n: u8) -> String {
    format!("Bearer {}", access(n))
}

struct Fixture {
    state: AppState,
    connectivity: Connectivity,
    store: Arc<MemoryTokenStore>,
    client: Arc<HttpClient>,
    _dir: Option<tempfile::TempDir>,
}

fn client(base_url: &str, store: &Arc<MemoryTokenStore>) -> HttpClient {
    client_waiting(base_url, store, Duration::from_secs(20))
}

/// A client that gives up on an answer after `request_timeout`.
fn client_waiting(
    base_url: &str,
    store: &Arc<MemoryTokenStore>,
    request_timeout: Duration,
) -> HttpClient {
    let config = ApiConfig {
        base_url: base_url.to_owned(),
        company_id: COMPANY.parse().unwrap(),
        user_agent: "keystone-desktop-test".into(),
    };
    let options = ClientOptions {
        connect_timeout: Duration::from_secs(2),
        request_timeout,
        allow_http_localhost: true,
    };
    HttpClient::new(&config, PROFILE, store.clone(), &options).unwrap()
}

/// Signed in (generation of `tokens(1)`), active profile without engine.
fn fixture(base_url: &str) -> Fixture {
    let store = Arc::new(MemoryTokenStore::signed_in(PROFILE, &tokens(1)));
    let client = Arc::new(client(base_url, &store));
    let state = AppState::default();
    state.activate(ActiveProfile {
        id: PROFILE.into(),
        client: client.clone(),
        engine: None,
    });
    Fixture {
        state,
        connectivity: Connectivity::default(),
        store,
        client,
        _dir: None,
    }
}

/// [`fixture`] plus an engine over an encrypted temp store.
fn fixture_with_engine(base_url: &str) -> Fixture {
    let mut fixture = fixture(base_url);
    let dir = tempfile::tempdir().unwrap();
    let db = Store::open(dir.path().join("p.db"), &DbKey::from_bytes([7; 32])).unwrap();
    let manifest =
        keystone_sync::store::offline_manifest(crate::router::decide::OFFLINE_MANIFEST).unwrap();
    let engine = Arc::new(
        SyncEngine::new(client(base_url, &fixture.store), Arc::new(db))
            .with_offline_manifest(manifest),
    );
    fixture.state.set_engine(PROFILE, engine).unwrap();
    fixture._dir = Some(dir);
    fixture
}

/// [`fixture_with_engine`] whose clients give up on an answer after
/// `request_timeout`.
fn fixture_waiting(base_url: &str, request_timeout: Duration) -> Fixture {
    let store = Arc::new(MemoryTokenStore::signed_in(PROFILE, &tokens(1)));
    let client = Arc::new(client_waiting(base_url, &store, request_timeout));
    let state = AppState::default();
    state.activate(ActiveProfile {
        id: PROFILE.into(),
        client: client.clone(),
        engine: None,
    });
    let dir = tempfile::tempdir().unwrap();
    let db = Store::open(dir.path().join("p.db"), &DbKey::from_bytes([7; 32])).unwrap();
    let manifest =
        keystone_sync::store::offline_manifest(crate::router::decide::OFFLINE_MANIFEST).unwrap();
    let engine = Arc::new(
        SyncEngine::new(
            client_waiting(base_url, &store, request_timeout),
            Arc::new(db),
        )
        .with_offline_manifest(manifest),
    );
    state.set_engine(PROFILE, engine).unwrap();
    Fixture {
        state,
        connectivity: Connectivity::default(),
        store,
        client,
        _dir: Some(dir),
    }
}

impl Fixture {
    async fn call(&self, request: Value) -> CommandResult<ApiResponseDto> {
        self.call_with(Arc::new(NoLocalCopy), request).await
    }

    async fn call_with(
        &self,
        resolver: Arc<dyn LocalResolver>,
        request: Value,
    ) -> CommandResult<ApiResponseDto> {
        let request: ApiRequestDto = serde_json::from_value(request).unwrap();
        handle(&self.state, &self.connectivity, resolver, request).await
    }

    fn go_offline(&self) {
        self.connectivity.observe(PROFILE, false, Instant::now());
    }
}

/// A local copy that answers with `answer` (or cannot answer) and records
/// the plans it was given.
struct FakeLocal {
    copy: LocalCopy,
    answer: Option<ApiResponseDto>,
    /// The answer is a partial search ([`LocalOutcome::PartialSearch`]).
    partial_search: bool,
    plans: Mutex<Vec<LocalPlan>>,
}

impl FakeLocal {
    fn new(copy: LocalCopy, answer: Option<Value>) -> Arc<Self> {
        Arc::new(Self {
            copy,
            answer: answer.map(|body| envelope::local(200, body)),
            partial_search: false,
            plans: Mutex::default(),
        })
    }

    /// Answers with `body` as a partial search.
    fn partial_search(copy: LocalCopy, body: Value) -> Arc<Self> {
        Arc::new(Self {
            copy,
            answer: Some(envelope::local(200, body)),
            partial_search: true,
            plans: Mutex::default(),
        })
    }

    fn plans(&self) -> Vec<LocalPlan> {
        self.plans.lock().unwrap().clone()
    }
}

impl LocalResolver for FakeLocal {
    fn local_copy(
        &self,
        _: &Engine,
        _: Option<&Store>,
        _: &ResourceName,
    ) -> CommandResult<LocalCopy> {
        Ok(self.copy)
    }

    fn resolve(
        &self,
        _: &Engine,
        _: Option<&Store>,
        plan: &LocalPlan,
        _: &ApiCall,
    ) -> CommandResult<LocalOutcome> {
        self.plans.lock().unwrap().push(plan.clone());
        Ok(match &self.answer {
            Some(answer) if self.partial_search => LocalOutcome::PartialSearch(answer.clone()),
            Some(answer) => LocalOutcome::Answer(answer.clone()),
            None => LocalOutcome::Unsupported {
                unsupported_filters: vec!["filter[city]".into()],
            },
        })
    }
}

fn parties_page() -> Value {
    json!({
        "data": [{ "id": ID, "name": "Acme" }],
        "meta": { "pagination": { "current_page": 1, "per_page": 25, "total": 1, "last_page": 1 } }
    })
}

async fn received(server: &MockServer) -> usize {
    server.received_requests().await.unwrap_or_default().len()
}

/// A loopback base URL nothing can listen on: port 0 is never a listening
/// port, so the connection fails at once. A port bound and let go could be
/// taken by a wiremock server of a test running at the same time.
async fn dead_url() -> String {
    "http://127.0.0.1:0".to_owned()
}

// ------------------------------------------------------------ online path

#[tokio::test(flavor = "multi_thread")]
async fn get_parties_online_end_to_end() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/parties"))
        .and(query_param("page", "2"))
        .and(query_param("search", "acme"))
        .and(header("authorization", bearer(1).as_str()))
        .and(header("x-company-id", COMPANY))
        .and(header("accept-language", "tr"))
        .and(header("accept", "application/json"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(parties_page())
                .insert_header("x-request-id", "req-1")
                .insert_header("set-cookie", "laravel_session=x"),
        )
        .expect(1)
        .mount(&server)
        .await;
    let fx = fixture(&server.uri());

    let answer = fx
        .call(json!({
            "method": "GET",
            "path": "/api/v1/parties",
            "query": [["page", "2"], ["search", "acme"]],
            "headers": [["Accept-Language", "tr"], ["Cookie", "a=b"], ["Authorization", "Bearer x"]]
        }))
        .await
        .unwrap();

    assert_eq!(answer.status, 200);
    assert_eq!(answer.source, ResponseSource::Network);
    assert_eq!(answer.json(), Some(&parties_page()));
    assert_eq!(answer.header("x-request-id"), Some("req-1"));
    assert_eq!(answer.header("set-cookie"), None);
    assert!(fx.connectivity.online(PROFILE, Some(true), Instant::now()));
}

#[tokio::test(flavor = "multi_thread")]
async fn server_errors_come_back_as_answers() {
    let server = MockServer::start().await;
    let body = json!({ "errors": { "message": "name is required", "code": "VALIDATION_ERROR",
        "fields": { "name": ["required"] } } });
    Mock::given(method("POST"))
        .and(path("/api/v1/parties"))
        .and(header("idempotency-key", "k-1"))
        .and(header("content-type", "application/json"))
        .respond_with(ResponseTemplate::new(422).set_body_json(body.clone()))
        .expect(1)
        .mount(&server)
        .await;
    let fx = fixture(&server.uri());

    let answer = fx
        .call(json!({
            "method": "POST",
            "path": "/api/v1/parties",
            "headers": [["Idempotency-Key", "k-1"]],
            "body": { "kind": "json", "value": { "name": "" } }
        }))
        .await
        .unwrap();
    assert_eq!(answer.status, 422);
    assert_eq!(answer.json(), Some(&body));
    let sent = &server.received_requests().await.unwrap()[0];
    assert_eq!(sent.body, br#"{"name":""}"#);
}

#[tokio::test(flavor = "multi_thread")]
async fn binary_answers_and_bodies_pass_through() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(format!("/api/v1/sales-invoices/{ID}/pdf")))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_raw(b"%PDF".to_vec(), "application/pdf")
                .insert_header("content-disposition", "attachment; filename=a.pdf"),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/attachments"))
        .and(header("content-type", "application/octet-stream"))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    let fx = fixture(&server.uri());

    let pdf = fx
        .call(json!({ "method": "GET", "path": format!("/api/v1/sales-invoices/{ID}/pdf") }))
        .await
        .unwrap();
    assert_eq!(
        pdf.body,
        Some(ApiBody::Binary {
            base64: "JVBERg==".into()
        })
    );
    assert_eq!(
        pdf.header("content-disposition"),
        Some("attachment; filename=a.pdf")
    );

    let upload = fx
        .call(json!({ "method": "POST", "path": "/api/v1/attachments",
            "body": { "kind": "binary", "base64": "JVBERg==" } }))
        .await
        .unwrap();
    assert_eq!((upload.status, upload.body), (204, None));
    let sent = server.received_requests().await.unwrap();
    assert_eq!(sent[1].body, b"%PDF");
}

#[tokio::test(flavor = "multi_thread")]
async fn retry_after_of_a_redacted_sign_in_failure_is_kept() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/parties"))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(json!({ "errors": {
                    "message": "user hunter2 deactivated", "code": "USER_DEACTIVATED" } }))
                .insert_header("retry-after", "30"),
        )
        .mount(&server)
        .await;
    let fx = fixture(&server.uri());

    let error = fx
        .call(json!({ "method": "GET", "path": "/api/v1/parties" }))
        .await
        .unwrap_err();
    assert_eq!(error.code, "USER_DEACTIVATED");
    assert_eq!(error.retry_after, Some(30));
    assert!(!error.message.contains("hunter2"), "{}", error.message);
}

// ------------------------------------------------------------ checks

#[tokio::test(flavor = "multi_thread")]
async fn invalid_requests_are_refused_before_sending() {
    let server = MockServer::start().await;
    let fx = fixture(&server.uri());
    let cases = [
        json!({ "method": "HEAD", "path": "/api/v1/parties" }),
        json!({ "method": "TRACE", "path": "/api/v1/parties" }),
        json!({ "method": "GET", "path": "/api/v1/parties?page=2" }),
        json!({ "method": "GET", "path": "/api/v1/parties#x" }),
        json!({ "method": "GET", "path": "/api/v1/../v2/parties" }),
        json!({ "method": "GET", "path": "/api/v1/parties/./x" }),
        json!({ "method": "GET", "path": "/api/v1//parties" }),
        json!({ "method": "GET", "path": "/api/v1/parties/" }),
        json!({ "method": "GET", "path": "/api/v1/" }),
        json!({ "method": "GET", "path": "/api/v1/part%69es" }),
        json!({ "method": "GET", "path": "https://evil.example/api/v1/parties" }),
        json!({ "method": "GET", "path": "//evil.example/api/v1/parties" }),
        json!({ "method": "GET", "path": "/api/v1/parties\\x" }),
        json!({ "method": "GET", "path": "/api/v1/cari kartlar" }),
        json!({ "method": "GET", "path": "/api/v1/parties",
            "body": { "kind": "json", "value": {} } }),
        json!({ "method": "POST", "path": "/api/v1/parties",
            "headers": [["Idempotency-Key", "k\r\nX-Evil: 1"]] }),
        json!({ "method": "POST", "path": "/api/v1/parties",
            "body": { "kind": "binary", "base64": "%%%" } }),
        json!({ "method": "POST", "path": "/api/v1/auth/logout" }),
        json!({ "method": "POST", "path": "/api/v1/auth/device" }),
        json!({ "method": "POST", "path": "/api/v1/AUTH/device/refresh" }),
        json!({ "method": "POST", "path": "/api/v1/sync/push" }),
        json!({ "method": "GET", "path": "/api/v1/sync/manifest" }),
        json!({ "method": "POST", "path": "/api/v1/broadcasting/auth" }),
        json!({ "method": "POST", "path": "/api/v1/auth/me" }),
    ];
    for case in cases {
        let error = fx.call(case.clone()).await.unwrap_err();
        assert_eq!(error.code, "INVALID_REQUEST", "{case}");
        assert!(!error.message.contains("evil"), "{}", error.message);
    }
    // Refused offline too, before any routing.
    fx.go_offline();
    let error = fx
        .call(json!({ "method": "POST", "path": "/api/v1/sync/push" }))
        .await
        .unwrap_err();
    assert_eq!(error.code, "INVALID_REQUEST");
    assert_eq!(received(&server).await, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn allowed_neighbours_of_reserved_paths_are_sent() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": {} })))
        .mount(&server)
        .await;
    let fx = fixture(&server.uri());
    for path in [
        "/api/v1/auth/me",
        "/api/v1/authors",
        "/api/v1/synchronize",
        "/api/v1/broadcasting/authx",
        "/api/v1/me/devices",
    ] {
        let answer = fx
            .call(json!({ "method": "GET", "path": path }))
            .await
            .unwrap();
        assert_eq!(answer.status, 200, "{path}");
    }
    assert_eq!(received(&server).await, 5);
}

#[tokio::test(flavor = "multi_thread")]
async fn oversized_bodies_are_refused_before_sending() {
    let server = MockServer::start().await;
    let fx = fixture(&server.uri());
    let text = "x".repeat(PROXY_BODY_LIMIT + 1);
    let error = fx
        .call(json!({ "method": "POST", "path": "/api/v1/attachments",
            "body": { "kind": "text", "value": text } }))
        .await
        .unwrap_err();
    assert_eq!(error.code, "PAYLOAD_TOO_LARGE");
    assert_eq!(received(&server).await, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn no_profile_is_reported() {
    let state = AppState::default();
    let request: ApiRequestDto =
        serde_json::from_value(json!({ "method": "GET", "path": "/api/v1/parties" })).unwrap();
    let error = handle(
        &state,
        &Connectivity::default(),
        Arc::new(NoLocalCopy),
        request,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, codes::NO_ACTIVE_PROFILE);
}

// ------------------------------------------------------------ offline

#[tokio::test(flavor = "multi_thread")]
async fn offline_requests_are_refused_locally_without_sending() {
    let server = MockServer::start().await;
    let fx = fixture(&server.uri());
    fx.go_offline();
    for (request, method, path) in [
        (
            json!({ "method": "GET", "path": "/api/v1/parties" }),
            "GET",
            "/parties",
        ),
        (
            json!({ "method": "get", "path": "/api/v1/reports/trial-balance",
                "query": [["access_token", "tok-1"], ["from", "2026-01-01"]] }),
            "GET",
            "/reports/trial-balance",
        ),
        (
            json!({ "method": "post", "path": "/api/v1/parties",
                "body": { "kind": "json", "value": { "name": "Acme" } } }),
            "POST",
            "/parties",
        ),
    ] {
        let answer = fx.call(request.clone()).await.unwrap();
        assert_eq!(answer.status, 503, "{request}");
        assert_eq!(answer.source, ResponseSource::Local);
        assert_eq!(
            answer.json().unwrap(),
            &json!({ "errors": {
                "message": Refusal::Offline.message(),
                "code": "OFFLINE_UNAVAILABLE",
                "details": { "method": method, "path": path },
            } }),
            "{request}"
        );
    }
    assert_eq!(received(&server).await, 0);
}

fn refused(status: u16, code: &str, source: ResponseSource) -> ApiResponseDto {
    ApiResponseDto {
        source,
        ..envelope::local(status, envelope::error(code, "refused", None))
    }
}

fn details(answer: &ApiResponseDto) -> Option<&Value> {
    answer.json().unwrap()["errors"].get("details")
}

#[test]
fn both_local_refusals_name_the_refused_request() {
    let path = format!("/api/v1/sales-quotes/{ID}/send");
    for (status, code) in [
        (503, "OFFLINE_UNAVAILABLE"),
        (422, "SYNC_OFFLINE_WRITE_NOT_ALLOWED"),
    ] {
        let answer = name_refused(
            refused(status, code, ResponseSource::Local),
            ProxyMethod::Post,
            &path,
        );
        assert_eq!(
            details(&answer),
            Some(&json!({ "method": "POST", "path": format!("/sales-quotes/{ID}/send") })),
            "{code}"
        );
        assert_eq!(answer.json().unwrap()["errors"]["code"], code);
        assert_eq!(answer.json().unwrap()["errors"]["message"], "refused");
    }
    for (method, name) in [
        (ProxyMethod::Get, "GET"),
        (ProxyMethod::Put, "PUT"),
        (ProxyMethod::Patch, "PATCH"),
        (ProxyMethod::Delete, "DELETE"),
    ] {
        let answer = name_refused(
            refused(503, "OFFLINE_UNAVAILABLE", ResponseSource::Local),
            method,
            "/api/v1/parties",
        );
        assert_eq!(details(&answer).unwrap()["method"], name);
    }
}

#[test]
fn the_path_is_named_as_it_was_sent() {
    let upper = ID.to_ascii_uppercase();
    let answer = name_refused(
        refused(503, "OFFLINE_UNAVAILABLE", ResponseSource::Local),
        ProxyMethod::Post,
        &format!("/api/v1/Sales-Quotes/{upper}/send"),
    );
    assert_eq!(
        details(&answer),
        Some(&json!({ "method": "POST", "path": format!("/Sales-Quotes/{upper}/send") }))
    );
}

/// The shared fixture of the TS contract test
/// (`src/platform/desktop/localRefusal.test.ts`): both local refusals of
/// `POST /sales-quotes/{id}/send` as the shell sends them. The webview reads
/// the same file, so a change of the envelope here breaks that test too.
const REFUSAL_FIXTURE: &str = include_str!("../../../../src/platform/desktop/localRefusal.json");
const FIXTURE_QUOTE: &str = "0193b1e5-0c11-7a22-9b33-4c5d6e7f8a20";

#[test]
fn the_webview_fixture_is_what_the_shell_sends() {
    let path = format!("/api/v1/sales-quotes/{FIXTURE_QUOTE}/send");
    let sent: Vec<Value> = [Refusal::OnlineOnlyWrite, Refusal::ManifestMismatch]
        .into_iter()
        .map(|refusal| {
            let answer = name_refused(refuse(refusal, Vec::new()), ProxyMethod::Post, &path);
            json!({ "status": answer.status, "body": answer.json().unwrap() })
        })
        .collect();
    let fixture: Value = serde_json::from_str(REFUSAL_FIXTURE).unwrap();
    assert_eq!(
        fixture,
        Value::Array(sent.clone()),
        "update the fixture to:
{}",
        serde_json::to_string_pretty(&sent).unwrap()
    );
}

#[test]
fn other_answers_are_not_given_request_details() {
    let path = "/api/v1/parties";
    for answer in [
        // The server's answer is passed on as it came.
        refused(503, "OFFLINE_UNAVAILABLE", ResponseSource::Network),
        refused(
            422,
            "SYNC_OFFLINE_WRITE_NOT_ALLOWED",
            ResponseSource::Network,
        ),
        // A code with another status is not one of the two refusals.
        refused(422, "OFFLINE_UNAVAILABLE", ResponseSource::Local),
        refused(503, "SYNC_OFFLINE_WRITE_NOT_ALLOWED", ResponseSource::Local),
        // Other local errors.
        refused(403, "FORBIDDEN", ResponseSource::Local),
        refused(422, "VALIDATION_ERROR", ResponseSource::Local),
        refused(404, "NOT_FOUND", ResponseSource::Local),
    ] {
        let before = answer.clone();
        assert_eq!(name_refused(answer, ProxyMethod::Get, path), before);
    }
    let data = envelope::local(202, json!({ "data": { "id": ID } }));
    assert_eq!(name_refused(data.clone(), ProxyMethod::Post, path), data);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_online_first_fallback_refusal_names_the_request() {
    let fx = fixture_with_engine(&dead_url().await);
    let local = Arc::new(FakeLocal {
        copy: LocalCopy::Complete,
        answer: Some(envelope::local(
            503,
            envelope::error("OFFLINE_UNAVAILABLE", "not on this device", None),
        )),
        partial_search: false,
        plans: Mutex::default(),
    });
    let answer = fx
        .call_with(
            local.clone(),
            json!({ "method": "get", "path": "/api/v1/sales-deliveries",
                "query": [["access_token", "tok-1"]] }),
        )
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    assert!(matches!(
        local.plans().as_slice(),
        [LocalPlan::Read { stale: true, .. }]
    ));
    assert_eq!(
        details(&answer),
        Some(&json!({ "method": "GET", "path": "/sales-deliveries" }))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_local_answer_from_the_resolver_names_the_refused_request() {
    let server = MockServer::start().await;
    let fx = fixture_with_engine(&server.uri());
    fx.go_offline();
    let local = Arc::new(FakeLocal {
        copy: LocalCopy::Complete,
        answer: Some(envelope::local(
            422,
            envelope::error(
                "SYNC_OFFLINE_WRITE_NOT_ALLOWED",
                "offline writes are closed",
                None,
            ),
        )),
        partial_search: false,
        plans: Mutex::default(),
    });
    let answer = fx
        .call_with(
            local,
            json!({ "method": "post", "path": "/api/v1/parties",
                "body": { "kind": "json", "value": { "name": "Acme" } } }),
        )
        .await
        .unwrap();
    assert_eq!(answer.status, 422);
    assert_eq!(
        details(&answer),
        Some(&json!({ "method": "POST", "path": "/parties" }))
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_network_failure_turns_the_profile_offline() {
    let fx = fixture(&dead_url().await);
    let error = fx
        .call(json!({ "method": "GET", "path": "/api/v1/parties" }))
        .await
        .unwrap_err();
    assert_eq!(error.code, "NETWORK_ERROR");
    assert!(!fx.connectivity.online(PROFILE, None, Instant::now()));

    let answer = fx
        .call(json!({ "method": "GET", "path": "/api/v1/parties" }))
        .await
        .unwrap();
    assert_eq!(answer.status, 503);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_fresh_engine_does_not_block_requests() {
    let server = MockServer::start().await;
    let fx = fixture_with_engine(&server.uri());
    // A fresh engine is not offline: requests go out.
    Mock::given(method("GET"))
        .and(path("/api/v1/parties"))
        .respond_with(ResponseTemplate::new(200).set_body_json(parties_page()))
        .mount(&server)
        .await;
    let answer = fx
        .call(json!({ "method": "GET", "path": "/api/v1/parties" }))
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Network);
}

#[tokio::test(flavor = "multi_thread")]
async fn offline_drafts_go_to_the_local_resolver() {
    let server = MockServer::start().await;
    let fx = fixture_with_engine(&server.uri());
    fx.go_offline();
    let local = FakeLocal::new(
        LocalCopy::Complete,
        Some(json!({ "data": { "id": ID }, "meta": { "offline": { "pending": true } } })),
    );

    let answer = fx
        .call_with(
            local.clone(),
            json!({ "method": "POST", "path": "/api/v1/parties",
                "body": { "kind": "json", "value": { "id": ID, "name": "Acme" } } }),
        )
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    assert_eq!(answer.json().unwrap()["data"]["id"], ID);
    assert!(matches!(
        local.plans().as_slice(),
        [LocalPlan::Write {
            op: keystone_sync::wire::MutationOp::Create,
            ..
        }]
    ));

    // An online-only action is refused without asking the local copy.
    let refused = fx
        .call_with(
            local.clone(),
            json!({ "method": "POST", "path": format!("/api/v1/sales-quotes/{ID}/send") }),
        )
        .await
        .unwrap();
    assert_eq!(refused.status, 503);
    assert_eq!(
        details(&refused),
        Some(&json!({ "method": "POST", "path": format!("/sales-quotes/{ID}/send") }))
    );
    assert_eq!(local.plans().len(), 1);
    assert_eq!(received(&server).await, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn offline_unsupported_local_query_lists_the_filters() {
    let server = MockServer::start().await;
    let fx = fixture_with_engine(&server.uri());
    fx.go_offline();
    let local = FakeLocal::new(LocalCopy::Complete, None);
    let answer = fx
        .call_with(
            local,
            json!({ "method": "GET", "path": "/api/v1/parties",
                "query": [["filter[city]", "Ankara"]] }),
        )
        .await
        .unwrap();
    assert_eq!(answer.status, 503);
    let body = answer.json().unwrap();
    assert_eq!(body["errors"]["code"], "OFFLINE_UNAVAILABLE");
    assert_eq!(
        body["errors"]["details"],
        json!({ "method": "GET", "path": "/parties" })
    );
    assert_eq!(
        body["meta"]["offline"]["unsupported_filters"],
        json!(["filter[city]"])
    );
}

// ------------------------------------------------------------ local first

#[tokio::test(flavor = "multi_thread")]
async fn local_first_reads_answer_locally_while_online() {
    let server = MockServer::start().await;
    let fx = fixture_with_engine(&server.uri());
    let local = FakeLocal::new(LocalCopy::Complete, Some(parties_page()));
    let answer = fx
        .call_with(
            local.clone(),
            json!({ "method": "GET", "path": "/api/v1/parties" }),
        )
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    assert_eq!(received(&server).await, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn local_first_goes_online_when_the_local_copy_cannot_answer() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/parties"))
        .respond_with(ResponseTemplate::new(200).set_body_json(parties_page()))
        .expect(1)
        .mount(&server)
        .await;
    let fx = fixture_with_engine(&server.uri());
    let local = FakeLocal::new(LocalCopy::Complete, None);
    let answer = fx
        .call_with(
            local.clone(),
            json!({ "method": "GET", "path": "/api/v1/parties",
                "query": [["filter[city]", "Ankara"]] }),
        )
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Network);
    assert_eq!(local.plans().len(), 1);
}

// ------------------------------------------------------------ online first

#[tokio::test(flavor = "multi_thread")]
async fn online_first_falls_back_to_the_stale_local_copy_when_unreachable() {
    let fx = fixture_with_engine(&dead_url().await);
    let local = FakeLocal::new(LocalCopy::Complete, Some(json!({ "data": [] })));
    let answer = fx
        .call_with(
            local.clone(),
            json!({ "method": "GET", "path": "/api/v1/sales-deliveries" }),
        )
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    assert!(matches!(
        local.plans().as_slice(),
        [LocalPlan::Read { stale: true, .. }]
    ));
}

/// An online-first read whose local answer is a partial search: the server
/// cannot be reached, so the partial answer stands in, marked as it came.
#[tokio::test(flavor = "multi_thread")]
async fn online_first_falls_back_to_a_partial_search_when_unreachable() {
    let fx = fixture_with_engine(&dead_url().await);
    let body = json!({ "data": ["local"], "meta": { "offline": { "search_partial": true } } });
    let local = FakeLocal::partial_search(LocalCopy::Complete, body.clone());
    let answer = fx
        .call_with(
            local.clone(),
            json!({ "method": "GET", "path": "/api/v1/sales-deliveries", "query": [["q", "x"]] }),
        )
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    assert_eq!(answer.json(), Some(&body));
    assert!(matches!(
        local.plans().as_slice(),
        [LocalPlan::Read { stale: true, .. }]
    ));
}

/// Online, a server that answers wins over a partial search of a
/// local-first list: the local answer is asked for and not used.
#[tokio::test(flavor = "multi_thread")]
async fn online_a_partial_search_gives_way_to_the_server() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/parties"))
        .respond_with(ResponseTemplate::new(200).set_body_json(parties_page()))
        .expect(1)
        .mount(&server)
        .await;
    let fx = fixture_with_engine(&server.uri());
    let local = FakeLocal::partial_search(LocalCopy::Complete, json!({ "data": ["local"] }));
    let answer = fx
        .call_with(
            local.clone(),
            json!({ "method": "GET", "path": "/api/v1/parties", "query": [["q", "acme"]] }),
        )
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Network);
    assert_eq!(answer.json(), Some(&parties_page()));
    assert_eq!(local.plans().len(), 1);
}

/// A slow answer is not a dead server: after an online-first read stops
/// waiting, the profile stays online and the next write reaches the server.
#[tokio::test(flavor = "multi_thread")]
async fn a_slow_read_does_not_turn_the_profile_offline() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/sales-deliveries"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "data": [] }))
                .set_delay(Duration::from_secs(7)),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/parties"))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "data": { "id": ID } })))
        .expect(1)
        .mount(&server)
        .await;
    let fx = fixture_with_engine(&server.uri());
    let local = FakeLocal::new(LocalCopy::Complete, Some(json!({ "data": ["local"] })));

    let read = fx
        .call_with(
            local.clone(),
            json!({ "method": "GET", "path": "/api/v1/sales-deliveries" }),
        )
        .await
        .unwrap();
    assert_eq!(read.source, ResponseSource::Local);
    assert!(fx.connectivity.online(PROFILE, Some(false), Instant::now()));

    let write = fx
        .call_with(
            local.clone(),
            json!({ "method": "POST", "path": "/api/v1/parties",
                "body": { "kind": "json", "value": { "name": "Acme" } } }),
        )
        .await
        .unwrap();
    assert_eq!((write.status, write.source), (201, ResponseSource::Network));
    let posts = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.method.as_str() == "POST")
        .count();
    assert_eq!(posts, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn online_first_stops_waiting_at_the_deadline() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/sales-deliveries"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "data": [] }))
                .set_delay(Duration::from_secs(15)),
        )
        .mount(&server)
        .await;
    let fx = fixture_with_engine(&server.uri());
    let local = FakeLocal::new(LocalCopy::Complete, Some(json!({ "data": ["local"] })));
    let started = Instant::now();
    let answer = fx
        .call_with(
            local.clone(),
            json!({ "method": "GET", "path": "/api/v1/sales-deliveries" }),
        )
        .await
        .unwrap();
    let waited = started.elapsed();
    assert_eq!(answer.json().unwrap()["data"][0], "local");
    assert!(
        waited >= crate::router::ONLINE_FIRST_DEADLINE && waited < Duration::from_secs(10),
        "{waited:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn online_first_without_a_local_copy_reports_the_network_error() {
    let fx = fixture_with_engine(&dead_url().await);
    let local = FakeLocal::new(LocalCopy::Missing, Some(json!({ "data": [] })));
    let error = fx
        .call_with(
            local.clone(),
            json!({ "method": "GET", "path": "/api/v1/sales-deliveries" }),
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, "NETWORK_ERROR");
    assert!(local.plans().is_empty());
}

// ------------------------------------------------------------ sign-in race

/// A sign-in that lands while the request is in flight: the stale 401 is
/// not the user's answer; the request goes once more with the new tokens.
#[tokio::test(flavor = "multi_thread")]
async fn a_sign_in_during_the_call_sends_it_once_more() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/parties"))
        .and(header("authorization", bearer(1).as_str()))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(json!({ "errors": { "message": "x", "code": "UNAUTHENTICATED" } }))
                .set_delay(Duration::from_millis(500)),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/parties"))
        .and(header("authorization", bearer(2).as_str()))
        .respond_with(ResponseTemplate::new(200).set_body_json(parties_page()))
        .expect(1)
        .mount(&server)
        .await;
    let fx = Arc::new(fixture(&server.uri()));

    let call = {
        let fx = fx.clone();
        tokio::spawn(async move {
            fx.call(json!({ "method": "GET", "path": "/api/v1/parties" }))
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(150)).await;
    fx.client.session().sign_in(&tokens(2)).await.unwrap();

    let answer = call.await.unwrap().unwrap();
    assert_eq!(answer.status, 200);
}

/// A write is not sent again under a sign-in that landed meanwhile: the new
/// sign-in (maybe another user) did not make it.
#[tokio::test(flavor = "multi_thread")]
async fn a_sign_in_during_a_write_does_not_send_it_again() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/parties"))
        .and(header("authorization", bearer(1).as_str()))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(json!({ "errors": { "message": "x", "code": "UNAUTHENTICATED" } }))
                .set_delay(Duration::from_millis(500)),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/parties"))
        .and(header("authorization", bearer(2).as_str()))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({ "data": {} })))
        .mount(&server)
        .await;
    let fx = Arc::new(fixture(&server.uri()));

    let call = {
        let fx = fx.clone();
        tokio::spawn(async move {
            fx.call(json!({ "method": "POST", "path": "/api/v1/parties",
                "body": { "kind": "json", "value": { "name": "Acme" } } }))
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(150)).await;
    fx.client.session().sign_in(&tokens(2)).await.unwrap();

    let error = call.await.unwrap().unwrap_err();
    assert_eq!(error.code, "UNAUTHENTICATED");
    let sent = server.received_requests().await.unwrap();
    let posts = sent
        .iter()
        .filter(|r| r.url.path() == "/api/v1/parties")
        .count();
    assert_eq!(posts, 1);
}

/// Without a new sign-in a second 401 stays the answer: no extra send.
#[tokio::test(flavor = "multi_thread")]
async fn a_rejected_session_is_not_retried() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/parties"))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(json!({ "errors": { "message": "x", "code": "UNAUTHENTICATED" } })),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/device/refresh"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": {
            "token": access(3),
            "expires_at": "2026-10-27T10:15:00+03:00",
            "refresh_token": format!("refresh-3-{PAD}"),
            "refresh_expires_at": "2026-11-26T09:15:00+03:00"
        } })))
        .mount(&server)
        .await;
    let fx = fixture(&server.uri());
    let before = fx.store.load_record(PROFILE).unwrap().generation;

    let error = fx
        .call(json!({ "method": "GET", "path": "/api/v1/parties" }))
        .await
        .unwrap_err();
    assert_eq!(error.code, "UNAUTHENTICATED");
    let sent = server.received_requests().await.unwrap();
    let gets = sent
        .iter()
        .filter(|r| r.url.path() == "/api/v1/parties")
        .count();
    assert_eq!(gets, 2, "first send and the one retry after refresh");
    assert_eq!(fx.store.load_record(PROFILE).unwrap().generation, before);
}

// ------------------------------------------------- a write the server never got

fn party_post() -> Value {
    json!({ "method": "POST", "path": "/api/v1/parties",
        "headers": [["Idempotency-Key", "0192f5a0-0000-7000-8000-0000000000aa"]],
        "body": { "kind": "json", "value": { "id": ID, "name": "Acme" } } })
}

fn draft_answer() -> Option<Value> {
    Some(json!({ "data": { "id": ID }, "meta": { "offline": { "pending": true } } }))
}

fn is_create_draft(plans: &[LocalPlan]) -> bool {
    matches!(
        plans,
        [LocalPlan::Write {
            op: keystone_sync::wire::MutationOp::Create,
            ..
        }]
    )
}

/// The profile still counts as online (nothing failed yet), the server is
/// gone and the connection is refused: the write never left this device,
/// so it becomes the draft it would be offline, and the profile is offline
/// from now on.
#[tokio::test(flavor = "multi_thread")]
async fn the_first_write_after_the_server_went_away_becomes_a_draft() {
    let fx = fixture_with_engine(&dead_url().await);
    assert!(fx.connectivity.online(PROFILE, Some(false), Instant::now()));
    let local = FakeLocal::new(LocalCopy::Complete, draft_answer());
    let answer = fx.call_with(local.clone(), party_post()).await.unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    assert_eq!(answer.json().unwrap()["meta"]["offline"]["pending"], true);
    assert!(is_create_draft(&local.plans()), "{:?}", local.plans());
    assert!(!fx.connectivity.online(PROFILE, Some(false), Instant::now()));

    // The next write takes the offline way at once.
    fx.call_with(local.clone(), party_post()).await.unwrap();
    assert_eq!(local.plans().len(), 2);
}

/// A host that does not resolve never got the request either.
#[tokio::test(flavor = "multi_thread")]
async fn a_write_to_an_unknown_host_becomes_a_draft() {
    let fx = fixture_with_engine("https://keystone-desktop-test.invalid");
    let local = FakeLocal::new(LocalCopy::Complete, draft_answer());
    let answer = fx.call_with(local.clone(), party_post()).await.unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    assert!(is_create_draft(&local.plans()));
}

/// Connected, sent, no answer in time: the server may have applied it. It
/// is not queued (a draft would be sent a second time) and the profile
/// stays online.
#[tokio::test(flavor = "multi_thread")]
async fn a_write_whose_answer_did_not_come_is_not_queued() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/parties"))
        .respond_with(
            ResponseTemplate::new(201)
                .set_body_json(json!({ "data": { "id": ID } }))
                .set_delay(Duration::from_secs(3)),
        )
        .expect(1)
        .mount(&server)
        .await;
    let fx = fixture_waiting(&server.uri(), Duration::from_millis(500));
    let local = FakeLocal::new(LocalCopy::Complete, draft_answer());
    let error = fx.call_with(local.clone(), party_post()).await.unwrap_err();
    assert_eq!(error.code, "NETWORK_ERROR");
    assert!(local.plans().is_empty(), "{:?}", local.plans());
    assert!(fx.connectivity.online(PROFILE, Some(false), Instant::now()));
}

/// The server answered with an error: that is the answer, not a draft.
#[tokio::test(flavor = "multi_thread")]
async fn a_server_error_on_a_write_is_not_queued() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/api/v1/parties"))
        .respond_with(ResponseTemplate::new(503).set_body_json(json!({
            "errors": { "code": "SERVER_ERROR", "message": "down for maintenance" }
        })))
        .expect(1)
        .mount(&server)
        .await;
    let fx = fixture_with_engine(&server.uri());
    let local = FakeLocal::new(LocalCopy::Complete, draft_answer());
    let answer = fx.call_with(local.clone(), party_post()).await.unwrap();
    assert_eq!(
        (answer.status, answer.source),
        (503, ResponseSource::Network)
    );
    assert!(local.plans().is_empty());
    assert!(fx.connectivity.online(PROFILE, Some(false), Instant::now()));
}

/// A write that is online only, or a resource without offline writes,
/// keeps the network error: there is no draft to fall back to.
#[tokio::test(flavor = "multi_thread")]
async fn an_unsent_online_only_write_keeps_its_network_error() {
    let fx = fixture_with_engine(&dead_url().await);
    let local = FakeLocal::new(LocalCopy::Complete, draft_answer());
    let send = json!({ "method": "POST", "path": format!("/api/v1/sales-quotes/{ID}/send") });
    let error = fx.call_with(local.clone(), send.clone()).await.unwrap_err();
    assert_eq!(error.code, "NETWORK_ERROR");
    // Offline from now on: the same action is refused on this device.
    let refused = fx.call_with(local.clone(), send).await.unwrap();
    assert_eq!(
        (refused.status, refused.source),
        (503, ResponseSource::Local)
    );

    let fx = fixture_with_engine(&dead_url().await);
    let unmapped = json!({ "method": "POST", "path": "/api/v1/treasury-transfers",
        "body": { "kind": "json", "value": {} } });
    let error = fx.call_with(local.clone(), unmapped).await.unwrap_err();
    assert_eq!(error.code, "NETWORK_ERROR");
    assert!(local.plans().is_empty());
}

/// Without a local store there is no outbox: the error stays.
#[tokio::test(flavor = "multi_thread")]
async fn an_unsent_write_without_a_local_store_keeps_its_network_error() {
    let fx = fixture(&dead_url().await);
    let local = FakeLocal::new(LocalCopy::Complete, draft_answer());
    let error = fx.call_with(local.clone(), party_post()).await.unwrap_err();
    assert_eq!(error.code, "NETWORK_ERROR");
    assert!(local.plans().is_empty());
}

/// Reads that could not connect still take their local fallback.
#[tokio::test(flavor = "multi_thread")]
async fn an_unsent_read_still_takes_its_local_fallback() {
    let fx = fixture_with_engine(&dead_url().await);
    let local = FakeLocal::new(LocalCopy::Partial, Some(parties_page()));
    let answer = fx
        .call_with(
            local.clone(),
            json!({ "method": "GET", "path": "/api/v1/parties" }),
        )
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    assert!(matches!(
        local.plans().as_slice(),
        [LocalPlan::Read { stale: true, .. }]
    ));
}

#[test]
fn a_refused_certificate_has_its_own_code() {
    let error = CommandError::from(SyncError::CertificateInvalid(
        "the server certificate is not trusted: unknown issuer".into(),
    ));
    assert_eq!(error.code, "TLS_CERTIFICATE_INVALID");
    let network = CommandError::from(SyncError::NotSent("connection refused".into()));
    assert_eq!(network.code, "NETWORK_ERROR");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sign_in_during_a_delete_does_not_send_it_again() {
    let server = MockServer::start().await;
    Mock::given(method("DELETE"))
        .and(path("/api/v1/parties/1"))
        .and(header("authorization", bearer(1).as_str()))
        .respond_with(
            ResponseTemplate::new(401)
                .set_body_json(json!({ "errors": { "message": "x", "code": "UNAUTHENTICATED" } }))
                .set_delay(Duration::from_millis(500)),
        )
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/v1/parties/1"))
        .and(header("authorization", bearer(2).as_str()))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    let fx = Arc::new(fixture(&server.uri()));

    let call = {
        let fx = fx.clone();
        tokio::spawn(async move {
            fx.call(json!({ "method": "DELETE", "path": "/api/v1/parties/1" }))
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(150)).await;
    fx.client.session().sign_in(&tokens(2)).await.unwrap();

    assert_eq!(call.await.unwrap().unwrap_err().code, "UNAUTHENTICATED");
    let sent = server.received_requests().await.unwrap();
    assert_eq!(
        sent.iter()
            .filter(|r| r.url.path() == "/api/v1/parties/1")
            .count(),
        1
    );
}
