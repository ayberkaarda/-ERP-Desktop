//! Interleavings that need a seam inside the engine: a trigger arriving
//! just as a run ends, and a write arriving while sign-out is between its
//! count and its wipe. The [`Hook`] points stop the engine there.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use serde_json::json;
use uuid::Uuid;

use super::{Hook, SignOut, SyncEngine, Trigger};
use crate::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore};
use crate::client::SyncApi;
use crate::error::{Result, SyncError};
use crate::outbox::NewMutation;
use crate::store::{DbKey, Store};
use crate::wire::{
    ManifestResponse, MutationOp, PullRequest, PullResponse, PushRequest, PushResponse,
    ResourceName, Timestamp,
};

const PROFILE: &str = "engine-unit";

#[derive(Debug, Default)]
struct FakeApi {
    manifests: AtomicUsize,
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

    async fn push(&self, _: &PushRequest) -> Result<PushResponse> {
        Err(SyncError::Network("offline".into()))
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    engine: Arc<SyncEngine<FakeApi>>,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let store =
        Arc::new(Store::open(dir.path().join("unit.db"), &DbKey::from_bytes([7; 32])).unwrap());
    let tokens = Arc::new(MemoryTokenStore::default());
    tokens
        .sign_in(
            PROFILE,
            &StoredTokens {
                access_token: Secret::new("access"),
                access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
                refresh_token: Secret::new("refresh"),
                refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
            },
        )
        .unwrap();
    let dyn_tokens: Arc<dyn TokenStore> = tokens;
    let engine = Arc::new(SyncEngine::new(
        FakeApi::default(),
        store,
        dyn_tokens,
        PROFILE,
    ));
    Fixture { _dir: dir, engine }
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
    let runs = f.engine.api().manifests.load(Ordering::SeqCst);
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
    let kept = f.engine.outbox().list().unwrap().len();
    assert!(
        result.is_err() || kept == 1,
        "enqueue reported success but sign-out deleted the entry"
    );
}
