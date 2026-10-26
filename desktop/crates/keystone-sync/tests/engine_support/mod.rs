//! Shared setup for the `engine_*` tests: a wiremock server, an encrypted
//! store in a temp dir, a signed-in memory token store and the engine over
//! the real `HttpClient`.
#![allow(dead_code)]

use std::sync::Arc;
use std::time::Duration;

use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore};
use keystone_sync::client::{ApiConfig, ClientOptions, HttpClient};
use keystone_sync::engine::SyncEngine;
use keystone_sync::outbox::NewMutation;
use keystone_sync::store::{DbKey, Store};
use keystone_sync::wire::{MutationOp, ResourceName, Timestamp};
use serde_json::{Map, Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

pub const PROFILE: &str = "engine-test";
pub const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";
pub const USER_A: &str = "0192f5a0-0000-7000-8000-00000000000a";
pub const USER_B: &str = "0192f5a0-0000-7000-8000-00000000000b";

pub type Engine = SyncEngine<HttpClient<MemoryTokenStore>>;

/// Test setup over a token store of type `T`.
pub struct EnvOf<T> {
    pub server: MockServer,
    pub dir: tempfile::TempDir,
    pub store: Arc<Store>,
    pub tokens: Arc<T>,
    pub engine: Arc<SyncEngine<HttpClient<T>>>,
}

pub type Env = EnvOf<MemoryTokenStore>;

pub fn tokens(n: u8) -> StoredTokens {
    StoredTokens {
        access_token: Secret::new(format!("access-{n}-0123456789abcdef")),
        access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
        refresh_token: Secret::new(format!("refresh-{n}-0123456789abcdef")),
        refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
    }
}

pub async fn env() -> Env {
    env_with(Duration::from_secs(10)).await
}

/// `request_timeout` bounds every HTTP call (lost-response tests).
pub async fn env_with(request_timeout: Duration) -> Env {
    env_on(Arc::new(MemoryTokenStore::default()), request_timeout).await
}

/// Same setup over `tokens`, signed in here with `tokens(1)`.
pub async fn env_on<T: TokenStore + 'static>(
    tokens: Arc<T>,
    request_timeout: Duration,
) -> EnvOf<T> {
    let server = MockServer::start().await;
    let dir = tempfile::tempdir().expect("tempdir");
    let store =
        Arc::new(Store::open(dir.path().join("engine.db"), &DbKey::from_bytes([42; 32])).unwrap());
    sign_in_as(tokens.as_ref(), 1).await;
    let client = HttpClient::new(
        &ApiConfig {
            base_url: server.uri(),
            company_id: Uuid::parse_str(COMPANY).unwrap(),
            user_agent: "keystone-desktop-test".into(),
        },
        PROFILE,
        tokens.clone(),
        &ClientOptions {
            connect_timeout: Duration::from_secs(2),
            request_timeout,
            allow_http_localhost: true,
        },
    )
    .unwrap();
    let dyn_tokens: Arc<dyn TokenStore> = tokens.clone();
    let engine = Arc::new(SyncEngine::new(client, store.clone(), dyn_tokens, PROFILE));
    EnvOf {
        server,
        dir,
        store,
        tokens,
        engine,
    }
}

pub fn name(resource: &str) -> ResourceName {
    ResourceName(resource.into())
}

/// One manifest resource: (name, visibility generation, source).
pub fn resource(name: &str, generation: u64) -> Value {
    json!({
        "resource": name,
        "scope": "company",
        "visibility_generation": generation,
        "read": "local-first",
        "source": "pull",
        "window_days": null,
        "writable": ["create", "update", "delete"],
    })
}

pub fn manifest(user: &str, resources: Vec<Value>, page_default: u32, push_max: u32) -> Value {
    json!({
        "data": {
            "schema_version": 1,
            "min_schema_version": 1,
            "offline_manifest_version": 1,
            "server_time": "2026-10-26T09:15:00+03:00",
            "company_id": COMPANY,
            "user_id": user,
            "device_id": "0192f5a0-0000-7000-8000-0000000000d1",
            "permissions": [],
            "resources": resources,
            "online_only": [],
            "limits": {
                "pull_resources_max": 10,
                "pull_page_default": page_default,
                "pull_page_max": 1000,
                "push_batch_max": push_max,
                "tombstone_retention_days": 90,
                "idempotency_retention_days": 7,
            },
        },
        "meta": {},
    })
}

/// Manifest of user A with `resources` at generation 0.
pub fn simple_manifest(resources: &[&str]) -> Value {
    manifest(
        USER_A,
        resources.iter().map(|r| resource(r, 0)).collect(),
        200,
        100,
    )
}

