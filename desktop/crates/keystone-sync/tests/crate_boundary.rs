//! D3 crate prerequisites: the sealed raw outbox, the database key wipe,
//! the offline write policy and the offline manifest version check.
//!
//! The shell reaches the crate like the doctests of `lib.rs` do: without the
//! `raw-store` feature, `Store::read`, `Outbox::new` and the other raw
//! accessors do not compile there. This file opts into `raw-store` (through
//! the crate's own dev-dependency) to set up states the shell cannot reach.

mod engine_support;

use std::sync::Arc;
use std::time::Duration;

use engine_support::*;
use keystone_sync::SyncError;
use keystone_sync::auth::MemoryTokenStore;
use keystone_sync::client::{ApiConfig, ClientOptions, HttpClient};
use keystone_sync::engine::{SyncEngine, Trigger};
use keystone_sync::outbox::{Outbox, OutboxQueue};
use keystone_sync::store::raw::{RawOutbox, RawStore};
use keystone_sync::store::{DbKey, OfflineManifest, Store, offline_manifest};
use keystone_sync::wire::MutationOp;
use serde_json::{Value, json};
use uuid::Uuid;

const MANIFEST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../contracts/offline-manifest.json"
));

fn shipped() -> OfflineManifest {
    offline_manifest(MANIFEST).expect("offline manifest")
}

fn seal(store: &Store, sealed: bool) {
    store
        .write(|tx| {
            if sealed {
                tx.execute(
                    "INSERT OR REPLACE INTO engine_meta (key, value) VALUES ('work_sealed', '1')",
                    [],
                )?;
            } else {
                tx.execute("DELETE FROM engine_meta WHERE key = 'work_sealed'", [])?;
            }
            Ok(())
        })
        .unwrap();
}

#[test]
fn sealed_work_refuses_discard_retry_and_enqueue() {
    let dir = tempfile::tempdir().unwrap();
    let store =
        Arc::new(Store::open(dir.path().join("s.db"), &DbKey::from_bytes([3; 32])).unwrap());
    let outbox = Outbox::new(store.clone());
    let key = outbox
        .enqueue(draft(
            MutationOp::Create,
            "parties",
            Uuid::now_v7(),
            json!({"name": "A"}),
        ))
        .unwrap();
    store
        .write(|tx| {
            tx.execute(
                "UPDATE outbox_entries SET state = 'rejected' WHERE key = ?1",
                [key.to_string()],
            )?;
            Ok(())
        })
        .unwrap();

    seal(&store, true);
    let offline = |r: keystone_sync::Result<()>| matches!(r, Err(SyncError::OfflineUnavailable(_)));
    assert!(offline(outbox.discard(key)), "discard while sealed");
    assert!(offline(outbox.retry(key)), "retry while sealed");
    let enqueued = outbox.enqueue_outcome(draft(
        MutationOp::Create,
        "parties",
        Uuid::now_v7(),
        json!({"name": "B"}),
    ));
    assert!(
        matches!(enqueued, Err(SyncError::OfflineUnavailable(_))),
        "enqueue while sealed: {enqueued:?}"
    );

    // The sealed entry is still there and usable once the seal is lifted.
    seal(&store, false);
    assert_eq!(outbox.list().unwrap().len(), 1);
    outbox.retry(key).unwrap();
}

#[test]
fn db_key_bytes_are_zero_after_drop() {
    let mut slot = std::mem::MaybeUninit::new(DbKey::from_bytes([0xA5; 32]));
    // SAFETY: `slot` holds an initialised key that is dropped exactly once
    // here and never used as a `DbKey` afterwards. `DbKey` is
    // `repr(transparent)` over `[u8; 32]`, so its storage can be read as
    // bytes, which every bit pattern is valid for.
    let after: [u8; 32] = unsafe {
        slot.as_mut_ptr().drop_in_place();
        std::ptr::read(slot.as_ptr().cast::<[u8; 32]>())
    };
    assert_eq!(after, [0; 32]);
}

