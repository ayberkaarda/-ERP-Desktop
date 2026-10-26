use keystone_sync::conflicts::{ConflictInbox, ConflictStore, allowed_choices};
use keystone_sync::outbox::{
    EnqueueOutcome, MAX_ATTEMPTS, NewMutation, Outbox, OutboxQueue, OutboxState,
};
use keystone_sync::store::{DbKey, Store};
use keystone_sync::wire::*;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use uuid::Uuid;

fn setup() -> (tempfile::TempDir, Arc<Store>, Outbox) {
    let dir = tempfile::tempdir().unwrap();
    let store =
        Arc::new(Store::open(dir.path().join("queue.db"), &DbKey::from_bytes([17; 32])).unwrap());
    let outbox = Outbox::new(store.clone());
    (dir, store, outbox)
}
fn draft(op: MutationOp, id: Uuid, payload: Value) -> NewMutation {
    NewMutation {
        op,
        action: None,
        resource: ResourceName("sales-orders".into()),
        id,
        parent_id: None,
        base_version: (op != MutationOp::Create).then_some(3),
        payload: payload.as_object().unwrap().clone(),
        depends_on: vec![],
        occurred_at: Timestamp("2026-10-25T18:05:40+03:00".into()),
        resolution: None,
    }
}
fn result(m: &Mutation, status: PushStatus) -> PushResult {
    PushResult {
        idempotency_key: m.idempotency_key,
        resource: m.resource.clone(),
        id: m.id,
        status,
        replayed: status == PushStatus::Duplicate,
        version: Some(4),
        data: Some(Some(ResourceRow {
            id: m.id,
            version: Some(4),
            fields: Map::new(),
        })),
        merged_fields: None,
        conflict: None,
        error: None,
    }
}

#[test]
fn coalescing_create_update_and_create_delete() {
    let (_dir, _store, q) = setup();
    let id = Uuid::now_v7();
    let key = q
        .enqueue(draft(
            MutationOp::Create,
            id,
            json!({"notes":"a","lines":[1]}),
        ))
        .unwrap();
    assert_eq!(key.get_version_num(), 7);
    assert_eq!(
        q.enqueue(draft(MutationOp::Update, id, json!({"notes":"b"})))
            .unwrap(),
        key
    );
    let entries = q.list().unwrap();
    assert_eq!(entries[0].mutation.op, MutationOp::Create);
    assert_eq!(
        entries[0].mutation.payload,
        json!({"notes":"b","lines":[1]})
            .as_object()
            .unwrap()
            .clone()
    );
    assert!(entries[0].mutation.changed_fields.is_empty());
    assert_eq!(
        q.enqueue_outcome(draft(MutationOp::Delete, id, json!({})))
            .unwrap(),
        EnqueueOutcome::Cancelled(key)
    );
    assert!(q.next_batch(500).unwrap().is_empty());
    assert!(q.list().unwrap().is_empty());
}

#[test]
fn coalescing_updates_preserves_first_version_and_unions_fields_then_delete() {
    let (_dir, _store, q) = setup();
    let id = Uuid::now_v7();
    let key = q
        .enqueue(draft(MutationOp::Update, id, json!({"notes":"a"})))
        .unwrap();
    let mut second = draft(MutationOp::Update, id, json!({"lines":[2]}));
    second.base_version = Some(9);
    assert_eq!(q.enqueue(second).unwrap(), key);
    let m = q.list().unwrap()[0].mutation.clone();
    assert_eq!(m.changed_fields, vec!["lines", "notes"]);
    assert_eq!(m.base_version, Some(3));
    q.enqueue(draft(MutationOp::Delete, id, json!({}))).unwrap();
    let m = q.next_batch(10).unwrap().remove(0);
    assert_eq!(m.op, MutationOp::Delete);
    assert_eq!(m.base_version, Some(3));
    assert!(m.payload.is_empty());
    assert!(m.changed_fields.is_empty());
}