pub async fn mount_manifest(server: &MockServer, body: Value) {
    Mock::given(method("GET"))
        .and(path("/api/v1/sync/manifest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .mount(server)
        .await;
}

pub fn cursor(txid: u64, after: Option<&str>, generation: u64, session: Option<&str>) -> Value {
    json!({"txid": txid.to_string(), "after_id": after, "gen": generation, "session": session})
}

pub fn row(id: &str, version: u64, fields: Value) -> Value {
    let mut object = fields.as_object().cloned().unwrap_or_default();
    object.insert("id".into(), json!(id));
    object.insert("version".into(), json!(version));
    Value::Object(object)
}

pub fn tombstone(resource: &str, id: &str, txid: u64) -> Value {
    json!({
        "resource": resource,
        "id": id,
        "sync_txid": txid.to_string(),
        "deleted_at": "2026-10-26T09:00:00+03:00",
        "reason": "deleted",
    })
}

pub fn page(
    resource: &str,
    rows: Vec<Value>,
    tombstones: Vec<Value>,
    next: Value,
    has_more: bool,
) -> Value {
    json!({
        "resource": resource,
        "rows": rows,
        "tombstones": tombstones,
        "next_cursor": next,
        "has_more": has_more,
        "reset": false,
    })
}

pub fn reset_page(
    resource: &str,
    rows: Vec<Value>,
    next: Value,
    has_more: bool,
    reason: &str,
) -> Value {
    json!({
        "resource": resource,
        "rows": rows,
        "tombstones": [],
        "next_cursor": next,
        "has_more": has_more,
        "reset": true,
        "reset_reason": reason,
    })
}

pub fn pull_response(pages: Vec<Value>) -> Value {
    json!({
        "data": {
            "horizon": "1000",
            "server_time": "2026-10-26T09:15:00+03:00",
            "resources": pages,
        },
        "meta": {},
    })
}

pub fn body(request: &Request) -> Value {
    serde_json::from_slice(&request.body).expect("json body")
}

/// Answers every pull with an empty, final page per requested resource.
pub fn empty_pull(request: &Request) -> ResponseTemplate {
    let pages: Vec<Value> = body(request)["resources"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|r| {
            page(
                r["resource"].as_str().unwrap_or_default(),
                vec![],
                vec![],
                cursor(1000, None, 0, None),
                false,
            )
        })
        .collect();
    ResponseTemplate::new(200).set_body_json(pull_response(pages))
}

pub async fn mount_empty_pull(server: &MockServer) {
    Mock::given(method("POST"))
        .and(path("/api/v1/sync/pull"))
        .respond_with(empty_pull)
        .mount(server)
        .await;
}

/// Bodies of the requests received on `p`, in order.
pub async fn bodies(server: &MockServer, p: &str) -> Vec<Value> {
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .iter()
        .filter(|r| r.url.path() == p)
        .map(body)
        .collect()
}

pub async fn hits(server: &MockServer, p: &str) -> usize {
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .iter()
        .filter(|r| r.url.path() == p)
        .count()
}

pub fn draft(op: MutationOp, resource: &str, id: Uuid, payload: Value) -> NewMutation {
    let payload: Map<String, Value> = payload.as_object().cloned().unwrap_or_default();
    NewMutation {
        op,
        action: None,
        resource: name(resource),
        id,
        parent_id: None,
        base_version: (op != MutationOp::Create).then_some(1),
        payload,
        depends_on: vec![],
        occurred_at: Timestamp("2026-10-26T09:10:00+03:00".into()),
        resolution: None,
    }
}

pub fn error_body(code: &str, message: &str) -> Value {
    json!({"errors": {"message": message, "code": code}})
}

/// Answers `applied` for every pushed mutation, echoing its payload as the row.
pub fn apply_all(request: &Request) -> ResponseTemplate {
    let results: Vec<Value> = body(request)["mutations"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            json!({"idempotency_key": m["idempotency_key"], "resource": m["resource"],
                   "id": m["id"], "status": "applied", "replayed": false, "version": 1,
                   "data": row(m["id"].as_str().unwrap_or_default(), 1, m["payload"].clone())})
        })
        .collect();
    ResponseTemplate::new(200).set_body_json(json!({"data": {"results": results}, "meta": {}}))
}

/// `Authorization` header of a received request.
pub fn bearer_of(request: &Request) -> Option<String> {
    request
        .headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

/// Writes a server row straight into the mirror.
pub fn put_row(store: &Store, resource: &str, id: &str, fields: Value) {
    use keystone_sync::store::MirrorStore;
    let row: keystone_sync::wire::ResourceRow =
        serde_json::from_value(row(id, 1, fields)).expect("row");
    store.put_row(&name(resource), &row).expect("put_row");
}

/// Outbox entries read straight from the store (the test owns it), also
/// when the engine refuses access.
pub fn outbox_list(store: &Arc<Store>) -> Vec<keystone_sync::outbox::OutboxEntry> {
    keystone_sync::outbox::Outbox::new(store.clone())
        .list()
        .expect("outbox list")
}

/// Conflict Inbox straight on the store.
pub fn inbox(store: &Arc<Store>) -> keystone_sync::conflicts::ConflictStore {
    keystone_sync::conflicts::ConflictStore::new(store.clone())
}

/// Signs `tokens(n)` in through the session (the only way in).
pub async fn sign_in_as<T: TokenStore + ?Sized>(store: &T, n: u8) -> u64 {
    keystone_sync::auth::Session::shared(PROFILE, store)
        .sign_in(store, &tokens(n))
        .await
        .expect("sign in")
}

/// Same from synchronous code (a wiremock responder): on its own thread
/// and runtime, waiting for it.
pub fn sign_in_blocking<T: TokenStore + 'static>(store: Arc<T>, n: u8) -> u64 {
    std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("runtime")
            .block_on(sign_in_as(store.as_ref(), n))
    })
    .join()
    .expect("sign-in thread")
}
