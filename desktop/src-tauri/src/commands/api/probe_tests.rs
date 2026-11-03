//! A request answered offline asks the engine to look again: a running
//! sync loop over a server that can be switched off (no answer in time)
//! and on.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens};
use keystone_sync::client::{ApiConfig, ClientOptions, HttpClient};
use keystone_sync::engine::{SyncEngine, SyncState, sync_loop};
use keystone_sync::store::{DbKey, Store};
use keystone_sync::wire::Timestamp;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

use super::*;
use crate::dto::api::ResponseSource;
use crate::router::NoLocalCopy;
use crate::state::ActiveProfile;

const PROFILE: &str = "api-probe";
const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";
const REPORT: &str = "/api/v1/reports/trial-balance";
/// The clients give up on an answer after this.
const ANSWER_WAIT: Duration = Duration::from_millis(400);

/// Answers `body` while `up`; while down, too late for the clients.
struct Switch {
    up: Arc<AtomicBool>,
    body: Value,
}

impl Respond for Switch {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        let answer = ResponseTemplate::new(200).set_body_json(self.body.clone());
        if self.up.load(Ordering::SeqCst) {
            answer
        } else {
            answer.set_delay(Duration::from_secs(3))
        }
    }
}

fn manifest() -> Value {
    let compiled: Value = serde_json::from_str(crate::router::decide::OFFLINE_MANIFEST).unwrap();
    json!({
        "data": {
            "schema_version": 1, "min_schema_version": 1,
            "offline_manifest_version": compiled["manifest_version"],
            "server_time": "2026-10-26T09:15:00+03:00",
            "company_id": COMPANY, "user_id": "0192f5a0-0000-7000-8000-00000000000a",
            "device_id": null, "permissions": [], "resources": [], "online_only": [],
            "limits": {
                "pull_resources_max": 10, "pull_page_default": 200, "pull_page_max": 1000,
                "push_batch_max": 100, "tombstone_retention_days": 90,
                "idempotency_retention_days": 7
            }
        },
        "meta": {}
    })
}

fn pulled() -> Value {
    json!({ "data": { "horizon": "10", "server_time": "2026-10-26T09:15:00+03:00",
        "resources": [] }, "meta": {} })
}

struct Live {
    state: AppState,
    connectivity: Connectivity,
    server: MockServer,
    up: Arc<AtomicBool>,
    sync: keystone_sync::engine::SyncHandle,
    _dir: tempfile::TempDir,
}

fn client(base_url: &str, store: &Arc<MemoryTokenStore>) -> HttpClient {
    let config = ApiConfig {
        base_url: base_url.to_owned(),
        company_id: COMPANY.parse().unwrap(),
        user_agent: "keystone-desktop-test".into(),
    };
    let options = ClientOptions {
        connect_timeout: Duration::from_secs(2),
        request_timeout: ANSWER_WAIT,
        allow_http_localhost: true,
    };
    HttpClient::new(&config, PROFILE, store.clone(), &options).unwrap()
}