#[test]
fn sent_bodies_never_coalesce_even_after_retry_and_quarantine_is_visible() {
    let (_dir, _store, q) = setup();
    let id = Uuid::now_v7();
    let key = q
        .enqueue(draft(MutationOp::Update, id, json!({"notes":"first"})))
        .unwrap();
    let original = q.next_batch(10).unwrap().remove(0);
    let next = q
        .enqueue(draft(MutationOp::Update, id, json!({"notes":"second"})))
        .unwrap();
    assert_ne!(next, key);
    for attempt in 1..=MAX_ATTEMPTS {
        q.transient_failure(key).unwrap();
        let entry = q
            .list()
            .unwrap()
            .into_iter()
            .find(|e| e.mutation.idempotency_key == key)
            .unwrap();
        assert_eq!(entry.attempts, attempt);
        assert_eq!(entry.mutation, original);
        if attempt < MAX_ATTEMPTS {
            assert_eq!(q.next_batch(10).unwrap(), vec![original.clone()]);
        }
    }
    assert!(q.next_batch(10).unwrap().is_empty());
    assert_eq!(q.list().unwrap()[0].state, OutboxState::Quarantined);
    assert_eq!(
        q.list().unwrap()[1].last_error.as_deref(),
        Some("SYNC_DEPENDENCY_FAILED")
    );
}

#[test]
fn explicit_dependencies_wait_for_ack_and_order_uses_actual_timestamp_and_limit() {
    let (_dir, _store, q) = setup();
    let parent = q
        .enqueue(draft(MutationOp::Create, Uuid::now_v7(), json!({})))
        .unwrap();
    let mut child = draft(
        MutationOp::Create,
        Uuid::now_v7(),
        json!({"party_id":"some value"}),
    );
    child.depends_on = vec![parent];
    child.occurred_at = Timestamp("2026-10-25T00:00:00Z".into());
    let child_key = q.enqueue(child).unwrap();
    let batch = q.next_batch(1).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].idempotency_key, parent);
    assert!(q.next_batch(100).unwrap().is_empty());
    let success = result(&batch[0], PushStatus::Applied);
    let outcome = q.record_results(std::slice::from_ref(&success)).unwrap();
    assert_eq!(outcome.results, vec![success]);
    assert_eq!(q.next_batch(2).unwrap()[0].idempotency_key, child_key);
}

#[test]
fn occurred_at_offsets_and_server_batch_ceiling() {
    let (_dir, _store, q) = setup();
    let mut late = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    late.occurred_at = Timestamp("2026-10-25T08:00:00Z".into());
    let late = q.enqueue(late).unwrap();
    let mut early = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    early.occurred_at = Timestamp("2026-10-25T10:00:00+03:00".into());
    let early = q.enqueue(early).unwrap();
    assert!(q.next_batch(0).unwrap().is_empty());
    let batch = q.next_batch(2).unwrap();
    assert_eq!(
        batch.iter().map(|m| m.idempotency_key).collect::<Vec<_>>(),
        vec![early, late]
    );
    for _ in 0..501 {
        q.enqueue(draft(MutationOp::Create, Uuid::now_v7(), json!({})))
            .unwrap();
    }
    assert_eq!(q.next_batch(999).unwrap().len(), 500);
}

#[test]
fn duplicate_removes_entry_and_rejection_blocks_dependants() {
    let (_dir, _store, q) = setup();
    q.enqueue(draft(MutationOp::Create, Uuid::now_v7(), json!({})))
        .unwrap();
    let m = q.next_batch(1).unwrap().remove(0);
    assert_eq!(
        q.record_results(&[result(&m, PushStatus::Duplicate)])
            .unwrap()
            .applied,
        1
    );
    assert!(q.list().unwrap().is_empty());
    let parent = q
        .enqueue(draft(MutationOp::Create, Uuid::now_v7(), json!({})))
        .unwrap();
    let mut child = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    child.depends_on = vec![parent];
    q.enqueue(child).unwrap();
    let m = q.next_batch(10).unwrap().remove(0);
    let mut rejected = result(&m, PushStatus::Rejected);
    rejected.version = None;
    rejected.data = None;
    rejected.error = Some(ApiError {
        message: "no".into(),
        code: ErrorCode::ValidationError,
        fields: None,
    });
    assert_eq!(q.record_results(&[rejected]).unwrap().rejected, 1);
    assert!(q.next_batch(10).unwrap().is_empty());
    let entries = q.list().unwrap();
    assert_eq!(entries[0].state, OutboxState::Rejected);
    assert_eq!(
        entries[1].last_error.as_deref(),
        Some("SYNC_DEPENDENCY_FAILED")
    );
}

