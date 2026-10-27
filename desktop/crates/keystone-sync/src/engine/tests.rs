//! Interleavings that need a seam inside the engine: a trigger arriving
//! just as a run ends, a write arriving while sign-out is between its
//! count and its wipe, a sign-in landing between a check and the work it
//! guards. The [`Hook`] points stop the engine there.

use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use serde_json::{Value, json};
use uuid::Uuid;

use super::{Hook, SignOut, SyncEngine, Trigger};
use crate::auth::{MemoryTokenStore, Secret, Session, StoredTokens, TokenStore, TokenWrite};
use crate::client::SyncApi;
use crate::error::{Result, SyncError};
use crate::outbox::{NewMutation, OutboxState};
use crate::store::{DbKey, ListQuery, Store};
use crate::wire::{
    ManifestResponse, MutationOp, PullRequest, PullResponse, PushRequest, PushResponse,
    ResourceName, Timestamp,
};

const PROFILE: &str = "engine-unit";

/// What [`FakeApi::push`] answers.
const PUSH_LOST: u8 = 0;
const PUSH_APPLY: u8 = 1;
const PUSH_NOT_SENT: u8 = 2;
/// 409 `IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 30`.
const PUSH_BUSY: u8 = 3;
const BUSY_RETRY_AFTER: Duration = Duration::from_secs(30);

#[derive(Debug)]
struct FakeApi {
    session: Arc<Session>,
    manifests: AtomicUsize,
    push_mode: AtomicU8,
    /// Idempotency keys of every push, in order.
    pushes: Mutex<Vec<Vec<Uuid>>>,
    /// `Retry-After` of a busy push.
    busy_retry_after: Mutex<Duration>,
}

impl FakeApi {
    fn new(session: Arc<Session>) -> Self {
        Self {
            session,
            manifests: AtomicUsize::new(0),
            push_mode: AtomicU8::new(PUSH_LOST),
            pushes: Mutex::default(),
            busy_retry_after: Mutex::new(BUSY_RETRY_AFTER),
        }
    }

    fn pushes(&self) -> Vec<Vec<Uuid>> {
        self.pushes.lock().unwrap().clone()
    }
}

fn manifest() -> ManifestResponse {
    serde_json::from_value(json!({
        "data": {
            "schema_version": 1,
            "min_schema_version": 1,
            "offline_manifest_version": 1,
            "server_time": "2026-10-26T09:15:00+03:00",
            "company_id": "0192f5a0-0000-7000-8000-000000000001",
            "user_id": "0192f5a0-0000-7000-8000-00000000000a",
            "device_id": null,
            "permissions": [],
            "resources": [{
                "resource": "parties", "scope": "company", "visibility_generation": 0,
                "read": "local-first", "source": "pull", "window_days": null,
                "writable": ["create"],
            }],
            "online_only": [],
            "limits": {
                "pull_resources_max": 10, "pull_page_default": 200, "pull_page_max": 1000,
                "push_batch_max": 100, "tombstone_retention_days": 90,
                "idempotency_retention_days": 7,
            },
        },
        "meta": {},
    }))
    .expect("manifest")
}

impl crate::client::sealed::Sealed for FakeApi {}

impl SyncApi for FakeApi {
    fn session(&self) -> &Arc<Session> {
        &self.session
    }

    async fn manifest(&self) -> Result<ManifestResponse> {
        self.manifests.fetch_add(1, Ordering::SeqCst);
        Ok(manifest())
    }

    async fn pull(&self, request: &PullRequest) -> Result<PullResponse> {
        let pages: Vec<_> = request
            .resources
            .iter()
            .map(|r| {
                json!({"resource": r.resource, "rows": [], "tombstones": [],
                       "next_cursor": {"txid": "10", "after_id": null, "gen": 0, "session": null},
                       "has_more": false, "reset": false})
            })
            .collect();
        Ok(serde_json::from_value(json!({
            "data": {"horizon": "10", "server_time": "2026-10-26T09:15:00+03:00", "resources": pages},
            "meta": {},
        }))?)
    }

