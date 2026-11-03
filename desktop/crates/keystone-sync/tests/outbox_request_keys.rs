//! Request keys (`Idempotency-Key`) of offline writes: recorded with the
//! draft in one transaction, answering repeats after the push settled the
//! draft, gone with every wipe and after their retention.

mod engine_support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use engine_support::*;
use keystone_sync::engine::Trigger;
use keystone_sync::outbox::{EnqueueOutcome, KeyedOutcome, Outbox, OutboxQueue, RequestKey};
use keystone_sync::store::migrations::{Migration, registry};
use keystone_sync::store::raw::prelude::*;
use keystone_sync::store::{DbKey, Store};
use keystone_sync::wire::MutationOp;
use serde_json::{Value, json};
use uuid::Uuid;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

const MANIFEST: &str = "/api/v1/sync/manifest";
const PUSH: &str = "/api/v1/sync/push";

fn key(name: &str) -> RequestKey {
    RequestKey {
        key: name.to_owned(),
        fingerprint: "request-1".to_owned(),
    }
}

fn create(id: Uuid) -> keystone_sync::outbox::NewMutation {
    draft(MutationOp::Create, "parties", id, json!({"name": "A"}))
}

fn stored_keys(env: &Env) -> i64 {
    env.store
        .read(|conn| {
            Ok(conn.query_row("SELECT count(*) FROM outbox_request_keys", [], |r| r.get(0))?)
        })
        .unwrap()
}

/// One run so the local data is verified for the sign-in.
async fn verified(env: &Env) {
    mount_manifest(&env.server, simple_manifest(&["parties"])).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
}

async fn mount_applied(env: &Env) {
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(apply_all)
        .mount(&env.server)
        .await;
}

/// Manifest answers by call: `first` for the first `switch_at`, then `then`.
async fn mount_changing(env: &Env, switch_at: usize, first: Value, then: Value) {
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            let body = if calls.fetch_add(1, Ordering::SeqCst) < switch_at {
                first.clone()
            } else {
                then.clone()
            };
            ResponseTemplate::new(200).set_body_json(body)
        })
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
}

#[tokio::test]
async fn a_repeated_key_queues_nothing() {
    let env = env().await;
    verified(&env).await;
    let id = Uuid::now_v7();

    let first = env.engine.enqueue_keyed(create(id), &key("k")).unwrap();
    let second = env
        .engine
        .enqueue_keyed(create(Uuid::now_v7()), &key("k"))
        .unwrap();

    assert!(matches!(
        first,
        KeyedOutcome::New(EnqueueOutcome::Queued(_))
    ));
    let KeyedOutcome::Repeat(record) = second else {
        panic!("{second:?}");
    };
    assert_eq!((record.id, record.cancelled), (id, false));
    assert_eq!(record.resource, name("parties"));
    assert_eq!(outbox_list(&env.store).len(), 1);
}

#[tokio::test]
async fn the_record_outlives_the_push() {
    let env = env().await;
    verified(&env).await;
    mount_applied(&env).await;
    let id = Uuid::now_v7();
    env.engine.enqueue_keyed(create(id), &key("k")).unwrap();

    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert!(outbox_list(&env.store).is_empty());

    let record = env.engine.request_record(&key("k")).unwrap().unwrap();
    assert_eq!(record.id, id);
    assert!(matches!(
        env.engine.enqueue_keyed(create(id), &key("k")).unwrap(),
        KeyedOutcome::Repeat(_)
    ));
    assert!(outbox_list(&env.store).is_empty());
    assert_eq!(hits(&env.server, PUSH).await, 1);
}

#[tokio::test]
async fn a_key_used_for_another_request_is_refused() {
    let env = env().await;
    verified(&env).await;
    mount_applied(&env).await;
    let other = RequestKey {
        fingerprint: "request-2".to_owned(),
        ..key("k")
    };
    let id = Uuid::now_v7();
    env.engine.enqueue_keyed(create(id), &key("k")).unwrap();

    for _ in 0..2 {
        let error = env
            .engine
            .enqueue_keyed(create(Uuid::now_v7()), &other)
            .unwrap_err();
        assert_eq!(error.code(), "IDEMPOTENCY_KEY_REUSED");
        let error = env.engine.request_record(&other).unwrap_err();
        assert_eq!(error.code(), "IDEMPOTENCY_KEY_REUSED");
        // Once queued, once after the push.
        env.engine.run_once(Trigger::Manual).await.unwrap();
    }
    assert_eq!(hits(&env.server, PUSH).await, 1);
}