#[test]
fn conflict_record_is_atomic_and_blocks_dependants() {
    let (_dir, store, q) = setup();
    let parent = q
        .enqueue(draft(
            MutationOp::Update,
            Uuid::now_v7(),
            json!({"notes":"mine"}),
        ))
        .unwrap();
    let mut child = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    child.depends_on = vec![parent];
    q.enqueue(child).unwrap();
    let m = q.next_batch(10).unwrap().remove(0);
    let mut r = result(&m, PushStatus::Conflict);
    r.version = None;
    r.data = None;
    r.conflict = Some(Conflict {
        code: ConflictCode::VersionConflict,
        message: None,
        base_version: Some(3),
        server_version: Some(4),
        conflicting_fields: vec!["notes".into()],
        server_data: Some(ResourceRow {
            id: m.id,
            version: Some(4),
            fields: json!({"notes":"server"}).as_object().unwrap().clone(),
        }),
        candidates: None,
        choices: allowed_choices(ConflictCode::VersionConflict).to_vec(),
    });
    assert!(q.record_results(&[r.clone(), r.clone()]).is_err());
    assert_eq!(ConflictStore::new(store.clone()).count().unwrap(), 0);
    assert_eq!(q.list().unwrap()[0].state, OutboxState::InFlight);
    assert_eq!(
        q.record_results(std::slice::from_ref(&r))
            .unwrap()
            .conflicts,
        1
    );
    assert!(q.next_batch(10).unwrap().is_empty());
    let inbox = ConflictStore::new(store);
    let records = inbox.list().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].conflict, r.conflict.unwrap());
    assert_eq!(records[0].local, m);
    assert!(!records[0].detected_at.0.is_empty());
    assert_eq!(q.list().unwrap()[0].state, OutboxState::Conflict);
}

#[test]
fn persistence_and_invalid_results_roll_back() {
    let (dir, store, q) = setup();
    let key = q
        .enqueue(draft(MutationOp::Create, Uuid::now_v7(), json!({})))
        .unwrap();
    let m = q.next_batch(1).unwrap().remove(0);
    assert!(
        q.record_results(&[
            result(&m, PushStatus::Applied),
            result(&m, PushStatus::Applied)
        ])
        .is_err()
    );
    assert_eq!(q.list().unwrap()[0].state, OutboxState::InFlight);
    drop(q);
    drop(store);
    let store =
        Arc::new(Store::open(dir.path().join("queue.db"), &DbKey::from_bytes([17; 32])).unwrap());
    let q = Outbox::new(store);
    q.requeue_in_flight().unwrap();
    assert_eq!(q.next_batch(1).unwrap()[0].idempotency_key, key);
}

#[test]
fn dependency_validation_and_cancelled_parent_never_send_child() {
    let (_dir, _store, q) = setup();
    let id = Uuid::now_v7();
    let key = q.enqueue(draft(MutationOp::Create, id, json!({}))).unwrap();
    let mut child = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    child.depends_on = vec![key];
    q.enqueue(child).unwrap();
    q.enqueue_outcome(draft(MutationOp::Delete, id, json!({})))
        .unwrap();
    assert!(q.next_batch(10).unwrap().is_empty());
    assert_eq!(
        q.list().unwrap()[0].last_error.as_deref(),
        Some("SYNC_DEPENDENCY_FAILED")
    );
    let mut bad = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    bad.depends_on = vec![Uuid::now_v7()];
    assert!(q.enqueue(bad).is_err());
}

