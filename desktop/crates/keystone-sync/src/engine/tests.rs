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

#[derive(Debug)]
struct FakeApi {
    session: Arc<Session>,
    manifests: AtomicUsize,
    push_mode: AtomicU8,
}

impl FakeApi {
    fn new(session: Arc<Session>) -> Self {
        Self {
            session,
            manifests: AtomicUsize::new(0),
            push_mode: AtomicU8::new(PUSH_LOST),
        }
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
        match self.push_mode.load(Ordering::SeqCst) {
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
