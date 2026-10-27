//! Second-round regression tests for the client findings (Astra review of
//! PR #11, `.orchestra/astra-c-fixes.md`). Each test states the required
//! behaviour; they fail until the fix lands. The migration test is a guard
//! (passes today).

mod engine_support;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use engine_support::*;
use keystone_sync::auth::{
    MemoryTokenStore, Session, SessionRecord, StoredTokens, TokenStore, TokenWrite,
};
use keystone_sync::client::{ApiConfig, ClientOptions, HttpClient};
use keystone_sync::conflicts::ResolutionAction;
use keystone_sync::engine::{SyncEngine, Trigger};
use keystone_sync::error::{Result, SyncError};
use keystone_sync::outbox::{Outbox, OutboxQueue};
use keystone_sync::store::{DbKey, ListQuery, Migration, MirrorStore, Store, migrations};
use keystone_sync::wire::{ConflictChoice, MutationOp, ResourceRow};
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const PULL: &str = "/api/v1/sync/pull";
const PUSH: &str = "/api/v1/sync/push";
const REFRESH: &str = "/api/v1/auth/device/refresh";

fn server_row(id: Uuid, version: u64, fields: Value) -> ResourceRow {
    serde_json::from_value(row(&id.to_string(), version, fields)).unwrap()
}

fn version_of(store: &Store, id: Uuid) -> Option<u64> {
    store
        .get_row(&name("parties"), id)
        .unwrap()
        .and_then(|r| r.version)
}

fn token_body(n: u8) -> Value {
    json!({"data": {
        "token": format!("access-{n}-0123456789abcdef"),
        "expires_at": "2026-10-26T10:15:00+03:00",
        "refresh_token": format!("refresh-{n}-0123456789abcdef"),
        "refresh_expires_at": "2026-11-25T09:15:00+03:00",
    }})
}

/// Manifest: call 0 answers 200, call `fail_at` answers `failure`, the rest 200.
async fn manifest_failing_once(
    env_server: &wiremock::MockServer,
    fail_at: usize,
    failure: ResponseTemplate,
) {
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            if calls.fetch_add(1, Ordering::SeqCst) == fail_at {
                failure.clone()
            } else {
                ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"]))
            }
        })
        .mount(env_server)
        .await;
}

// ------------------------------------------------------------- (1) ----

/// Push `applied` v2 is written; the pull of the same run (same base: the
/// push write moves neither cursor nor epoch) carries an older v1 of the
/// row. The page must not roll the row back.
#[tokio::test]
async fn r2_pull_page_does_not_roll_back_a_newer_push_write() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    let id = Uuid::now_v7();
    let pulls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("POST"))
        .and(path(PULL))
        .respond_with(move |_: &Request| {
            let rows = if pulls.fetch_add(1, Ordering::SeqCst) == 0 {
                vec![]
            } else {
                vec![row(&id.to_string(), 1, json!({"name": "Eski"}))]
            };
            ResponseTemplate::new(200).set_body_json(pull_response(vec![page(
                "parties",
                rows,
                vec![],
                cursor(1000, None, 0, None),
                false,
            )]))
        })
        .mount(&env.server)
        .await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(|request: &Request| {
            let results: Vec<Value> = body(request)["mutations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| {
                    json!({"idempotency_key": m["idempotency_key"], "resource": m["resource"],
                           "id": m["id"], "status": "applied", "replayed": false, "version": 2,
                           "data": row(m["id"].as_str().unwrap(), 2, json!({"name": "Benim"}))})
                })
                .collect();
            ResponseTemplate::new(200)
                .set_body_json(json!({"data": {"results": results}, "meta": {}}))
        })
        .mount(&env.server)
        .await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    env.store
        .put_row(
            &name("parties"),
            &server_row(id, 1, json!({"name": "Eski"})),
        )
        .unwrap();
    e.enqueue(draft(
        MutationOp::Update,
        "parties",
        id,
        json!({"name": "Benim"}),
    ))
    .unwrap();

    e.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(
        version_of(&env.store, id),
        Some(2),
        "R2-1: an older pull row must not roll back the newer push write"
    );
}

// ------------------------------------------------------------- (2) ----