/// A signed-in profile with a running loop, its server off and the engine
/// offline already.
async fn offline() -> Live {
    let server = MockServer::start().await;
    let up = Arc::new(AtomicBool::new(false));
    for (verb, route, body) in [
        ("GET", "/api/v1/sync/manifest", manifest()),
        ("POST", "/api/v1/sync/pull", pulled()),
        ("GET", REPORT, json!({ "data": [] })),
    ] {
        Mock::given(method(verb))
            .and(path(route))
            .respond_with(Switch {
                up: up.clone(),
                body,
            })
            .mount(&server)
            .await;
    }
    let tokens = StoredTokens {
        access_token: Secret::new("access-1-0123456789abcdef".to_owned()),
        access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
        refresh_token: Secret::new("refresh-1-0123456789abcdef".to_owned()),
        refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
    };
    let store = Arc::new(MemoryTokenStore::signed_in(PROFILE, &tokens));
    let dir = tempfile::tempdir().unwrap();
    let db = Arc::new(Store::open(dir.path().join("p.db"), &DbKey::from_bytes([7; 32])).unwrap());
    let offline_manifest =
        keystone_sync::store::offline_manifest(crate::router::decide::OFFLINE_MANIFEST).unwrap();
    let engine = Arc::new(
        SyncEngine::new(client(&server.uri(), &store), db.clone())
            .with_offline_manifest(offline_manifest),
    );
    let state = AppState::default();
    state.activate(ActiveProfile {
        id: PROFILE.into(),
        client: Arc::new(client(&server.uri(), &store)),
        engine: None,
    });
    let (handle, run) = sync_loop(engine.clone());
    tokio::spawn(run.run());
    state
        .attach(PROFILE, engine, db, Some(handle.clone()))
        .unwrap();
    let live = Live {
        state,
        connectivity: Connectivity::default(),
        server,
        up,
        sync: handle,
        _dir: dir,
    };
    live.wait_for_state(SyncState::Offline).await;
    live
}

impl Live {
    async fn get_report(&self) -> CommandResult<ApiResponseDto> {
        let request: ApiRequestDto =
            serde_json::from_value(json!({ "method": "GET", "path": REPORT })).unwrap();
        handle(
            &self.state,
            &self.connectivity,
            Arc::new(NoLocalCopy),
            request,
        )
        .await
    }