    async fn push(&self, request: &PushRequest) -> Result<PushResponse> {
        self.pushes.lock().unwrap().push(
            request
                .mutations
                .iter()
                .map(|m| m.idempotency_key)
                .collect(),
        );
        match self.push_mode.load(Ordering::SeqCst) {
            PUSH_BUSY => Err(SyncError::Api {
                status: 409,
                code: crate::wire::ErrorCode::IdempotencyInProgress,
                message: "busy".into(),
                fields: Default::default(),
                retry_after: Some(*self.busy_retry_after.lock().unwrap()),
                redacted: None,
            }),
            PUSH_APPLY => {
                let results: Vec<Value> = request
                    .mutations
                    .iter()
                    .map(|m| {
                        let mut data = Value::Object(m.payload.clone());
                        data["id"] = json!(m.id);
                        data["version"] = json!(1);
                        json!({"idempotency_key": m.idempotency_key, "resource": m.resource,
                               "id": m.id, "status": "applied", "replayed": false,
                               "version": 1, "data": data})
                    })
                    .collect();
                Ok(serde_json::from_value(
                    json!({"data": {"results": results}, "meta": {}}),
                )?)
            }
            PUSH_NOT_SENT => Err(SyncError::NotSent("connection refused".into())),
            _ => Err(SyncError::Network("answer lost".into())),
        }
    }

    async fn manifest_in(&self, _: u64) -> Result<ManifestResponse> {
        self.manifest().await
    }

    async fn pull_in(&self, request: &PullRequest, _: u64) -> Result<PullResponse> {
        self.pull(request).await
    }

    async fn push_in(&self, request: &PushRequest, _: u64) -> Result<PushResponse> {
        self.push(request).await
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    tokens: Arc<MemoryTokenStore>,
    engine: Arc<SyncEngine<FakeApi>>,
}

fn tokens(n: u8) -> StoredTokens {
    StoredTokens {
        access_token: Secret::new(format!("access-{n}")),
        access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
        refresh_token: Secret::new(format!("refresh-{n}")),
        refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
    }
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let store =
        Arc::new(Store::open(dir.path().join("unit.db"), &DbKey::from_bytes([7; 32])).unwrap());
    let tokens = Arc::new(MemoryTokenStore::signed_in(PROFILE, &self::tokens(1)));
    let session = Session::shared(PROFILE, tokens.clone());
    let engine = Arc::new(SyncEngine::new(FakeApi::new(session), store));
    Fixture {
        _dir: dir,
        tokens,
        engine,
    }
}

fn create() -> NewMutation {
    NewMutation {
        op: MutationOp::Create,
        action: None,
        resource: ResourceName("parties".into()),
        id: Uuid::now_v7(),
        parent_id: None,
        base_version: None,
        payload: json!({"name": "Geç"})
            .as_object()
            .cloned()
            .unwrap_or_default(),
        depends_on: vec![],
        occurred_at: Timestamp("2026-10-26T09:10:00+03:00".into()),
        resolution: None,
    }
}

#[tokio::test]
async fn a_trigger_arriving_as_a_run_ends_is_not_lost() {
    let f = fixture();
    let weak = Arc::downgrade(&f.engine);
    let entered: Arc<Mutex<Option<bool>>> = Arc::default();
    let seen = entered.clone();
    let fired = AtomicBool::new(false);
    f.engine.set_hook(move |point| {
        if point == Hook::GateDecided
            && !fired.swap(true, Ordering::SeqCst)
            && let Some(engine) = weak.upgrade()
        {
            // Another caller's `run_once` entering the gate right now.
            *seen.lock().unwrap() = Some(engine.enter_gate());
        }
    });

    f.engine.run_once(Trigger::Startup).await.unwrap();
    let became_runner = entered.lock().unwrap().take().expect("hook ran");
    let runs = f.engine.api.manifests.load(Ordering::SeqCst);
    assert!(
        became_runner || runs == 2,
        "the caller was told a follow-up run would happen, but none did (runs: {runs})"
    );
}

#[tokio::test]
async fn a_write_during_sign_out_is_either_counted_or_refused() {
    let f = fixture();
    f.engine.run_once(Trigger::Startup).await.unwrap();
    let weak = Arc::downgrade(&f.engine);
    let (tx, rx) = mpsc::channel::<Result<()>>();
    let early: Arc<Mutex<Option<Result<()>>>> = Arc::default();
    let late_rx: Arc<Mutex<Option<mpsc::Receiver<Result<()>>>>> = Arc::default();
    let (early_slot, late_slot) = (early.clone(), late_rx.clone());
    let fired = AtomicBool::new(false);
    let rx = Mutex::new(Some(rx));
    f.engine.set_hook(move |point| {
        if point != Hook::SignOutCounted || fired.swap(true, Ordering::SeqCst) {
            return;
        }
        let Some(engine) = weak.upgrade() else { return };
        let tx = tx.clone();
        std::thread::spawn(move || {
            let _ = tx.send(engine.enqueue(create()).map(|_| ()));
        });
        let rx = rx.lock().unwrap().take().unwrap();
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(result) => *early_slot.lock().unwrap() = Some(result),
            // Blocked behind sign-out: collect after it.
            Err(_) => *late_slot.lock().unwrap() = Some(rx),
        }
    });