/// `take_server` on three VERSION_CONFLICTs whose `server_data` is v5:
/// - A: local still v3 → the engine applies v5;
/// - B: a newer pull made it v7 → stays v7 (no rollback);
/// - C: removed meanwhile (tombstone) → stays absent (no resurrection).
#[tokio::test]
async fn r2_take_server_is_applied_by_the_engine_with_the_version_rule() {
    let env = env().await;
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(|request: &Request| {
            let results: Vec<Value> = body(request)["mutations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| {
                    let id = m["id"].as_str().unwrap();
                    json!({"idempotency_key": m["idempotency_key"], "resource": m["resource"],
                           "id": id, "status": "conflict", "replayed": false, "conflict": {
                               "code": "VERSION_CONFLICT", "base_version": 3, "server_version": 5,
                               "conflicting_fields": ["name"],
                               "server_data": row(id, 5, json!({"name": "Sunucu"})),
                               "choices": ["keep_mine", "take_server", "merge"]}})
                })
                .collect();
            ResponseTemplate::new(200)
                .set_body_json(json!({"data": {"results": results}, "meta": {}}))
        })
        .mount(&env.server)
        .await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    let parties = name("parties");
    let (a, b, c) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    for id in [a, b, c] {
        env.store
            .put_row(&parties, &server_row(id, 3, json!({"name": "Eski"})))
            .unwrap();
        let mut update = draft(MutationOp::Update, "parties", id, json!({"name": "Benim"}));
        update.base_version = Some(3);
        e.enqueue(update).unwrap();
    }
    e.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(e.status().conflicts, 3);
    env.store
        .put_row(&parties, &server_row(b, 7, json!({"name": "Web"})))
        .unwrap();
    env.store.remove_row(&parties, c).unwrap();

    for record in e.conflict_records().unwrap() {
        let action = e
            .resolve_conflict(record.idempotency_key, ConflictChoice::TakeServer)
            .unwrap();
        assert!(matches!(action, ResolutionAction::TakeServer(_)));
    }
    assert_eq!(version_of(&env.store, b), Some(7), "R2-2: no rollback");
    assert_eq!(version_of(&env.store, c), None, "R2-2: no resurrection");
    assert_eq!(
        version_of(&env.store, a),
        Some(5),
        "R2-2: the engine applies take_server itself (version-checked)"
    );
}

// ------------------------------------------------------------- (3) ----

/// 401 → the refresh succeeds → the request with the new token is 401
/// again (device revoked between the two): the final 401 closes reads even
/// though fresh tokens are stored.
#[tokio::test]
async fn r2_a_401_after_a_successful_refresh_closes_local_reads() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"]))
            } else {
                ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED", "revoked"))
            }
        })
        .mount(&env.server)
        .await;
    Mock::given(method("POST"))
        .and(path(REFRESH))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_body(2)))
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        &Uuid::now_v7().to_string(),
        json!({"name": "Cari"}),
    );

    let error = e.run_once(Trigger::Timer).await.unwrap_err();
    assert_eq!(error.code(), "UNAUTHENTICATED");
    assert!(
        env.tokens.load(PROFILE).unwrap().is_some(),
        "precondition: the refreshed tokens are stored"
    );
    let read = e.list(&name("parties"), &ListQuery::default());
    assert!(
        matches!(read, Err(SyncError::OfflineUnavailable(_))),
        "R2-3: the final 401 must close reads, got {read:?}"
    );
}

// ------------------------------------------------------------- (4) ----

/// The local data belongs to company A; the profile is then configured for
/// company B and B answers 403 COMPANY_FORBIDDEN. That says nothing about A:
/// A's mirror must not be deleted.
#[tokio::test]
async fn r2_company_forbidden_for_another_company_keeps_the_local_mirror() {
    let env = env().await;
    manifest_failing_once(
        &env.server,
        1,
        ResponseTemplate::new(403).set_body_json(error_body("COMPANY_FORBIDDEN", "not a member")),
    )
    .await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        &Uuid::now_v7().to_string(),
        json!({"name": "A cari"}),
    );

    let client_b = HttpClient::new(
        &ApiConfig {
            base_url: env.server.uri(),
            company_id: Uuid::parse_str("0192f5a0-0000-7000-8000-0000000000bb").unwrap(),
            user_agent: "keystone-desktop-test".into(),
        },
        PROFILE,
        env.tokens.clone(),
        &ClientOptions {
            connect_timeout: Duration::from_secs(2),
            request_timeout: Duration::from_secs(10),
            allow_http_localhost: true,
        },
    )
    .unwrap();
    let engine_b = SyncEngine::new(client_b, env.store.clone());
    let error = engine_b.run_once(Trigger::Startup).await.unwrap_err();
    assert_eq!(error.code(), "COMPANY_FORBIDDEN");
    assert_eq!(
        env.store.row_count(&name("parties")).unwrap(),
        1,
        "R2-4: B's 403 must not delete company A's mirror"
    );
}

