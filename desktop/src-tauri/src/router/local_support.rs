//! Test setup of the local answers: a wiremock server speaking the sync
//! protocol, an engine over an encrypted temp store that went through one
//! real pull, and `api_request` without Tauri.

use std::sync::Arc;
use std::time::{Duration, Instant};

use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens};
use keystone_sync::client::{ApiConfig, ClientOptions, HttpClient};
use keystone_sync::engine::{SyncEngine, Trigger};
use keystone_sync::outbox::OutboxEntry;
use keystone_sync::store::{DbKey, Store, offline_manifest};
use keystone_sync::wire::{ResourceName, Timestamp};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

use super::decide::OFFLINE_MANIFEST;
use super::{Connectivity, LocalResolver, local_resolver};
use crate::commands::{CommandResult, api};
use crate::dto::api::{ApiRequestDto, ApiResponseDto};
use crate::state::{ActiveProfile, AppState, Engine};

pub const PROFILE: &str = "local-answers";
const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";
const USER: &str = "0192f5a0-0000-7000-8000-00000000000a";

/// Rows the first pull brings, per resource.
pub type Seed = Vec<(&'static str, Vec<Value>)>;

pub struct Fixture {
    pub server: MockServer,
    pub state: AppState,
    pub connectivity: Connectivity,
    pub engine: Arc<Engine>,
    pub store: Arc<Store>,
    _dir: tempfile::TempDir,
}

pub fn tokens(n: u8) -> StoredTokens {
    StoredTokens {
        access_token: Secret::new(format!("access-{n}-0123456789abcdef0123456789abcdef")),
        access_expires_at: Timestamp("2026-10-27T10:15:00+03:00".into()),
        refresh_token: Secret::new(format!("refresh-{n}-0123456789abcdef0123456789abcdef")),
        refresh_expires_at: Timestamp("2026-11-26T09:15:00+03:00".into()),
    }
}

pub fn row(id: Uuid, version: u64, fields: Value) -> Value {
    let mut row = fields.as_object().cloned().unwrap_or_default();
    row.insert("id".into(), json!(id));
    row.insert("version".into(), json!(version));
    Value::Object(row)
}

/// The sync manifest of the compiled offline manifest.
fn sync_manifest(version: u32) -> Value {
    let specs = offline_manifest(OFFLINE_MANIFEST).unwrap().specs;
    let resources: Vec<Value> = specs
        .iter()
        .map(|spec| {
            json!({
                "resource": spec.resource,
                "scope": "company",
                "visibility_generation": 0,
                "read": spec.read,
                "source": spec.source,
                "window_days": null,
                "writable": [],
            })
        })
        .collect();
    json!({
        "data": {
            "schema_version": 1,
            "min_schema_version": 1,
            "offline_manifest_version": version,
            "server_time": "2026-10-26T09:15:00+03:00",
            "company_id": COMPANY,
            "user_id": USER,
            "device_id": "0192f5a0-0000-7000-8000-0000000000d1",
            "permissions": [],
            "resources": resources,
            "online_only": [],
            "limits": {
                "pull_resources_max": 100,
                "pull_page_default": 200,
                "pull_page_max": 1000,
                "push_batch_max": 100,
                "tombstone_retention_days": 90,
                "idempotency_retention_days": 7,
            },
        },
        "meta": {},
    })
}

/// Pull answer: the seeded rows on the first download of a resource. Those
/// in `paging` report `has_more` and then fail, so they stay partial.
fn pull(seed: Seed, paging: &'static [&'static str]) -> impl Fn(&Request) -> ResponseTemplate {
    move |request: &Request| {
        let body: Value = serde_json::from_slice(&request.body).unwrap();
        let mut pages = Vec::new();
        for entry in body["resources"].as_array().unwrap() {
            let resource = entry["resource"].as_str().unwrap();
            let first = entry["cursor"].is_null();
            if !first && paging.contains(&resource) {
                return ResponseTemplate::new(500).set_body_json(json!({
                    "errors": {"message": "x", "code": "SERVER_ERROR"}
                }));
            }
            let rows = seed
                .iter()
                .find(|(name, _)| *name == resource && first)
                .map_or_else(Vec::new, |(_, rows)| rows.clone());
            pages.push(json!({
                "resource": resource,
                "rows": rows,
                "tombstones": [],
                "next_cursor": {"txid": "1000", "after_id": null, "gen": 0, "session": null},
                "has_more": paging.contains(&resource),
                "reset": false,
            }));
        }
        ResponseTemplate::new(200).set_body_json(json!({
            "data": {
                "horizon": "1000",
                "server_time": "2026-10-26T09:15:00+03:00",
                "resources": pages,
            },
            "meta": {},
        }))
    }
}

/// Local data verified by one pass that brought `seed`.
pub async fn fixture(seed: Seed) -> Fixture {
    fixture_with(seed, &[], 2).await
}

