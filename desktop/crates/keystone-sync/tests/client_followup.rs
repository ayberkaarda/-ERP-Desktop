//! Token work that must survive its caller and stay bound to the sign-in:
//! a refresh or password change whose caller is dropped still stores the
//! new pair, `Session::forget_tokens` drops only the tokens of its
//! generation, `HttpClient::change_password` keeps the generation, and an
//! oversized proxy answer is `PAYLOAD_TOO_LARGE` also when streamed.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;

use keystone_sync::SyncError;
use keystone_sync::auth::{MemoryTokenStore, Secret, Session, StoredTokens, TokenStore};
use keystone_sync::client::{
    ApiConfig, ClientOptions, DeviceAuthApi, HttpClient, PROXY_BODY_LIMIT, ProxyMethod,
    ProxyRequest, SyncApi,
};
use keystone_sync::wire::{DeviceRefreshRequest, Timestamp};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PROFILE: &str = "followup";
const PAD: &str = "0123456789abcdef0123456789abcdef";
const MANIFEST: &str = "/api/v1/sync/manifest";
const REFRESH: &str = "/api/v1/auth/device/refresh";
const PASSWORD: &str = "/api/v1/auth/password/change";

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

fn client_on(base_url: String, store: &Arc<MemoryTokenStore>) -> HttpClient {
    HttpClient::new(
        &ApiConfig {
            base_url,
            company_id: Uuid::nil(),
            user_agent: "keystone-desktop-test/0.1".into(),
        },
        PROFILE,
        Arc::clone(store),
        &ClientOptions {
            connect_timeout: Duration::from_secs(2),
            request_timeout: Duration::from_secs(10),
            allow_http_localhost: true,
        },
    )
    .expect("client")
}

fn client(server: &MockServer, store: &Arc<MemoryTokenStore>) -> HttpClient {
    client_on(server.uri(), store)
}

fn signed_in(n: u8) -> Arc<MemoryTokenStore> {
    Arc::new(MemoryTokenStore::signed_in(PROFILE, &tokens(n)))
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

/// Waits (bounded) until the stored pair is `tokens(n)`.
async fn eventually_stored(store: &MemoryTokenStore, n: u8) {
    for _ in 0..100 {
        if store.load(PROFILE).unwrap() == Some(tokens(n)) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!(
        "pair {n} never stored; store holds {:?}",
        store.load(PROFILE).unwrap()
    );
}

async fn slow_refresh(server: &MockServer, n: u8) {
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_body(n))
                .set_delay(Duration::from_millis(400)),
        )
        .expect(1)
        .mount(server)
        .await;
}

// ---------------------------------------------------------------- forget_tokens

#[tokio::test]
async fn forget_tokens_drops_only_the_tokens_of_its_generation() {
    let store = signed_in(1);
    let session = Session::shared(PROFILE, store.clone());
    let before = store.load_record(PROFILE).unwrap();

    assert!(!session.forget_tokens(before.generation + 1).await.unwrap());
    assert_eq!(store.load(PROFILE).unwrap(), Some(tokens(1)));

    assert!(session.forget_tokens(before.generation).await.unwrap());
    let after = store.load_record(PROFILE).unwrap();
    assert!(after.tokens.is_none());
    assert_eq!(after.generation, before.generation, "no new generation");
    assert!(!after.deactivated, "not a deactivation");
}

#[tokio::test]
async fn a_late_forget_keeps_a_newer_sign_in() {
    let store = signed_in(1);
    let session = Session::shared(PROFILE, store.clone());
    let old = store.load_record(PROFILE).unwrap().generation;
    let new = session.sign_in(&tokens(2)).await.unwrap();
    assert!(!session.forget_tokens(old).await.unwrap());
    let record = store.load_record(PROFILE).unwrap();
    assert_eq!(
        (record.tokens, record.generation),
        (Some(tokens(2)), new),
        "the revocation of an older sign-in changes nothing"
    );
}

#[tokio::test]
async fn after_forget_tokens_calls_ask_for_sign_in_without_sending() {
    let server = MockServer::start().await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let generation = store.load_record(PROFILE).unwrap().generation;
    assert!(client.session().forget_tokens(generation).await.unwrap());
    let error = client.manifest().await.unwrap_err();
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert!(server.received_requests().await.unwrap().is_empty());
}

// ---------------------------------------------------------------- cancel-safe refresh

#[tokio::test]
async fn a_refresh_whose_caller_is_dropped_still_stores_the_new_pair() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .and(header("authorization", bearer(1)))
        .respond_with(ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "x")))
        .mount(&server)
        .await;
    slow_refresh(&server, 2).await;
    let store = signed_in(1);
    let client = client(&server, &store);

    // The caller gives up while the refresh is on its way (a realtime
    // authorize timeout, a profile switch aborting the loop).
    let cut = tokio::time::timeout(Duration::from_millis(150), client.manifest()).await;
    assert!(cut.is_err(), "the call was cut short");
    eventually_stored(&store, 2).await;
    assert_eq!(count(&server, REFRESH).await, 1);
}

#[tokio::test]
async fn an_explicit_refresh_whose_caller_is_dropped_still_stores_the_new_pair() {
    let server = MockServer::start().await;
    slow_refresh(&server, 2).await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let request = DeviceRefreshRequest {
        refresh_token: refresh(1),
    };
    let cut = tokio::time::timeout(Duration::from_millis(150), client.refresh(&request)).await;
    assert!(cut.is_err(), "the call was cut short");
    eventually_stored(&store, 2).await;
}

// ---------------------------------------------------------------- change_password

fn new_password() -> Secret {
    Secret::new("N3w-Passw0rd!long")
}

fn old_password() -> Secret {
    Secret::new("0ld-Passw0rd!long")
}