#[test]
fn offline_manifest_reads_version_and_write_policies() {
    let manifest = shipped();
    assert_eq!(manifest.manifest_version, 2);
    let spec = |name: &str| {
        manifest
            .specs
            .iter()
            .find(|s| s.resource.as_str() == name)
            .unwrap_or_else(|| panic!("{name}"))
            .clone()
    };
    let requests = spec("purchase-requests").write.expect("write policy");
    let draft_only = requests.draft_only.expect("draft_only");
    assert_eq!(draft_only.field, "status");
    assert_eq!(draft_only.value, "draft");
    assert_eq!(draft_only.also, ["rejected"]);
    let stock = spec("stock-documents").write.expect("write policy");
    assert_eq!(stock.target_constraints["doc_type"], ["count"]);
    assert!(
        stock
            .ops
            .iter()
            .any(|op| op.op == MutationOp::Action && op.action.as_deref() == Some("counts"))
    );
    // A resource without `write` is read-only offline; a child too.
    assert!(spec("items").write.expect("policy").ops.is_empty());
    assert!(spec("items.variants").write.expect("policy").ops.is_empty());
}

/// Engine over the shipped offline manifest, signed in, not synced yet.
async fn shipped_env() -> Env {
    let mut env = env().await;
    let tokens: Arc<MemoryTokenStore> = env.tokens.clone();
    let client = HttpClient::new(
        &ApiConfig {
            base_url: env.server.uri(),
            company_id: Uuid::parse_str(COMPANY).unwrap(),
            user_agent: "keystone-desktop-test".into(),
        },
        PROFILE,
        tokens,
        &ClientOptions {
            connect_timeout: Duration::from_secs(2),
            request_timeout: Duration::from_secs(10),
            allow_http_localhost: true,
        },
    )
    .unwrap();
    env.engine =
        Arc::new(SyncEngine::new(client, env.store.clone()).with_offline_manifest(shipped()));
    env
}

fn server_manifest(offline_version: u32) -> Value {
    let mut body = simple_manifest(&["purchase-requests", "sales-quotes", "items"]);
    body["data"]["offline_manifest_version"] = json!(offline_version);
    body
}

async fn synced(env: &Env, offline_version: u32) {
    env.server.reset().await;
    mount_manifest(&env.server, server_manifest(offline_version)).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
}

fn code(result: keystone_sync::Result<impl std::fmt::Debug>) -> &'static str {
    match result {
        Ok(value) => panic!("expected an error, got {value:?}"),
        Err(error) => error.code(),
    }
}

#[tokio::test]
async fn write_policy_is_applied_locally_on_enqueue() {
    let env = shipped_env().await;
    synced(&env, 2).await;
    let e = &env.engine;

    let requests = name("purchase-requests");
    let policy = e.write_policy(&requests).expect("policy");
    assert_eq!(policy.draft_only.expect("draft_only").also, ["rejected"]);

    let rejected = Uuid::now_v7();
    put_row(
        &env.store,
        "purchase-requests",
        &rejected.to_string(),
        json!({"status": "rejected"}),
    );
    e.enqueue(draft(
        MutationOp::Update,
        "purchase-requests",
        rejected,
        json!({"note": "fixed"}),
    ))
    .expect("a rejected request stays editable");

    let sent = Uuid::now_v7();
    put_row(
        &env.store,
        "sales-quotes",
        &sent.to_string(),
        json!({"status": "sent"}),
    );
    let locked = e.enqueue(draft(
        MutationOp::Update,
        "sales-quotes",
        sent,
        json!({"note": "late"}),
    ));
    assert_eq!(code(locked), "DOCUMENT_LOCKED");
    assert_eq!(
        code(e.enqueue(draft(MutationOp::Delete, "sales-quotes", sent, json!({})))),
        "DOCUMENT_LOCKED"
    );

    let open = Uuid::now_v7();
    put_row(
        &env.store,
        "sales-quotes",
        &open.to_string(),
        json!({"status": "draft"}),
    );
    e.enqueue(draft(
        MutationOp::Update,
        "sales-quotes",
        open,
        json!({"note": "ok"}),
    ))
    .expect("a draft quote is editable");

    // `items` has no offline write in the manifest.
    assert_eq!(
        code(e.enqueue(draft(
            MutationOp::Create,
            "items",
            Uuid::now_v7(),
            json!({"name": "x"})
        ))),
        "SYNC_OFFLINE_WRITE_NOT_ALLOWED"
    );

    let queued: Vec<Uuid> = e
        .outbox_entries()
        .unwrap()
        .iter()
        .map(|entry| entry.mutation.id)
        .collect();
    assert_eq!(queued, [rejected, open]);
}

