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
    let config = ApiConfig {
        base_url: base_url.to_owned(),
        company_id: COMPANY.parse().unwrap(),
        user_agent: "keystone-desktop-test".into(),
    };
    let options = ClientOptions {
        connect_timeout: Duration::from_secs(2),
        request_timeout: Duration::from_secs(20),
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
    plans: Mutex<Vec<LocalPlan>>,
}

impl FakeLocal {
    fn new(copy: LocalCopy, answer: Option<Value>) -> Arc<Self> {
        Arc::new(Self {
            copy,
            answer: answer.map(|body| envelope::local(200, body)),
            plans: Mutex::default(),
        })
    }

    fn plans(&self) -> Vec<LocalPlan> {
        self.plans.lock().unwrap().clone()
    }
}

impl LocalResolver for FakeLocal {
    fn local_copy(&self, _: &Engine, _: &ResourceName) -> CommandResult<LocalCopy> {
        Ok(self.copy)
    }

    fn resolve(&self, _: &Engine, plan: &LocalPlan, _: &ApiCall) -> CommandResult<LocalOutcome> {
        self.plans.lock().unwrap().push(plan.clone());
        Ok(match &self.answer {
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

/// A loopback base URL nothing listens on (a port bound and let go;
/// wiremock keeps its own servers alive in a pool).
async fn dead_url() -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    format!("http://127.0.0.1:{port}")
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
    for request in [
        json!({ "method": "GET", "path": "/api/v1/parties" }),
        json!({ "method": "GET", "path": "/api/v1/reports/trial-balance" }),
        json!({ "method": "POST", "path": "/api/v1/parties",
            "body": { "kind": "json", "value": { "name": "Acme" } } }),
    ] {
        let answer = fx.call(request.clone()).await.unwrap();
        assert_eq!(answer.status, 503, "{request}");
        assert_eq!(answer.source, ResponseSource::Local);
        assert_eq!(
            answer.json().unwrap(),
            &envelope::error("OFFLINE_UNAVAILABLE", Refusal::Offline.message(), None)
        );
    }
    assert_eq!(received(&server).await, 0);
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