    assert_eq!(f.engine.sign_out(false).await.unwrap(), SignOut::Done);
    let result = match early.lock().unwrap().take() {
        Some(result) => result,
        None => late_rx
            .lock()
            .unwrap()
            .take()
            .expect("writer")
            .recv_timeout(Duration::from_secs(10))
            .expect("writer finished"),
    };
    let kept = f.engine.outbox.list().unwrap().len();
    assert!(
        result.is_err() || kept == 1,
        "enqueue reported success but sign-out deleted the entry"
    );
}

/// Runs a sign-in through the session gate on another thread from inside
/// a hook and waits up to 300 ms for it. `landed` is set when the sign-in
/// completed within that window, i.e. inside the guarded section.
struct SignInProbe {
    landed: Mutex<Option<bool>>,
    worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl SignInProbe {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            landed: Mutex::new(None),
            worker: Mutex::new(None),
        })
    }

    fn fire(&self, store: Arc<MemoryTokenStore>) {
        let (tx, rx) = mpsc::channel();
        let worker = std::thread::spawn(move || {
            let session = Session::shared(PROFILE, store);
            tokio::runtime::Builder::new_current_thread()
                .build()
                .unwrap()
                .block_on(session.sign_in(&tokens(2)))
                .unwrap();
            let _ = tx.send(());
        });
        let landed = rx.recv_timeout(Duration::from_millis(300)).is_ok();
        *self.landed.lock().unwrap() = Some(landed);
        *self.worker.lock().unwrap() = Some(worker);
    }

    fn finish(&self) -> bool {
        if let Some(worker) = self.worker.lock().unwrap().take() {
            worker.join().unwrap();
        }
        self.landed.lock().unwrap().take().expect("hook ran")
    }
}

#[tokio::test]
async fn a_sign_in_cannot_land_between_the_access_check_and_the_read() {
    let f = fixture();
    f.engine.run_once(Trigger::Startup).await.unwrap();
    let probe = SignInProbe::new();
    let (p, store) = (probe.clone(), f.tokens.clone());
    let fired = AtomicBool::new(false);
    f.engine.set_hook(move |point| {
        if point == Hook::AccessChecked && !fired.swap(true, Ordering::SeqCst) {
            p.fire(store.clone());
        }
    });

    let read = f
        .engine
        .list(&ResourceName("parties".into()), &ListQuery::default());
    let landed = probe.finish();
    assert!(read.is_ok());
    assert!(
        !landed,
        "user B's sign-in completed after A's access check and before A's read"
    );
    assert_eq!(f.tokens.load_record(PROFILE).unwrap().generation, 2);
}