#[tokio::test]
async fn manifest_version_mismatch_closes_offline_writes() {
    let env = shipped_env().await;
    assert_eq!(env.engine.offline_manifest_version(), Some(2));
    assert!(!env.engine.status().manifest_mismatch);

    synced(&env, 3).await;
    assert!(env.engine.status().manifest_mismatch);
    let id = Uuid::now_v7();
    put_row(
        &env.store,
        "sales-quotes",
        &id.to_string(),
        json!({"status": "draft"}),
    );
    let refused = env.engine.enqueue(draft(
        MutationOp::Update,
        "sales-quotes",
        id,
        json!({"note": "x"}),
    ));
    assert_eq!(code(refused), "SYNC_OFFLINE_WRITE_NOT_ALLOWED");
    // Reads keep working.
    assert!(env.engine.get(&name("sales-quotes"), id).unwrap().is_some());

    synced(&env, 2).await;
    assert!(!env.engine.status().manifest_mismatch);
    env.engine
        .enqueue(draft(
            MutationOp::Update,
            "sales-quotes",
            id,
            json!({"note": "x"}),
        ))
        .expect("writes reopen once the versions match");
}

#[test]
fn use_existing_drops_the_local_create_mark() {
    use keystone_sync::conflicts::{ConflictInbox, ConflictStore, allowed_choices};
    use keystone_sync::store::raw::RawConflictStore;
    use keystone_sync::wire::{Conflict, ConflictCode, PushResult, PushStatus};

    let dir = tempfile::tempdir().unwrap();
    let store =
        Arc::new(Store::open(dir.path().join("s.db"), &DbKey::from_bytes([4; 32])).unwrap());
    let outbox = Outbox::new(store.clone());
    let inbox = ConflictStore::new(store.clone());
    let id = Uuid::now_v7();
    outbox
        .enqueue(draft(
            MutationOp::Create,
            "parties",
            id,
            json!({"name": "A"}),
        ))
        .unwrap();
    let marked = |store: &Store| -> bool {
        store
            .read(|conn| {
                Ok(conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM store_local_creates WHERE id = ?1)",
                    [id.to_string()],
                    |r| r.get(0),
                )?)
            })
            .unwrap()
    };
    assert!(marked(&store));
    let m = outbox.next_batch(1).unwrap().remove(0);
    let candidate = Uuid::now_v7();
    outbox
        .record_results(&[PushResult {
            idempotency_key: m.idempotency_key,
            resource: m.resource.clone(),
            id: m.id,
            status: PushStatus::Conflict,
            replayed: false,
            version: None,
            data: None,
            merged_fields: None,
            conflict: Some(Conflict {
                code: ConflictCode::DuplicateRecord,
                message: None,
                base_version: None,
                server_version: None,
                conflicting_fields: vec![],
                server_data: None,
                candidates: Some(vec![candidate]),
                choices: allowed_choices(ConflictCode::DuplicateRecord).to_vec(),
            }),
            error: None,
        }])
        .unwrap();
    inbox
        .resolve_use_existing(m.idempotency_key, candidate)
        .unwrap();
    assert!(!marked(&store), "use_existing leaves no orphan create mark");
}