#[tokio::test]
async fn a_password_change_stores_the_reissued_pair_in_the_same_generation() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(PASSWORD))
        .and(header("authorization", bearer(1)))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(2)))
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let before = store.load_record(PROFILE).unwrap();

    assert!(
        client
            .change_password(&old_password(), &new_password())
            .await
            .unwrap()
    );
    let after = store.load_record(PROFILE).unwrap();
    assert_eq!(after.tokens, Some(tokens(2)));
    assert_eq!(after.generation, before.generation, "not a new sign-in");

    let sent = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&sent[0].body).unwrap();
    assert_eq!(
        body,
        json!({
            "current_password": "0ld-Passw0rd!long",
            "password": "N3w-Passw0rd!long",
            "password_confirmation": "N3w-Passw0rd!long",
        })
    );
}

#[tokio::test]
async fn a_password_change_without_a_new_pair_keeps_the_tokens() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(PASSWORD))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    assert!(
        !client
            .change_password(&old_password(), &new_password())
            .await
            .unwrap()
    );
    assert_eq!(store.load(PROFILE).unwrap(), Some(tokens(1)));
}

#[tokio::test]
async fn a_refused_password_change_keeps_the_tokens_and_its_field_errors() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(PASSWORD))
        .respond_with(ResponseTemplate::new(422).set_body_json(json!({ "errors": {
            "message": "The given data was invalid.",
            "code": "VALIDATION_ERROR",
            "fields": { "current_password": ["The current password is incorrect."] }
        }})))
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let error = client
        .change_password(&old_password(), &new_password())
        .await
        .unwrap_err();
    assert_eq!(error.code(), "VALIDATION_ERROR");
    match &error {
        SyncError::Api { fields, .. } => assert!(fields.contains_key("current_password")),
        other => panic!("{other:?}"),
    }
    let text = format!("{error} {error:?}");
    assert!(!text.contains("Passw0rd"), "{text}");
    assert_eq!(store.load(PROFILE).unwrap(), Some(tokens(1)));
}

#[tokio::test]
async fn an_expired_access_token_is_refreshed_once_before_the_password_change() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(PASSWORD))
        .and(header("authorization", bearer(1)))
        .respond_with(ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "x")))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(2)))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(PASSWORD))
        .and(header("authorization", bearer(2)))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(3)))
        .expect(1)
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let generation = store.load_record(PROFILE).unwrap().generation;
    assert!(
        client
            .change_password(&old_password(), &new_password())
            .await
            .unwrap()
    );
    let record = store.load_record(PROFILE).unwrap();
    assert_eq!(
        (record.tokens, record.generation),
        (Some(tokens(3)), generation)
    );
}

#[tokio::test]
async fn a_password_change_is_not_sent_without_a_usable_sign_in() {
    let server = MockServer::start().await;
    let empty = Arc::new(MemoryTokenStore::default());
    let error = client(&server, &empty)
        .change_password(&old_password(), &new_password())
        .await
        .unwrap_err();
    assert_eq!(error.code(), "UNAUTHENTICATED");

    // A deactivated profile is refused too.
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(
            ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "off")),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    client.manifest().await.unwrap_err();
    assert!(store.load_record(PROFILE).unwrap().deactivated);
    let error = client
        .change_password(&old_password(), &new_password())
        .await
        .unwrap_err();
    assert_eq!(error.code(), "USER_DEACTIVATED");
    assert_eq!(count(&server, PASSWORD).await, 0);
}

#[tokio::test]
async fn a_password_change_whose_caller_is_dropped_still_stores_the_new_pair() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(PASSWORD))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_body(2))
                .set_delay(Duration::from_millis(400)),
        )
        .mount(&server)
        .await;
    let store = signed_in(1);
    let client = client(&server, &store);
    let (old, new) = (old_password(), new_password());
    let cut = tokio::time::timeout(
        Duration::from_millis(150),
        client.change_password(&old, &new),
    )
    .await;
    assert!(cut.is_err(), "the call was cut short");
    eventually_stored(&store, 2).await;
}

// ---------------------------------------------------------------- body limit while streaming

/// One-shot HTTP/1.1 server: answers the first request with a chunked
/// 200 body of `total` bytes (no `Content-Length`).
fn chunked_server(total: usize) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    std::thread::spawn(move || {
        let Ok((stream, _)) = listener.accept() else {
            return;
        };
        let mut reader = BufReader::new(stream.try_clone().expect("clone"));
        let mut line = String::new();
        while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
            line.clear();
        }
        let mut out = stream;
        let _ = out.write_all(
            b"HTTP/1.1 200 OK\r\ncontent-type: application/octet-stream\r\ntransfer-encoding: chunked\r\n\r\n",
        );
        let chunk = vec![b'x'; 1024 * 1024];
        let mut left = total;
        while left > 0 {
            let n = left.min(chunk.len());
            if out.write_all(format!("{n:x}\r\n").as_bytes()).is_err()
                || out.write_all(&chunk[..n]).is_err()
                || out.write_all(b"\r\n").is_err()
            {
                return;
            }
            left -= n;
        }
        let _ = out.write_all(b"0\r\n\r\n");
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn a_streamed_answer_over_the_limit_is_payload_too_large() {
    let base = chunked_server(PROXY_BODY_LIMIT + 1024 * 1024);
    let store = signed_in(1);
    let client = client_on(base, &store);
    let error = client
        .proxy(&ProxyRequest {
            method: ProxyMethod::Get,
            path: "/api/v1/files/big".into(),
            query: vec![],
            headers: vec![],
            body: None,
        })
        .await
        .unwrap_err();
    assert!(matches!(error, SyncError::PayloadTooLarge(_)), "{error:?}");
    assert_eq!(error.code(), "PAYLOAD_TOO_LARGE");
}