/// [`fixture`] with resources still `paging` and the server's
/// `offline_manifest_version`.
pub async fn fixture_with(seed: Seed, paging: &'static [&'static str], version: u32) -> Fixture {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/sync/manifest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(sync_manifest(version)))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/sync/pull"))
        .respond_with(pull(seed, paging))
        .mount(&server)
        .await;

    let tokens = Arc::new(MemoryTokenStore::signed_in(PROFILE, &self::tokens(1)));
    let client = || {
        HttpClient::new(
            &ApiConfig {
                base_url: server.uri(),
                company_id: COMPANY.parse().unwrap(),
                user_agent: "keystone-desktop-test".into(),
            },
            PROFILE,
            tokens.clone(),
            &ClientOptions {
                connect_timeout: Duration::from_secs(2),
                request_timeout: Duration::from_secs(20),
                allow_http_localhost: true,
            },
        )
        .unwrap()
    };
    let dir = tempfile::tempdir().unwrap();
    let store =
        Arc::new(Store::open(dir.path().join("p.db"), &DbKey::from_bytes([7; 32])).unwrap());
    let engine = Arc::new(
        SyncEngine::new(client(), store.clone())
            .with_offline_manifest(offline_manifest(OFFLINE_MANIFEST).unwrap()),
    );
    let run = engine.run_once(Trigger::Startup).await;
    assert_eq!(run.is_ok(), paging.is_empty(), "{run:?}");

    let state = AppState::default();
    state.activate(ActiveProfile {
        id: PROFILE.into(),
        client: Arc::new(client()),
        engine: Some(engine.clone()),
    });
    Fixture {
        server,
        state,
        connectivity: Connectivity::default(),
        engine,
        store,
        _dir: dir,
    }
}

impl Fixture {
    pub fn go_offline(&self) {
        self.connectivity.observe(PROFILE, false, Instant::now());
    }

    /// `api_request` with the resolver the command uses.
    pub async fn call(&self, request: Value) -> ApiResponseDto {
        self.call_with(local_resolver(), request).await
    }

    pub async fn call_with(
        &self,
        resolver: Arc<dyn LocalResolver>,
        request: Value,
    ) -> ApiResponseDto {
        self.try_call(resolver, request).await.unwrap()
    }

    async fn try_call(
        &self,
        resolver: Arc<dyn LocalResolver>,
        request: Value,
    ) -> CommandResult<ApiResponseDto> {
        let request: ApiRequestDto = serde_json::from_value(request).unwrap();
        api::handle(&self.state, &self.connectivity, resolver, request).await
    }

    pub fn outbox(&self) -> Vec<OutboxEntry> {
        self.engine.outbox_entries().unwrap()
    }

    /// Replaces the sign-in; the local data is not verified for the new one.
    pub async fn sign_in_again(&self) {
        let session = self.state.client().unwrap().session().clone();
        session.sign_in(&tokens(2)).await.unwrap();
    }

    pub async fn received(&self, wanted: &str) -> usize {
        self.server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|r| r.url.path() == wanted)
            .count()
    }

    /// Every pushed mutation is answered `applied`, its payload as the row.
    pub async fn mount_push_applied(&self) {
        Mock::given(method("POST"))
            .and(path("/api/v1/sync/push"))
            .respond_with(|request: &Request| {
                let body: Value = serde_json::from_slice(&request.body).unwrap();
                let results: Vec<Value> = body["mutations"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|m| {
                        let id = m["id"].as_str().unwrap().parse().unwrap();
                        json!({
                            "idempotency_key": m["idempotency_key"],
                            "resource": m["resource"],
                            "id": m["id"],
                            "status": "applied",
                            "replayed": false,
                            "version": 1,
                            "data": row(id, 1, m["payload"].clone()),
                        })
                    })
                    .collect();
                ResponseTemplate::new(200)
                    .set_body_json(json!({"data": {"results": results}, "meta": {}}))
            })
            .mount(&self.server)
            .await;
    }

    /// Mutations the server received, in order.
    pub async fn pushed(&self) -> Vec<Value> {
        self.server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|r| r.url.path() == "/api/v1/sync/push")
            .flat_map(|r| {
                let body: Value = serde_json::from_slice(&r.body).unwrap();
                body["mutations"].as_array().cloned().unwrap_or_default()
            })
            .collect()
    }
}

pub fn name(resource: &str) -> ResourceName {
    ResourceName(resource.into())
}

pub fn get(path: &str, query: Value) -> Value {
    json!({ "method": "GET", "path": path, "query": query })
}

/// A JSON write, with an `Idempotency-Key` when given.
pub fn send(method: &str, path: &str, key: Option<&str>, body: Option<Value>) -> Value {
    let mut request = json!({ "method": method, "path": path });
    if let Some(key) = key {
        request["headers"] = json!([["Idempotency-Key", key]]);
    }
    if let Some(body) = body {
        request["body"] = json!({ "kind": "json", "value": body });
    }
    request
}

pub fn code(answer: &ApiResponseDto) -> &str {
    answer.json().unwrap()["errors"]["code"].as_str().unwrap()
}

pub fn ids(answer: &ApiResponseDto) -> Vec<Uuid> {
    answer.json().unwrap()["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["id"].as_str().unwrap().parse().unwrap())
        .collect()
}