#[tokio::test]
async fn a_sign_in_cannot_land_between_the_commit_check_and_the_write() {
    let f = fixture();
    f.engine.api.push_mode.store(PUSH_APPLY, Ordering::SeqCst);
    f.engine.run_once(Trigger::Startup).await.unwrap();
    f.engine.enqueue(create()).unwrap();
    let probe = SignInProbe::new();
    let (p, store) = (probe.clone(), f.tokens.clone());
    let fired = AtomicBool::new(false);
    f.engine.set_hook(move |point| {
        if point == Hook::CommitChecked && !fired.swap(true, Ordering::SeqCst) {
            p.fire(store.clone());
        }
    });

    let _ = f.engine.run_once(Trigger::Manual).await;
    assert!(
        !probe.finish(),
        "user B's sign-in completed after the commit check and before A's answer was written"
    );
}

#[tokio::test]
async fn sign_out_keeps_a_sign_in_made_while_it_runs() {
    let f = fixture();
    f.engine.run_once(Trigger::Startup).await.unwrap();
    let store = f.tokens.clone();
    let fired = AtomicBool::new(false);
    f.engine.set_hook(move |point| {
        if point == Hook::SignOutCounted && !fired.swap(true, Ordering::SeqCst) {
            // A write the session lock would keep out; made directly so the
            // compare-and-set itself is what is tested.
            store
                .sign_in(&TokenWrite::new(), PROFILE, &tokens(2))
                .unwrap();
        }
    });

    assert_eq!(f.engine.sign_out(false).await.unwrap(), SignOut::Done);
    assert_eq!(
        f.tokens.load(PROFILE).unwrap(),
        Some(tokens(2)),
        "sign-out of A removed B's tokens"
    );
}

#[tokio::test]
async fn unsent_pushes_do_not_count_towards_the_quarantine() {
    let f = fixture();
    f.engine
        .api
        .push_mode
        .store(PUSH_NOT_SENT, Ordering::SeqCst);
    f.engine.run_once(Trigger::Startup).await.unwrap();
    f.engine.enqueue(create()).unwrap();
    for _ in 0..8 {
        let error = f.engine.run_once(Trigger::Probe).await.unwrap_err();
        assert_eq!(error.code(), "NETWORK_ERROR");
    }
    let entries = f.engine.outbox.list().unwrap();
    assert_eq!(entries[0].state, OutboxState::Pending);
    assert_eq!(entries[0].attempts, 0);
    let _ = PUSH_LOST;
}

/// After a failure with `Retry-After`, no trigger (driver timer, manual,
/// network change, realtime, probe, a direct `run_once`) sends anything
/// before it has passed; then the same keys go out.
#[tokio::test(start_paused = true)]
async fn no_request_goes_out_before_retry_after_whatever_the_trigger() {
    let f = fixture();
    let api = &f.engine.api;
    f.engine.run_once(Trigger::Startup).await.unwrap();
    f.engine.enqueue(create()).unwrap();
    api.push_mode.store(PUSH_BUSY, Ordering::SeqCst);
    let error = f.engine.run_once(Trigger::Manual).await.unwrap_err();
    assert_eq!(error.code(), "IDEMPOTENCY_IN_PROGRESS");
    assert_eq!(f.engine.status().retry_after, Some(BUSY_RETRY_AFTER));
    let failed_at = tokio::time::Instant::now();
    let manifests = api.manifests.load(Ordering::SeqCst);
    let first = api.pushes();
    assert_eq!(first.len(), 1);
    api.push_mode.store(PUSH_APPLY, Ordering::SeqCst);

    let (handle, sync_loop) = super::sync_loop(f.engine.clone());
    let driver = tokio::spawn(sync_loop.run());
    let engine = f.engine.clone();
    let direct = tokio::spawn(async move { engine.run_once(Trigger::Manual).await });
    let quiet = |when: &str| {
        assert_eq!(
            api.manifests.load(Ordering::SeqCst),
            manifests,
            "a request went out before Retry-After ({when})"
        );
        assert_eq!(api.pushes().len(), 1, "a push went out early ({when})");
    };
    for trigger in [
        Trigger::Manual,
        Trigger::NetworkChanged,
        Trigger::Realtime(ResourceName("parties".into())),
        Trigger::Probe,
    ] {
        assert!(handle.trigger(trigger.clone()));
        tokio::time::advance(Duration::from_secs(7)).await;
        quiet(&format!("{trigger:?}"));
    }
    tokio::time::advance(Duration::from_millis(1_900)).await;
    quiet("29.9 s");

    tokio::time::advance(Duration::from_millis(200)).await;
    let mut spins = 0;
    while api.pushes().len() < 2 {
        tokio::task::yield_now().await;
        spins += 1;
        assert!(spins < 100_000, "no push after Retry-After");
    }
    assert!(failed_at.elapsed() >= BUSY_RETRY_AFTER);
    let pushes = api.pushes();
    assert_eq!(pushes[1], first[0], "resent with the same keys");
    assert!(direct.await.unwrap().is_ok());
    drop(handle);
    driver.abort();
}