    async fn wait_for_state(&self, state: SyncState) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.state.engine().unwrap().status().state != state {
            assert!(
                Instant::now() < deadline,
                "the engine never became {state:?}"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    async fn report_requests(&self) -> usize {
        self.server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|r| r.url.path() == REPORT)
            .count()
    }
}

/// The server is back but the engine still says offline: the first retry
/// asks the engine, waits for it to find the server, and is sent.
#[tokio::test(flavor = "multi_thread")]
async fn the_first_retry_after_the_server_returned_reaches_it() {
    let live = offline().await;
    live.up.store(true, Ordering::SeqCst);
    let started = Instant::now();
    let answer = live.get_report().await.unwrap();
    assert_eq!(
        (answer.status, answer.source),
        (200, ResponseSource::Network)
    );
    assert!(started.elapsed() < PROBE_WAIT, "{:?}", started.elapsed());
    assert_eq!(live.report_requests().await, 1);
    assert!(
        live.connectivity
            .online(PROFILE, Some(true), Instant::now())
    );
}

/// The server is still away: the refused request waits for the probe's
/// verdict (no longer than [`PROBE_WAIT`]) and stays refused; a second one
/// within [`crate::router::PROBE_INTERVAL`] neither asks nor waits.
#[tokio::test(flavor = "multi_thread")]
async fn a_probe_is_asked_at_most_once_per_interval() {
    let live = offline().await;
    let started = Instant::now();
    let first = live.get_report().await.unwrap();
    let waited = started.elapsed();
    assert_eq!((first.status, first.source), (503, ResponseSource::Local));
    assert!(
        waited >= ANSWER_WAIT / 2,
        "did not wait for the probe: {waited:?}"
    );
    assert!(
        waited < PROBE_WAIT + Duration::from_millis(500),
        "{waited:?}"
    );

    let started = Instant::now();
    let second = live.get_report().await.unwrap();
    assert_eq!(second.status, 503);
    assert!(
        started.elapsed() < Duration::from_millis(150),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(live.report_requests().await, 0);

    // After the interval a request may ask again, and the server is back.
    tokio::time::sleep(crate::router::PROBE_INTERVAL).await;
    live.up.store(true, Ordering::SeqCst);
    let third = live.get_report().await.unwrap();
    assert_eq!(third.source, ResponseSource::Network);
}

/// "Sync now" waits for the run's verdict and records it, so the next
/// request is routed by it.
#[tokio::test(flavor = "multi_thread")]
async fn sync_now_waits_for_the_verdict_and_records_it() {
    let live = offline().await;
    live.up.store(true, Ordering::SeqCst);
    let started = Instant::now();
    crate::commands::sync::now_and_wait(&live.state, &live.connectivity, PROBE_WAIT)
        .await
        .unwrap();
    assert!(started.elapsed() < PROBE_WAIT, "{:?}", started.elapsed());
    // Recorded: online even where the engine would say offline.
    assert!(
        live.connectivity
            .online(PROFILE, Some(true), Instant::now())
    );
    let answer = live.get_report().await.unwrap();
    assert_eq!(answer.source, ResponseSource::Network);
}

/// With the server still away, "sync now" returns after the verdict (or
/// at the latest after its wait) and leaves the profile offline.
#[tokio::test(flavor = "multi_thread")]
async fn sync_now_against_a_server_still_away_is_bounded() {
    let live = offline().await;
    let wait = Duration::from_millis(1500);
    let started = Instant::now();
    crate::commands::sync::now_and_wait(&live.state, &live.connectivity, wait)
        .await
        .unwrap();
    assert!(
        started.elapsed() < wait + Duration::from_millis(300),
        "{:?}",
        started.elapsed()
    );
    assert!(
        !live
            .connectivity
            .online(PROFILE, Some(false), Instant::now())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn sync_now_without_a_loop_is_refused() {
    let state = AppState::default();
    let store = Arc::new(MemoryTokenStore::default());
    state.activate(ActiveProfile {
        id: PROFILE.into(),
        client: Arc::new(client("http://127.0.0.1:0", &store)),
        engine: None,
    });
    let error = crate::commands::sync::now_and_wait(&state, &Connectivity::default(), PROBE_WAIT)
        .await
        .unwrap_err();
    assert_eq!(error.code, "ENGINE_UNAVAILABLE");
    let error = crate::commands::sync::now_and_wait(
        &AppState::default(),
        &Connectivity::default(),
        PROBE_WAIT,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, "NO_ACTIVE_PROFILE");
}

/// The connectivity bridge over a live engine: a request that finds the
/// server while the engine is offline asks for a run at once (long before
/// the engine's next probe); a loss the offline engine agrees with asks
/// nothing.
#[tokio::test(flavor = "multi_thread")]
async fn a_return_the_offline_engine_disagrees_with_asks_for_a_run() {
    let live = offline().await;
    let engine = live.state.engine().unwrap();
    let mut passes = engine.subscribe_passes();
    // Three failed passes: the engine's own next probe is 4 s away.
    let deadline = Instant::now() + Duration::from_secs(10);
    while *passes.borrow_and_update() < 3 {
        assert!(Instant::now() < deadline, "the engine stopped probing");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let recorder = Arc::new(crate::events::Recorder::default());
    let bridge = tokio::spawn(crate::events::connectivity_bridge(
        PROFILE.into(),
        live.connectivity.subscribe(),
        Some(crate::events::EngineView {
            status: engine.subscribe(),
            passes: engine.subscribe_passes(),
            started: crate::events::passes_started(&engine),
            connectivity: live.connectivity.clone(),
        }),
        Some(live.sync.clone()),
        recorder.clone(),
    ));
    tokio::time::sleep(Duration::from_millis(50)).await;
    let before = *passes.borrow_and_update();

    // Told unreachable first (so that reachable is a change): the engine
    // agrees, no run.
    live.connectivity.observe(PROFILE, false, Instant::now());
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(*passes.borrow_and_update(), before);

    live.up.store(true, Ordering::SeqCst);
    let told = Instant::now();
    live.connectivity.observe(PROFILE, true, Instant::now());
    live.wait_for_state(SyncState::Idle).await;
    assert!(
        told.elapsed() < Duration::from_millis(2500),
        "{:?}",
        told.elapsed()
    );
    bridge.abort();
}
