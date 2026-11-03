//! The timing of the probes `api_request` and `sync_now` ask for: a live
//! sync loop over a mock server whose answers are switched between down
//! (far too late for the clients), up, a slow manifest and a stuck pull.

use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::{Duration, Instant};

use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens};
use keystone_sync::client::{ApiConfig, ClientOptions, HttpClient};
use keystone_sync::engine::{SyncEngine, SyncState, SyncStatus, Trigger, sync_loop};
use keystone_sync::store::{DbKey, LocalCopy, Store};
use keystone_sync::wire::{ResourceName, Timestamp};
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

use super::*;
use crate::dto::api::ResponseSource;
use crate::events::{EngineView, Recorder, connectivity_bridge};
use crate::router::{NoLocalCopy, envelope};
use crate::state::ActiveProfile;

const PROFILE: &str = "api-probe-timing";
const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";
const REPORT: &str = "/api/v1/reports/trial-balance";

/// Every answer far too late.
const DOWN: u8 = 0;
/// Every answer at once.
const UP: u8 = 1;
/// The manifest 2 s late, the rest at once.
const SLOW_MANIFEST: u8 = 2;
/// The manifest at once, the pull far too late.
const STUCK_PULL: u8 = 3;

struct Switch {
    mode: Arc<AtomicU8>,
    body: Value,
    route: &'static str,
}

impl Respond for Switch {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        let answer = ResponseTemplate::new(200).set_body_json(self.body.clone());
        match (self.mode.load(Ordering::SeqCst), self.route) {
            (DOWN, _) => answer.set_delay(Duration::from_secs(30)),
            (SLOW_MANIFEST, "manifest") => answer.set_delay(Duration::from_secs(2)),
            (STUCK_PULL, "pull") => answer.set_delay(Duration::from_secs(30)),
            _ => answer,
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
            "device_id": null, "permissions": [], "online_only": [],
            "resources": [{ "resource": "parties", "scope": "company", "visibility_generation": 0,
                "read": "local-first", "source": "pull", "window_days": null, "writable": ["create"] }],
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
        "resources": [{ "resource": "parties", "rows": [], "tombstones": [],
            "next_cursor": {"txid": "10", "after_id": null, "gen": 0, "session": null},
            "has_more": false, "reset": false }] }, "meta": {} })
}

fn client(base_url: &str, store: &Arc<MemoryTokenStore>, wait: Duration) -> HttpClient {
    HttpClient::new(
        &ApiConfig {
            base_url: base_url.to_owned(),
            company_id: COMPANY.parse().unwrap(),
            user_agent: "keystone-desktop-test".into(),
        },
        PROFILE,
        store.clone(),
        &ClientOptions {
            connect_timeout: Duration::from_secs(2),
            request_timeout: wait,
            allow_http_localhost: true,
        },
    )
    .unwrap()
}

struct Live {
    state: AppState,
    connectivity: Connectivity,
    mode: Arc<AtomicU8>,
    engine: Arc<Engine>,
    sync: keystone_sync::engine::SyncHandle,
    _server: MockServer,
    _dir: tempfile::TempDir,
}