// ------------------------------------------------------------- (5) ----

/// Token store that, once armed with `n`, completes a new sign-in (through
/// the profile's `Session`, so it honours `Session::hold`) inside the `n`-th
/// record read that follows, and notes how many mirror rows existed when
/// that sign-in completed.
struct Racing {
    inner: Arc<MemoryTokenStore>,
    armed: AtomicUsize,
    store: OnceLock<Arc<Store>>,
    rows_at_sign_in: Arc<Mutex<Option<u64>>>,
}

impl TokenStore for Racing {
    fn identity(&self) -> String {
        self.inner.identity()
    }
    fn load_record(&self, profile: &str) -> Result<SessionRecord> {
        let record = self.inner.load_record(profile)?;
        if self
            .armed
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
            == Ok(1)
        {
            let inner: Arc<dyn TokenStore> = self.inner.clone();
            let store = self.store.get().cloned();
            let seen = self.rows_at_sign_in.clone();
            let (done, wait) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(Session::shared(PROFILE, inner).sign_in(&tokens(5)))
                    .unwrap();
                if let Some(store) = store {
                    *seen.lock().unwrap() = Some(store.row_count(&name("parties")).unwrap());
                }
                let _ = done.send(());
            });
            // Blocks only while the engine holds off sign-ins.
            let _ = wait.recv_timeout(Duration::from_millis(500));
        }
        Ok(record)
    }
    fn load(&self, profile: &str) -> Result<Option<StoredTokens>> {
        self.inner.load(profile)
    }
    fn save(&self, w: &TokenWrite, profile: &str, tokens: &StoredTokens) -> Result<()> {
        self.inner.save(w, profile, tokens)
    }
    fn clear(&self, w: &TokenWrite, profile: &str) -> Result<()> {
        self.inner.clear(w, profile)
    }
    fn take(&self, w: &TokenWrite, profile: &str) -> Result<Option<StoredTokens>> {
        self.inner.take(w, profile)
    }
    fn sign_in(&self, w: &TokenWrite, profile: &str, tokens: &StoredTokens) -> Result<u64> {
        self.inner.sign_in(w, profile, tokens)
    }
    fn deactivate(&self, w: &TokenWrite, profile: &str, expected: u64) -> Result<bool> {
        self.inner.deactivate(w, profile, expected)
    }
    fn sign_out(&self, w: &TokenWrite, profile: &str, expected: u64) -> Result<bool> {
        self.inner.sign_out(w, profile, expected)
    }
}

/// The 403 belongs to the old sign-in; a new sign-in completes right after
/// the engine's generation check. Either the sign-in waits for the seal
/// (no mirror rows left when it completes) or the stale 403 must not seal:
/// a mirror that was intact when the new sign-in completed stays intact.
/// `fire_on` 1: the sign-in completes inside the first record read after the
/// 403 (the generation check); 2: inside the second one (a re-check).
async fn stale_403_race(fire_on: usize) {
    let racing = Arc::new(Racing {
        inner: Arc::new(MemoryTokenStore::default()),
        armed: AtomicUsize::new(0),
        store: OnceLock::new(),
        rows_at_sign_in: Arc::default(),
    });
    let env = env_on(racing.clone(), Duration::from_secs(10)).await;
    let _ = racing.store.set(env.store.clone());
    let calls = Arc::new(AtomicUsize::new(0));
    let arm = racing.clone();
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            if calls.fetch_add(1, Ordering::SeqCst) == 1 {
                arm.armed.store(fire_on, Ordering::SeqCst);
                ResponseTemplate::new(403)
                    .set_body_json(error_body("COMPANY_FORBIDDEN", "not a member"))
            } else {
                ResponseTemplate::new(200).set_body_json(simple_manifest(&["parties"]))
            }
        })
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    put_row(
        &env.store,
        "parties",
        &Uuid::now_v7().to_string(),
        json!({"name": "Cari"}),
    );

    let _ = e.run_once(Trigger::Timer).await;
    // The racing sign-in may still wait for the engine to let it in.
    let mut at_sign_in = None;
    for _ in 0..100 {
        at_sign_in = *racing.rows_at_sign_in.lock().unwrap();
        if at_sign_in.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let at_sign_in = at_sign_in.expect("precondition: the racing sign-in ran");
    let now = env.store.row_count(&name("parties")).unwrap();
    assert!(
        at_sign_in == 0 || now == at_sign_in,
        "R2-5: the 403 of the old sign-in sealed after the new sign-in completed \
         (rows at sign-in {at_sign_in}, now {now})"
    );
}