#[tokio::test]
async fn a_cancelled_create_stays_cancelled() {
    let env = env().await;
    verified(&env).await;
    let id = Uuid::now_v7();
    env.engine.enqueue(create(id)).unwrap();
    let delete = || draft(MutationOp::Delete, "parties", id, json!({}));

    let first = env.engine.enqueue_keyed(delete(), &key("d")).unwrap();
    let second = env.engine.enqueue_keyed(delete(), &key("d")).unwrap();

    assert!(matches!(
        first,
        KeyedOutcome::New(EnqueueOutcome::Cancelled(_))
    ));
    let KeyedOutcome::Repeat(record) = second else {
        panic!("{second:?}");
    };
    assert!(record.cancelled);
    assert!(outbox_list(&env.store).is_empty());
}

#[tokio::test]
async fn a_coalesced_draft_keeps_every_key() {
    let env = env().await;
    verified(&env).await;
    let id = Uuid::now_v7();
    let update = draft(MutationOp::Update, "parties", id, json!({"name": "B"}));

    env.engine.enqueue_keyed(create(id), &key("c")).unwrap();
    env.engine.enqueue_keyed(update, &key("u")).unwrap();

    assert_eq!(outbox_list(&env.store).len(), 1);
    assert_eq!(stored_keys(&env), 2);
    for name in ["c", "u"] {
        let record = env.engine.request_record(&key(name)).unwrap().unwrap();
        assert_eq!(record.id, id);
    }
}

#[tokio::test]
async fn a_refused_draft_records_no_key() {
    let env = env().await;
    verified(&env).await;
    let invalid = draft(MutationOp::Update, "parties", Uuid::now_v7(), json!({}));

    assert!(env.engine.enqueue_keyed(invalid, &key("k")).is_err());

    assert_eq!(env.engine.request_record(&key("k")).unwrap(), None);
    assert_eq!(stored_keys(&env), 0);
}

#[tokio::test]
async fn a_record_follows_a_replaced_identity() {
    let env = env().await;
    verified(&env).await;
    let (old, new) = (Uuid::now_v7(), Uuid::now_v7());
    env.engine.enqueue_keyed(create(old), &key("k")).unwrap();
    env.store
        .write(|tx| {
            tx.execute(
                "INSERT INTO outbox_id_remaps(old_id,new_id) VALUES (?1,?2)",
                [old.to_string(), new.to_string()],
            )?;
            Ok(())
        })
        .unwrap();

    let record = env.engine.request_record(&key("k")).unwrap().unwrap();

    assert_eq!(record.id, new);
}

#[tokio::test]
async fn sign_out_removes_the_keys() {
    let env = env().await;
    verified(&env).await;
    env.engine
        .enqueue_keyed(create(Uuid::now_v7()), &key("k"))
        .unwrap();

    env.engine.sign_out(true).await.unwrap();

    assert_eq!(stored_keys(&env), 0);
    sign_in_as(&env.tokens, 2).await;
    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(env.engine.request_record(&key("k")).unwrap(), None);
}

#[tokio::test]
async fn another_user_finds_no_key() {
    let env = env().await;
    let manifest_of = |user| manifest(user, vec![resource("parties", 0)], 200, 100);
    mount_changing(&env, 1, manifest_of(USER_A), manifest_of(USER_B)).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine
        .enqueue_keyed(create(Uuid::now_v7()), &key("k"))
        .unwrap();

    sign_in_as(&env.tokens, 3).await;
    assert_eq!(
        env.engine.request_record(&key("k")).unwrap_err().code(),
        "OFFLINE_UNAVAILABLE",
        "nothing is answered before a run verified the sign-in"
    );
    env.engine.run_once(Trigger::Manual).await.unwrap();

    assert_eq!(env.engine.request_record(&key("k")).unwrap(), None);
    assert_eq!(stored_keys(&env), 0);
}