#[test]
fn coalescing_unions_explicit_edges_and_topologically_orders_later_prerequisites() {
    let (_dir, _store, q) = setup();
    let id = Uuid::now_v7();
    let key = q
        .enqueue(draft(MutationOp::Create, id, json!({"notes":"a"})))
        .unwrap();
    let parent = q
        .enqueue(draft(MutationOp::Create, Uuid::now_v7(), json!({})))
        .unwrap();
    let mut update = draft(MutationOp::Update, id, json!({"notes":"b"}));
    update.depends_on = vec![parent, parent];
    assert_eq!(q.enqueue(update).unwrap(), key);
    let batch = q.next_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].idempotency_key, parent);
    q.record_results(&[result(&batch[0], PushStatus::Applied)])
        .unwrap();
    let batch = q.next_batch(10).unwrap();
    assert_eq!(batch[0].idempotency_key, key);
    assert_eq!(batch[0].depends_on, Some(vec![parent]));
}

#[test]
fn coalescing_rejects_cycles_and_retry_pending_body_is_immutable() {
    let (_dir, _store, q) = setup();
    let id = Uuid::now_v7();
    let key = q
        .enqueue(draft(MutationOp::Update, id, json!({"notes":"a"})))
        .unwrap();
    let mut child = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    child.depends_on = vec![key];
    let child_key = q.enqueue(child).unwrap();
    let mut cycle = draft(MutationOp::Update, id, json!({"notes":"b"}));
    cycle.depends_on = vec![child_key];
    assert!(q.enqueue(cycle).is_err());
    let sent = q.next_batch(10).unwrap().remove(0);
    q.requeue_in_flight().unwrap();
    let second = q
        .enqueue(draft(MutationOp::Update, id, json!({"notes":"b"})))
        .unwrap();
    assert_ne!(second, key);
    assert_eq!(q.next_batch(10).unwrap(), vec![sent]);
}

#[test]
fn action_and_delete_wire_fields_and_migrations_are_preserved() {
    let (_dir, store, q) = setup();
    let migrations = store.applied_migrations().unwrap();
    assert!(migrations.iter().any(|m| m.0 == 100));
    assert!(migrations.iter().any(|m| m.0 == 200));
    let mut action = draft(
        MutationOp::Action,
        Uuid::now_v7(),
        json!({"counts":[1],"notes":null}),
    );
    action.action = Some("counts".into());
    action.parent_id = Some(Uuid::now_v7());
    let expected_parent = action.parent_id;
    q.enqueue(action).unwrap();
    let batch = q.next_batch(1).unwrap();
    assert_eq!(batch[0].action.as_deref(), Some("counts"));
    assert_eq!(batch[0].parent_id, expected_parent);
    assert_eq!(batch[0].changed_fields, vec!["counts", "notes"]);
    let id = Uuid::now_v7();
    q.enqueue(draft(MutationOp::Delete, id, json!({}))).unwrap();
    let mutation = q.next_batch(1).unwrap().remove(0);
    let mut deleted = result(&mutation, PushStatus::Applied);
    deleted.version = None;
    deleted.data = Some(None);
    let outcome = q.record_results(&[deleted]).unwrap();
    assert_eq!(outcome.results[0].data, Some(None));
}

#[test]
fn coalescing_preserves_distinct_parent_ids() {
    let (_dir, _store, q) = setup();
    let id = Uuid::now_v7();
    let mut first = draft(MutationOp::Update, id, json!({"notes":"first"}));
    first.parent_id = Some(Uuid::now_v7());
    let original = first.parent_id;
    let first_key = q.enqueue(first).unwrap();
    let mut second = draft(MutationOp::Update, id, json!({"notes":"second"}));
    second.parent_id = Some(Uuid::now_v7());
    let other = second.parent_id;
    let second_key = q.enqueue(second).unwrap();
    assert_ne!(first_key, second_key);
    let entries = q.list().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].mutation.parent_id, original);
    assert_eq!(entries[1].mutation.parent_id, other);
}