/// State after a push answered busy with `Retry-After: wait`; the next push
/// applies. Returns the manifest count (one per pass) at that point.
async fn after_busy_push(f: &Fixture, wait: Duration) -> usize {
    let api = &f.engine.api;
    f.engine.run_once(Trigger::Startup).await.unwrap();
    f.engine.enqueue(create()).unwrap();
    *api.busy_retry_after.lock().unwrap() = wait;
    api.push_mode.store(PUSH_BUSY, Ordering::SeqCst);
    let error = f.engine.run_once(Trigger::Manual).await.unwrap_err();
    assert_eq!(error.code(), "IDEMPOTENCY_IN_PROGRESS");
    assert_eq!(f.engine.status().retry_after, Some(wait));
    api.push_mode.store(PUSH_APPLY, Ordering::SeqCst);
    api.manifests.load(Ordering::SeqCst)
}

/// Lets spawned tasks run without moving the paused clock.
async fn settle() {
    for _ in 0..1000 {
        tokio::task::yield_now().await;
    }
}

fn wait_in_background(f: &Fixture) -> tokio::task::JoinHandle<Result<super::SyncReport>> {
    let engine = f.engine.clone();
    tokio::spawn(async move { engine.run_once(Trigger::Timer).await })
}

#[tokio::test(start_paused = true)]
async fn sign_out_and_a_new_sign_in_are_not_held_by_the_old_retry_after() {
    let f = fixture();
    let before = after_busy_push(&f, Duration::from_secs(600)).await;
    let started = tokio::time::Instant::now();
    let waiting = wait_in_background(&f);
    settle().await;
    tokio::time::advance(Duration::from_secs(1)).await;
    assert_eq!(f.engine.api.manifests.load(Ordering::SeqCst), before);

    assert_eq!(f.engine.sign_out(true).await.unwrap(), SignOut::Done);
    f.engine.session.sign_in(&tokens(2)).await.unwrap();
    f.engine.run_once(Trigger::Manual).await.unwrap();
    waiting.await.unwrap().unwrap();
    assert!(f.engine.api.manifests.load(Ordering::SeqCst) > before);
    assert!(
        started.elapsed() < Duration::from_secs(600),
        "the new sign-in waited for the old Retry-After"
    );
}

#[tokio::test(start_paused = true)]
async fn another_sign_in_is_not_held_by_the_old_retry_after() {
    let f = fixture();
    let before = after_busy_push(&f, Duration::from_secs(600)).await;
    let started = tokio::time::Instant::now();
    let waiting = wait_in_background(&f);
    settle().await;
    assert_eq!(f.engine.api.manifests.load(Ordering::SeqCst), before);

    // No sign-out: the token store changes generation under the engine.
    f.engine.session.sign_in(&tokens(2)).await.unwrap();
    let report = f.engine.run_once(Trigger::Manual).await.unwrap();
    assert!(report.coalesced, "the waiting run serves the new trigger");
    waiting.await.unwrap().unwrap();
    assert!(f.engine.api.manifests.load(Ordering::SeqCst) > before);
    assert!(
        started.elapsed() < Duration::from_secs(600),
        "the new sign-in waited for the old Retry-After"
    );
}