#[tokio::test]
async fn r2_a_sign_in_during_the_generation_check_stops_a_stale_403_seal() {
    stale_403_race(1).await;
}

#[tokio::test]
async fn r2_a_sign_in_during_the_generation_recheck_stops_a_stale_403_seal() {
    stale_403_race(2).await;
}

// ------------------------------------------------------------- (6) ----

/// After a deactivation seal, a raw `Outbox` over the same store must not
/// hand out the sealed payloads, nor select them for sending.
#[tokio::test]
async fn r2_sealed_outbox_is_not_readable_or_sendable_through_a_raw_outbox() {
    let env = env().await;
    manifest_failing_once(
        &env.server,
        1,
        ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED", "inactive")),
    )
    .await;
    mount_empty_pull(&env.server).await;
    let e = &env.engine;
    e.run_once(Trigger::Startup).await.unwrap();
    e.enqueue(draft(
        MutationOp::Create,
        "parties",
        Uuid::now_v7(),
        json!({"name": "Gizli taslak"}),
    ))
    .unwrap();
    assert_eq!(
        e.run_once(Trigger::Timer).await.unwrap_err().code(),
        "USER_DEACTIVATED"
    );
    assert!(
        e.outbox_entries().is_err(),
        "precondition: sealed for the engine"
    );

    let raw = Outbox::new(env.store.clone());
    let listed = raw.list();
    assert!(
        !matches!(&listed, Ok(entries) if !entries.is_empty()),
        "R2-6: a raw Outbox lists sealed payloads: {listed:?}"
    );
    let batch = raw.next_batch(10);
    assert!(
        !matches!(&batch, Ok(b) if !b.is_empty()),
        "R2-6: a raw Outbox selects sealed mutations for sending: {batch:?}"
    );
}

// ----------------------------------------------------------- migration --

/// Guard: a database created by a build without migration 11 (every other
/// migration applied, mirror and outbox data present) opens with the full
/// registry, gets 11, keeps its data, and reopens cleanly.
#[test]
fn r2_migration_11_upgrades_an_existing_database_and_reopens() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("upgrade.db");
    let key = DbKey::from_bytes([7; 32]);
    let full = migrations::registry();
    let before: Vec<&Migration> = full.iter().copied().filter(|m| m.id != 11).collect();
    assert_eq!(full.len(), before.len() + 1, "migration 11 is registered");
    let id = Uuid::now_v7();
    {
        let store = Arc::new(Store::open_with_migrations(&path, &key, &before).unwrap());
        // Written as that build wrote it: a registered mirror table and its row.
        let parties = name("parties");
        store
            .register(&keystone_sync::store::ResourceSpec::new(parties.clone()))
            .unwrap();
        let table = store.mirror_table(&parties).unwrap().unwrap();
        let data = serde_json::to_string(&row(&id.to_string(), 4, json!({"name": "Var"}))).unwrap();
        store
            .write(|tx| {
                tx.execute(
                    &format!("INSERT INTO \"{table}\" (id, version, data) VALUES (?1, 4, ?2)"),
                    rusqlite::params![id.to_string(), data],
                )?;
                Ok(())
            })
            .unwrap();
        Outbox::new(store.clone())
            .enqueue(draft(
                MutationOp::Update,
                "parties",
                id,
                json!({"name": "Yeni"}),
            ))
            .unwrap();
        assert!(
            !store
                .applied_migrations()
                .unwrap()
                .iter()
                .any(|(m, _)| *m == 11)
        );
    }
    {
        let store = Arc::new(Store::open(&path, &key).unwrap());
        let ledger = store.applied_migrations().unwrap();
        assert!(ledger.contains(&(11, "local_create_presence".to_owned())));
        assert_eq!(version_of(&store, id), Some(4));
        let outbox = Outbox::new(store.clone());
        assert_eq!(outbox.list().unwrap().len(), 1);
        // The new table is usable: an offline create records its presence.
        outbox
            .enqueue(draft(
                MutationOp::Create,
                "parties",
                Uuid::now_v7(),
                json!({"name": "C"}),
            ))
            .unwrap();
        assert_eq!(outbox.list().unwrap().len(), 2);
    }
    let store = Store::open(&path, &key).unwrap();
    assert_eq!(store.applied_migrations().unwrap().len(), full.len());
}