#[tokio::test]
async fn another_company_finds_no_key() {
    let env = env().await;
    let first = simple_manifest(&["parties"]);
    let mut then = first.clone();
    then["data"]["company_id"] = json!("0192f5a0-0000-7000-8000-000000000002");
    mount_changing(&env, 1, first, then).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    env.engine
        .enqueue_keyed(create(Uuid::now_v7()), &key("k"))
        .unwrap();

    env.engine.run_once(Trigger::Manual).await.unwrap();

    assert_eq!(env.engine.request_record(&key("k")).unwrap(), None);
    assert_eq!(stored_keys(&env), 0);
}

#[tokio::test]
async fn a_seal_closes_the_keys_and_the_same_identity_finds_them_again() {
    let env = env().await;
    let calls = Arc::new(AtomicUsize::new(0));
    let body = simple_manifest(&["parties"]);
    Mock::given(method("GET"))
        .and(path(MANIFEST))
        .respond_with(move |_: &Request| {
            if calls.fetch_add(1, Ordering::SeqCst) == 1 {
                return ResponseTemplate::new(403)
                    .set_body_json(error_body("COMPANY_FORBIDDEN", "no"));
            }
            ResponseTemplate::new(200).set_body_json(body.clone())
        })
        .mount(&env.server)
        .await;
    mount_empty_pull(&env.server).await;
    mount_applied(&env).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
    let id = Uuid::now_v7();
    env.engine.enqueue_keyed(create(id), &key("k")).unwrap();

    assert!(env.engine.run_once(Trigger::Manual).await.is_err());
    let error = env.engine.request_record(&key("k")).unwrap_err();
    assert_eq!(error.code(), "OFFLINE_UNAVAILABLE");
    assert_eq!(stored_keys(&env), 1);

    env.engine.run_once(Trigger::Manual).await.unwrap();

    let record = env.engine.request_record(&key("k")).unwrap().unwrap();
    assert_eq!(record.id, id);
}

#[tokio::test]
async fn keys_expire_after_their_retention() {
    let env = env().await;
    verified(&env).await;
    let (old, recent) = (Uuid::now_v7(), Uuid::now_v7());
    env.engine.enqueue_keyed(create(old), &key("old")).unwrap();
    env.engine
        .enqueue_keyed(create(recent), &key("recent"))
        .unwrap();
    env.store
        .write(|tx| {
            tx.execute(
                "UPDATE outbox_request_keys
                 SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days')
                 WHERE key = 'old'",
                [],
            )?;
            tx.execute(
                "UPDATE outbox_request_keys
                 SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days')
                 WHERE key = 'recent'",
                [],
            )?;
            Ok(())
        })
        .unwrap();

    env.engine
        .enqueue_keyed(create(Uuid::now_v7()), &key("new"))
        .unwrap();

    assert_eq!(env.engine.request_record(&key("old")).unwrap(), None);
    assert!(env.engine.request_record(&key("recent")).unwrap().is_some());
    assert_eq!(stored_keys(&env), 2);
}