#[test]
fn recovery_does_not_count_and_only_failed_mutation_is_quarantined() {
    let (_dir, _store, q) = setup();
    let key = q
        .enqueue(draft(
            MutationOp::Create,
            Uuid::now_v7(),
            json!({"notes":"a"}),
        ))
        .unwrap();
    let healthy = q
        .enqueue(draft(MutationOp::Create, Uuid::now_v7(), json!({})))
        .unwrap();
    let original = q.next_batch(10).unwrap()[0].clone();
    for _ in 0..10 {
        q.requeue_in_flight().unwrap();
        assert!(q.list().unwrap().iter().all(|e| e.attempts == 0));
        q.next_batch(10).unwrap();
    }
    for _ in 0..MAX_ATTEMPTS {
        q.transient_failure(key).unwrap();
        q.requeue_in_flight().unwrap();
        q.next_batch(10).unwrap();
    }
    let entries = q.list().unwrap();
    assert_eq!(
        entries
            .iter()
            .find(|e| e.mutation.idempotency_key == key)
            .unwrap()
            .state,
        OutboxState::Quarantined
    );
    assert_eq!(
        entries
            .iter()
            .find(|e| e.mutation.idempotency_key == healthy)
            .unwrap()
            .attempts,
        0
    );
    let mut bad = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    bad.depends_on = vec![key];
    assert!(q.enqueue(bad).is_err());
    q.retry(key).unwrap();
    assert_eq!(q.next_batch(10).unwrap(), vec![original]);
}

#[test]
fn cancelled_dependencies_are_rejected_and_cancellation_is_explicit() {
    let (_dir, _store, q) = setup();
    let id = Uuid::now_v7();
    let key = q.enqueue(draft(MutationOp::Create, id, json!({}))).unwrap();
    assert_eq!(
        q.enqueue_outcome(draft(MutationOp::Delete, id, json!({})))
            .unwrap(),
        EnqueueOutcome::Cancelled(key)
    );
    let mut child = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    child.depends_on = vec![key];
    assert!(q.enqueue(child).is_err());
    assert!(q.list().unwrap().is_empty());
}

#[test]
fn discard_quarantined_parent_marks_transitive_dependants() {
    let (_dir, _store, q) = setup();
    let key = q
        .enqueue(draft(MutationOp::Create, Uuid::now_v7(), json!({})))
        .unwrap();
    let mut child = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    child.depends_on = vec![key];
    let child = q.enqueue(child).unwrap();
    let mut grandchild = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    grandchild.depends_on = vec![child];
    q.enqueue(grandchild).unwrap();
    for _ in 0..MAX_ATTEMPTS {
        q.next_batch(10).unwrap();
        q.transient_failure(key).unwrap();
    }
    q.discard(key).unwrap();
    assert!(
        q.list()
            .unwrap()
            .iter()
            .all(|e| e.last_error.as_deref() == Some("SYNC_DEPENDENCY_FAILED"))
    );
    assert!(q.next_batch(10).unwrap().is_empty());
}

#[test]
fn rejected_entry_retry_preserves_body_and_discard_blocks_children() {
    let (_dir, _store, q) = setup();
    let key = q
        .enqueue(draft(
            MutationOp::Create,
            Uuid::now_v7(),
            json!({"notes":"original"}),
        ))
        .unwrap();
    let mut child = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    child.depends_on = vec![key];
    q.enqueue(child).unwrap();
    let original = q.next_batch(10).unwrap().remove(0);
    let mut rejection = result(&original, PushStatus::Rejected);
    rejection.version = None;
    rejection.data = None;
    rejection.error = Some(ApiError {
        message: "no".into(),
        code: ErrorCode::ValidationError,
        fields: None,
    });
    q.record_results(&[rejection.clone()]).unwrap();
    let mut dead = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    dead.depends_on = vec![key];
    assert!(q.enqueue(dead).is_err());
    assert!(q.next_batch(10).unwrap().is_empty());
    q.retry(key).unwrap();
    assert_eq!(q.next_batch(10).unwrap(), vec![original]);
    q.record_results(&[rejection]).unwrap();
    q.discard(key).unwrap();
    assert_eq!(
        q.list().unwrap()[0].last_error.as_deref(),
        Some("SYNC_DEPENDENCY_FAILED")
    );
    assert!(q.next_batch(10).unwrap().is_empty());
}