/// A running loop whose clients give up after `wait`; `api_url` is where
/// `api_request` goes (the mock server by default). Returns once the
/// engine settled: offline when it starts down, else idle.
async fn live(start: u8, wait: Duration, api_url: Option<&str>) -> Live {
    let server = MockServer::start().await;
    let mode = Arc::new(AtomicU8::new(start));
    for (verb, route, name, body) in [
        ("GET", "/api/v1/sync/manifest", "manifest", manifest()),
        ("POST", "/api/v1/sync/pull", "pull", pulled()),
        ("GET", REPORT, "report", json!({ "data": [] })),
    ] {
        Mock::given(method(verb))
            .and(path(route))
            .respond_with(Switch {
                mode: mode.clone(),
                body,
                route: name,
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
        SyncEngine::new(client(&server.uri(), &store, wait), db.clone())
            .with_offline_manifest(offline_manifest),
    );
    let state = AppState::default();
    let api_url = api_url.map_or_else(|| server.uri(), str::to_owned);
    state.activate(ActiveProfile {
        id: PROFILE.into(),
        client: Arc::new(client(&api_url, &store, wait)),
        engine: None,
    });
    let (handle, run) = sync_loop(engine.clone());
    tokio::spawn(run.run());
    state
        .attach(PROFILE, engine.clone(), db, Some(handle.clone()))
        .unwrap();
    let live = Live {
        state,
        connectivity: Connectivity::default(),
        mode,
        engine,
        sync: handle,
        _server: server,
        _dir: dir,
    };
    let want = if start == DOWN {
        SyncState::Offline
    } else {
        SyncState::Idle
    };
    live.wait_for_state(want).await;
    live
}

impl Live {
    async fn call(
        &self,
        resolver: Arc<dyn LocalResolver>,
        request: Value,
    ) -> CommandResult<ApiResponseDto> {
        let request: ApiRequestDto = serde_json::from_value(request).unwrap();
        handle(&self.state, &self.connectivity, resolver, request).await
    }

    async fn report(&self) -> ApiResponseDto {
        self.call(
            Arc::new(NoLocalCopy),
            json!({ "method": "GET", "path": REPORT }),
        )
        .await
        .unwrap()
    }

    /// Returns right after the loop's next pass ended, so that the next
    /// trigger starts a fresh pass.
    async fn after_a_pass(&self) {
        let mut passes = self.engine.subscribe_passes();
        passes.borrow_and_update();
        tokio::time::timeout(Duration::from_secs(20), passes.changed())
            .await
            .unwrap()
            .unwrap();
    }

    async fn wait_for_state(&self, want: SyncState) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while self.engine.status().state != want {
            assert!(
                Instant::now() < deadline,
                "the engine never became {want:?}"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    fn set(&self, mode: u8) {
        self.mode.store(mode, Ordering::SeqCst);
    }

    /// The connectivity bridge of the profile, as the shell runs it.
    fn bridge(&self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(connectivity_bridge(
            PROFILE.into(),
            self.connectivity.subscribe(),
            Some(EngineView {
                status: self.engine.subscribe(),
                passes: self.engine.subscribe_passes(),
                connectivity: self.connectivity.clone(),
            }),
            Some(self.sync.clone()),
            Arc::new(Recorder::default()),
        ))
    }
}

/// A local copy that answers every plan with `status`.
struct Answers(u16);

impl LocalResolver for Answers {
    fn local_copy(
        &self,
        _: &Engine,
        _: Option<&Store>,
        _: &ResourceName,
    ) -> CommandResult<LocalCopy> {
        Ok(LocalCopy::Complete)
    }

    fn resolve(
        &self,
        _: &Engine,
        _: Option<&Store>,
        _: &LocalPlan,
        _: &ApiCall,
    ) -> CommandResult<LocalOutcome> {
        Ok(LocalOutcome::Answer(envelope::local(
            self.0,
            json!({ "data": { "id": "0192f5a0-0000-7000-8000-00000000000a" },
                "meta": { "offline": { "pending": true } } }),
        )))
    }
}

fn parties_read() -> Value {
    json!({ "method": "GET", "path": "/api/v1/parties" })
}

// ------------------------------------------------------------- PROBE_WAIT

/// The server is back but its manifest takes 2 s: the refused request waits
/// for the verdict (up to 3 s) and reaches the server.
#[tokio::test(flavor = "multi_thread")]
async fn a_verdict_within_three_seconds_is_waited_for() {
    let live = live(DOWN, Duration::from_secs(4), None).await;
    live.after_a_pass().await;
    live.set(SLOW_MANIFEST);
    let answer = live.report().await;
    assert_eq!(answer.source, ResponseSource::Network);
}

/// The server still away and the engine's pass slower than the wait: the
/// refused request gives up after about 3 s.
#[tokio::test(flavor = "multi_thread")]
async fn a_refused_request_waits_at_most_three_seconds() {
    assert_eq!(PROBE_WAIT, Duration::from_secs(3));
    let live = live(DOWN, Duration::from_secs(4), None).await;
    live.after_a_pass().await;
    let started = Instant::now();
    let answer = live.report().await;
    let waited = started.elapsed();
    assert_eq!(answer.status, 503);
    assert!(
        waited >= Duration::from_millis(2800) && waited < Duration::from_millis(3600),
        "{waited:?}"
    );
}

/// The manifest answers at once but the pull hangs: the first answer is the
/// verdict, and the refused request goes to the server without waiting for
/// the rest of the pass.
#[tokio::test(flavor = "multi_thread")]
async fn the_first_answer_of_the_server_is_the_verdict() {
    let live = live(DOWN, Duration::from_secs(4), None).await;
    live.after_a_pass().await;
    live.set(STUCK_PULL);
    let started = Instant::now();
    let answer = live.report().await;
    assert_eq!(answer.source, ResponseSource::Network);
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "{:?}",
        started.elapsed()
    );
}

/// `sync_now` returns after its wait even when the pass takes longer.
#[tokio::test(flavor = "multi_thread")]
async fn sync_now_keeps_to_its_wait() {
    let live = live(DOWN, Duration::from_secs(6), None).await;
    live.after_a_pass().await;
    let started = Instant::now();
    crate::commands::sync::now_and_wait(&live.state, &live.connectivity, Duration::from_secs(1))
        .await
        .unwrap();
    assert!(
        started.elapsed() < Duration::from_millis(1600),
        "{:?}",
        started.elapsed()
    );
}

/// A failed `sync_now` overrides an earlier fresh "reachable".
#[tokio::test(flavor = "multi_thread")]
async fn a_negative_verdict_is_recorded() {
    let live = live(DOWN, Duration::from_millis(800), None).await;
    live.connectivity.observe(PROFILE, true, Instant::now());
    assert!(
        live.connectivity
            .online(PROFILE, Some(true), Instant::now())
    );
    crate::commands::sync::now_and_wait(&live.state, &live.connectivity, Duration::from_secs(3))
        .await
        .unwrap();
    assert!(
        !live
            .connectivity
            .online(PROFILE, Some(false), Instant::now())
    );
}

/// A pass already running when "sync now" is pressed (it began while the
/// server was away and will fail) is not its verdict: the pass the trigger
/// asks for, right after it, finds the server back.
#[tokio::test(flavor = "multi_thread")]
async fn the_verdict_comes_from_a_pass_begun_after_the_trigger() {
    let live = live(DOWN, Duration::from_millis(1500), None).await;
    live.after_a_pass().await;
    // A pass begins while the server is away; it fails at its timeout.
    let mut passes = live.engine.subscribe_passes();
    let before = *passes.borrow_and_update();
    assert!(live.state.trigger(PROFILE, Trigger::Manual).unwrap());
    let deadline = Instant::now() + Duration::from_secs(5);
    while live.engine.passes_started() == before {
        assert!(Instant::now() < deadline, "no pass began");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    live.set(UP);
    crate::commands::sync::now_and_wait(&live.state, &live.connectivity, PROBE_WAIT)
        .await
        .unwrap();
    assert!(
        live.connectivity
            .online(PROFILE, Some(true), Instant::now()),
        "the running pass's failure was taken for the verdict"
    );
}

// ------------------------------------------------------- local answers

/// A local answer that is not a refusal does not wait for the probe.
#[tokio::test(flavor = "multi_thread")]
async fn a_local_answer_does_not_wait() {
    let live = live(DOWN, Duration::from_secs(4), None).await;
    let started = Instant::now();
    let answer = live
        .call(Arc::new(Answers(200)), parties_read())
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    assert!(
        started.elapsed() < Duration::from_millis(800),
        "{:?}",
        started.elapsed()
    );
}

/// The draft of a write that never left the device asks the engine for a
/// probe.
#[tokio::test(flavor = "multi_thread")]
async fn an_unsent_write_asks_for_a_probe() {
    let live = live(UP, Duration::from_secs(4), Some("http://127.0.0.1:0")).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut passes = live.engine.subscribe_passes();
    let before = *passes.borrow_and_update();
    let answer = live
        .call(
            Arc::new(Answers(202)),
            json!({ "method": "POST", "path": "/api/v1/parties",
                "body": { "kind": "json", "value": { "name": "Acme" } } }),
        )
        .await
        .unwrap();
    assert_eq!(answer.source, ResponseSource::Local);
    let deadline = Instant::now() + Duration::from_secs(2);
    while *passes.borrow_and_update() == before && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(*passes.borrow_and_update() > before);
}

/// A request that found the server gone for a moment (the engine never
/// went offline): a later local answer asks for a probe, the pass ends idle,
/// and the bridge makes the profile reachable again at once instead of when
/// the failed request's finding expires.
#[tokio::test(flavor = "multi_thread")]
async fn a_successful_probe_ends_a_passing_loss_at_once() {
    let live = live(UP, Duration::from_secs(4), None).await;
    let _bridge = live.bridge();
    tokio::time::sleep(Duration::from_millis(100)).await;
    // What a request that could not connect leaves behind.
    live.connectivity.observe(PROFILE, false, Instant::now());
    let deadline = Instant::now() + Duration::from_secs(3);
    while !live
        .connectivity
        .online(PROFILE, Some(false), Instant::now())
    {
        // Local answers meanwhile ask for probes; their passes end idle.
        let _ = live.call(Arc::new(Answers(200)), parties_read()).await;
        assert!(
            Instant::now() < deadline,
            "still offline after a successful probe"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// A local answer just before does not take a refused request's turn: the
/// refused request still waits for the verdict and reaches the server back.
#[tokio::test(flavor = "multi_thread")]
async fn a_local_answer_does_not_take_the_refused_requests_turn() {
    let live = live(DOWN, Duration::from_secs(4), None).await;
    live.after_a_pass().await;
    let local = live
        .call(Arc::new(Answers(200)), parties_read())
        .await
        .unwrap();
    assert_eq!(local.source, ResponseSource::Local);
    live.set(UP);
    let answer = live.report().await;
    assert_eq!(answer.source, ResponseSource::Network);
}

// ------------------------------------------------------------------ bridge

/// A request found the server gone while the engine is idle; the engine
/// then starts a pass (Idle -> Syncing). Starting a pass is no finding:
/// the view stays unreachable and no "online" is told.
#[tokio::test(flavor = "multi_thread")]
async fn a_pass_starting_is_not_a_finding() {
    let connectivity = Connectivity::default();
    let recorder = Arc::new(Recorder::default());
    let (status, status_rx) = tokio::sync::watch::channel(SyncStatus::default());
    let (_passes, passes_rx) = tokio::sync::watch::channel(0u64);
    let task = tokio::spawn(connectivity_bridge(
        "p1".into(),
        connectivity.subscribe(),
        Some(EngineView {
            status: status_rx,
            passes: passes_rx,
            connectivity: connectivity.clone(),
        }),
        None,
        recorder.clone(),
    ));
    tokio::time::sleep(Duration::from_millis(50)).await;
    connectivity.observe("p1", false, Instant::now());
    tokio::time::sleep(Duration::from_millis(50)).await;
    status.send_modify(|s| s.state = SyncState::Syncing);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let events: Vec<Value> = recorder
        .events()
        .iter()
        .map(|e| serde_json::to_value(e).unwrap())
        .collect();
    assert_eq!(
        events,
        [json!({"type": "connectivity", "profile_id": "p1", "online": false})]
    );
    assert!(!connectivity.online("p1", Some(false), Instant::now()));
    task.abort();
}

/// A pass that ends idle while the view says unreachable makes it
/// reachable; one that ends failed or offline does not.
#[tokio::test(flavor = "multi_thread")]
async fn only_a_pass_that_ends_idle_is_a_return() {
    let connectivity = Connectivity::default();
    let (status, status_rx) = tokio::sync::watch::channel(SyncStatus::default());
    let (passes, passes_rx) = tokio::sync::watch::channel(0u64);
    let task = tokio::spawn(connectivity_bridge(
        "p1".into(),
        connectivity.subscribe(),
        Some(EngineView {
            status: status_rx,
            passes: passes_rx,
            connectivity: connectivity.clone(),
        }),
        None,
        Arc::new(Recorder::default()),
    ));
    tokio::time::sleep(Duration::from_millis(50)).await;
    connectivity.observe("p1", false, Instant::now());
    status.send_modify(|s| s.state = SyncState::Failed("SERVER_ERROR"));
    passes.send_replace(1);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!connectivity.online("p1", Some(false), Instant::now()));
    status.send_modify(|s| s.state = SyncState::Idle);
    passes.send_replace(2);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(connectivity.online("p1", Some(false), Instant::now()));
    task.abort();
}