#[tokio::test]
async fn a_rejection_stays_with_the_key_until_a_retry_or_a_discard() {
    let env = env().await;
    verified(&env).await;
    Mock::given(method("POST"))
        .and(path(PUSH))
        .respond_with(|request: &Request| {
            let m = &body(request)["mutations"][0];
            let error = json!({"message": "taken", "code": "VALIDATION_ERROR",
                               "fields": {"name": ["taken"]}});
            ResponseTemplate::new(200).set_body_json(json!({"data": {"results": [{
                "idempotency_key": m["idempotency_key"], "resource": m["resource"],
                "id": m["id"], "status": "rejected", "replayed": false, "error": error,
            }]}, "meta": {}}))
        })
        .mount(&env.server)
        .await;
    env.engine
        .enqueue_keyed(create(Uuid::now_v7()), &key("k"))
        .unwrap();
    let record = || env.engine.request_record(&key("k")).unwrap();
    assert_eq!(record().unwrap().rejection, None);

    env.engine.run_once(Trigger::Manual).await.unwrap();

    let rejection = record().unwrap().rejection.unwrap();
    assert_eq!(rejection.code.ui_code(), "VALIDATION_ERROR");
    assert_eq!(
        (rejection.message.as_str(), stored_keys(&env)),
        ("taken", 1)
    );
    let listed = &outbox_list(&env.store)[0];
    // The outbox entry carries the field messages for the user-facing queue.
    let fields = listed.rejection.as_ref().and_then(|e| e.fields.clone());
    assert_eq!(
        fields.and_then(|f| f.get("name").cloned()),
        Some(vec!["taken".to_owned()])
    );
    let entry = listed.mutation.idempotency_key;

    env.engine.retry(entry).unwrap();
    assert_eq!(record().unwrap().rejection, None);
    assert_eq!(outbox_list(&env.store)[0].rejection, None);

    env.engine.run_once(Trigger::Manual).await.unwrap();
    assert!(record().unwrap().rejection.is_some());

    env.engine.discard(entry).unwrap();
    assert_eq!(record(), None);
    assert_eq!(stored_keys(&env), 0);
}

#[tokio::test]
async fn an_expired_key_is_gone_for_reads_before_any_write() {
    let env = env().await;
    verified(&env).await;
    env.engine
        .enqueue_keyed(create(Uuid::now_v7()), &key("old"))
        .unwrap();
    env.store
        .write(|tx| {
            tx.execute(
                "UPDATE outbox_request_keys
                 SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days')",
                [],
            )?;
            Ok(())
        })
        .unwrap();

    assert_eq!(env.engine.request_record(&key("old")).unwrap(), None);
}

#[tokio::test]
async fn an_unreadable_rejection_body_costs_only_its_field_messages() {
    let env = env().await;
    verified(&env).await;
    env.engine
        .enqueue_keyed(create(Uuid::now_v7()), &key("bad"))
        .unwrap();
    env.engine
        .enqueue_keyed(create(Uuid::now_v7()), &key("good"))
        .unwrap();
    env.store
        .write(|tx| {
            tx.execute(
                "UPDATE outbox_request_keys SET rejection = 'not json' WHERE key = 'bad'",
                [],
            )?;
            tx.execute(
                "UPDATE outbox_request_keys
                 SET rejection = '{\"message\":\"m\",\"code\":\"VALIDATION_ERROR\",\"fields\":{\"name\":[\"taken\"]}}'
                 WHERE key = 'good'",
                [],
            )?;
            Ok(())
        })
        .unwrap();

    let entries = outbox_list(&env.store);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].rejection, None);
    assert!(
        entries[1]
            .rejection
            .as_ref()
            .is_some_and(|e| e.fields.is_some())
    );
}

#[test]
fn a_database_of_the_previous_version_is_upgraded_with_its_drafts() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("old.db");
    let db_key = DbKey::from_bytes([9; 32]);
    let previous: Vec<&Migration> = registry().into_iter().filter(|m| m.id != 102).collect();
    let id = Uuid::now_v7();

    let old = Arc::new(Store::open_with_migrations(&file, &db_key, &previous).unwrap());
    Outbox::new(old.clone()).enqueue(create(id)).unwrap();
    assert!(
        !old.applied_migrations()
            .unwrap()
            .iter()
            .any(|(number, _)| *number == 102)
    );
    drop(old);

    let store = Arc::new(Store::open(&file, &db_key).unwrap());

    let ledger = store.applied_migrations().unwrap();
    assert!(
        ledger
            .iter()
            .any(|(number, name)| *number == 102 && name == "request_keys"),
        "{ledger:?}"
    );
    assert_eq!(store.user_version().unwrap(), 300);
    let entries = Outbox::new(store.clone()).list().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].mutation.id, id);
    let count: i64 = store
        .read(|conn| {
            Ok(conn.query_row("SELECT count(*) FROM outbox_request_keys", [], |r| r.get(0))?)
        })
        .unwrap();
    assert_eq!(count, 0);
}