#[tokio::test(start_paused = true)]
async fn a_run_cancelled_while_waiting_keeps_the_owed_trigger() {
    let f = fixture();
    let before = after_busy_push(&f, BUSY_RETRY_AFTER).await;
    let waiting = wait_in_background(&f);
    settle().await;
    assert!(f.engine.run_once(Trigger::Manual).await.unwrap().coalesced);
    settle().await;
    waiting.abort();
    assert!(waiting.await.unwrap_err().is_cancelled());
    assert_eq!(f.engine.api.manifests.load(Ordering::SeqCst), before);
    // The coalesced caller was promised a run: the sync loop is told.
    tokio::time::timeout(Duration::from_millis(1), f.engine.follow_up_requested())
        .await
        .expect("the owed follow-up was dropped");
}

#[tokio::test(start_paused = true)]
async fn retry_after_is_honoured_up_to_one_hour() {
    let f = fixture();
    let huge = Duration::from_secs(10 * 3600);
    after_busy_push(&f, huge).await;
    let started = tokio::time::Instant::now();
    f.engine.run_once(Trigger::Manual).await.unwrap();
    let waited = started.elapsed();
    assert!(
        waited >= crate::backoff::RETRY_AFTER_MAX
            && waited < crate::backoff::RETRY_AFTER_MAX + Duration::from_secs(1),
        "{waited:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn callers_during_the_wait_collapse_into_one_follow_up() {
    let f = fixture();
    let before = after_busy_push(&f, BUSY_RETRY_AFTER).await;
    let waiting = wait_in_background(&f);
    settle().await;
    for _ in 0..5 {
        assert!(f.engine.run_once(Trigger::Manual).await.unwrap().coalesced);
    }
    tokio::time::advance(Duration::from_secs(29)).await;
    settle().await;
    assert_eq!(f.engine.api.manifests.load(Ordering::SeqCst), before);
    waiting.await.unwrap().unwrap();
    assert_eq!(
        f.engine.api.manifests.load(Ordering::SeqCst),
        before + 2,
        "one pass and one follow-up"
    );
    assert_eq!(f.engine.api.pushes().len(), 2);
}

/// A sign-in completes while the failed request's answer is being settled
/// (after the "no other sign-in" check): its `Retry-After` belongs to the
/// old sign-in and must not hold the new one.
#[tokio::test(start_paused = true)]
async fn a_retry_after_answered_to_an_old_sign_in_does_not_hold_the_new_one() {
    let f = fixture();
    f.engine.run_once(Trigger::Startup).await.unwrap();
    f.engine.enqueue(create()).unwrap();
    let api = &f.engine.api;
    *api.busy_retry_after.lock().unwrap() = Duration::from_secs(600);
    api.push_mode.store(PUSH_BUSY, Ordering::SeqCst);
    let store = f.tokens.clone();
    let fired = AtomicBool::new(false);
    f.engine.set_hook(move |point| {
        if point == Hook::FailureKept && !fired.swap(true, Ordering::SeqCst) {
            store
                .sign_in(&TokenWrite::new(), PROFILE, &tokens(2))
                .unwrap();
        }
    });
    let error = f.engine.run_once(Trigger::Manual).await.unwrap_err();
    assert_eq!(error.code(), "IDEMPOTENCY_IN_PROGRESS");
    api.push_mode.store(PUSH_APPLY, Ordering::SeqCst);

    let before = api.manifests.load(Ordering::SeqCst);
    let started = tokio::time::Instant::now();
    f.engine.run_once(Trigger::Manual).await.unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "the new sign-in waited {:?} for the old Retry-After",
        started.elapsed()
    );
    assert!(api.manifests.load(Ordering::SeqCst) > before);
}
