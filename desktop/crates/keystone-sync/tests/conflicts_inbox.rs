use keystone_sync::conflicts::{ConflictInbox, ConflictStore, ResolutionAction, allowed_choices};
use keystone_sync::outbox::{NewMutation, Outbox, OutboxQueue, OutboxState};
use keystone_sync::store::{DbKey, Store};
use keystone_sync::wire::*;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use uuid::Uuid;

fn draft(op: MutationOp, id: Uuid, payload: Value) -> NewMutation {
    NewMutation {
        op,
        action: None,
        resource: ResourceName("parties".into()),
        id,
        parent_id: None,
        base_version: (op != MutationOp::Create).then_some(2),
        payload: payload.as_object().unwrap().clone(),
        depends_on: vec![],
        occurred_at: Timestamp("2026-10-25T10:00:00Z".into()),
        resolution: None,
    }
}
fn setup(
    code: ConflictCode,
) -> (
    tempfile::TempDir,
    Arc<Store>,
    Outbox,
    ConflictStore,
    Mutation,
) {
    let dir = tempfile::tempdir().unwrap();
    let store =
        Arc::new(Store::open(dir.path().join("inbox.db"), &DbKey::from_bytes([8; 32])).unwrap());
    let q = Outbox::new(store.clone());
    let inbox = ConflictStore::new(store.clone());
    let op = if code == ConflictCode::DuplicateRecord {
        MutationOp::Create
    } else {
        MutationOp::Update
    };
    q.enqueue(draft(
        op,
        Uuid::now_v7(),
        json!({"notes":"mine","lines":[1]}),
    ))
    .unwrap();
    let m = q.next_batch(1).unwrap().remove(0);
    let conflict = Conflict {
        code,
        message: Some("conflict".into()),
        base_version: m.base_version,
        server_version: (code != ConflictCode::DuplicateRecord).then_some(7),
        conflicting_fields: vec!["notes".into()],
        server_data: (code != ConflictCode::DuplicateRecord).then(|| ResourceRow {
            id: m.id,
            version: Some(7),
            fields:
                json!({"notes":"server","status":"approved","number":"SO-1","other":"retained"})
                    .as_object()
                    .unwrap()
                    .clone(),
        }),
        candidates: (code == ConflictCode::DuplicateRecord)
            .then(|| vec![Uuid::now_v7(), Uuid::now_v7()]),
        choices: allowed_choices(code).to_vec(),
    };
    q.record_results(&[PushResult {
        idempotency_key: m.idempotency_key,
        resource: m.resource.clone(),
        id: m.id,
        status: PushStatus::Conflict,
        replayed: false,
        version: None,
        data: None,
        merged_fields: None,
        conflict: Some(conflict),
        error: None,
    }])
    .unwrap();
    (dir, store, q, inbox, m)
}
fn enqueue_action(action: ResolutionAction) -> NewMutation {
    match action {
        ResolutionAction::Enqueue(draft) => draft,
        other => panic!("expected enqueue: {other:?}"),
    }
}
fn applied(m: &Mutation) -> PushResult {
    PushResult {
        idempotency_key: m.idempotency_key,
        resource: m.resource.clone(),
        id: m.id,
        status: PushStatus::Applied,
        replayed: false,
        version: Some(8),
        data: Some(Some(ResourceRow {
            id: m.id,
            version: Some(8),
            fields: Map::new(),
        })),
        merged_fields: None,
        conflict: None,
        error: None,
    }
}

#[test]
fn keep_mine_preserves_payload_refreshes_version_and_replaces_dependency() {
    let (_dir, _store, q, inbox, m) = setup(ConflictCode::VersionConflict);
    let mut dependent = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    dependent.depends_on = vec![m.idempotency_key];
    let dependent = q.enqueue(dependent).unwrap();
    let action = enqueue_action(
        inbox
            .resolve(m.idempotency_key, ConflictChoice::KeepMine)
            .unwrap(),
    );
    assert_eq!(action.payload, m.payload);
    assert_eq!(action.base_version, Some(7));
    let resolution = action.resolution.unwrap();
    assert_eq!(resolution.resolves, m.idempotency_key);
    assert_eq!(resolution.choice, ResolutionChoice::KeepMine);
    assert_eq!(inbox.count().unwrap(), 1);
    let key = q.enqueue(action).unwrap();
    assert_ne!(key, m.idempotency_key);
    assert_eq!(key.get_version_num(), 7);
    assert_eq!(inbox.count().unwrap(), 0);
    let batch = q.next_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].idempotency_key, key);
    q.record_results(&[applied(&batch[0])]).unwrap();
    let next = q.next_batch(10).unwrap();
    assert_eq!(next[0].idempotency_key, dependent);
    assert_eq!(next[0].depends_on, Some(vec![key]));
}

#[test]
fn merge_requires_explicit_fields_and_uses_server_version() {
    let (_dir, _store, q, inbox, m) = setup(ConflictCode::VersionConflict);
    assert!(
        inbox
            .resolve(m.idempotency_key, ConflictChoice::Merge)
            .is_err()
    );
    assert!(inbox.resolve_merge(m.idempotency_key, Map::new()).is_err());
    let payload = json!({"notes":"combined","lines":[1,2]})
        .as_object()
        .unwrap()
        .clone();
    let action = enqueue_action(
        inbox
            .resolve_merge(m.idempotency_key, payload.clone())
            .unwrap(),
    );
    assert_eq!(action.payload, payload);
    assert_eq!(action.base_version, Some(7));
    assert_eq!(action.op, MutationOp::Update);
    assert_eq!(action.resolution.unwrap().choice, ResolutionChoice::Merge);
    q.enqueue(action).unwrap();
    let m = q.next_batch(1).unwrap().remove(0);
    assert_eq!(m.changed_fields, vec!["lines", "notes"]);
}

#[test]
fn take_server_drops_original_and_releases_edges_without_sending_conflict_key() {
    let (_dir, _store, q, inbox, m) = setup(ConflictCode::VersionConflict);
    let mut child = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
    child.depends_on = vec![m.idempotency_key];
    let child = q.enqueue(child).unwrap();
    match inbox
        .resolve(m.idempotency_key, ConflictChoice::TakeServer)
        .unwrap()
    {
        ResolutionAction::TakeServer(Some(row)) => {
            assert_eq!(row.version, Some(7));
            assert_eq!(row.fields["notes"], "server");
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(inbox.count().unwrap(), 0);
    let batch = q.next_batch(10).unwrap();
    assert_eq!(batch[0].idempotency_key, child);
    assert_eq!(batch[0].depends_on, None);
}

#[test]
fn locked_document_new_draft_gets_new_id_and_no_wire_resolution() {
    let (_dir, _store, q, inbox, m) = setup(ConflictCode::DocumentLocked);
    assert!(
        inbox
            .resolve(m.idempotency_key, ConflictChoice::KeepMine)
            .is_err()
    );
    let action = enqueue_action(
        inbox
            .resolve(m.idempotency_key, ConflictChoice::SaveAsNewDraft)
            .unwrap(),
    );
    assert_eq!(action.op, MutationOp::Create);
    assert_ne!(action.id, m.id);
    assert_eq!(action.id.get_version_num(), 7);
    assert_eq!(action.base_version, None);
    assert_eq!(action.resolution, None);
    assert_eq!(action.payload["status"], "draft");
    assert_eq!(action.payload["notes"], "mine");
    assert!(!action.payload.contains_key("number"));
    assert_eq!(inbox.count().unwrap(), 1);
    let repeated = enqueue_action(
        inbox
            .resolve(m.idempotency_key, ConflictChoice::SaveAsNewDraft)
            .unwrap(),
    );
    assert_eq!(action.id, repeated.id);
    let key = q.enqueue(action).unwrap();
    assert_ne!(key, m.idempotency_key);
    assert_eq!(q.next_batch(1).unwrap()[0].idempotency_key, key);
    assert_eq!(inbox.count().unwrap(), 0);
}

#[test]
fn discard_cancels_each_supported_conflict_and_blocks_children() {
    for code in [ConflictCode::DocumentLocked, ConflictCode::DuplicateRecord] {
        let (_dir, _store, q, inbox, m) = setup(code);
        let mut child = draft(MutationOp::Create, Uuid::now_v7(), json!({}));
        child.depends_on = vec![m.idempotency_key];
        q.enqueue(child).unwrap();
        assert_eq!(
            inbox
                .resolve(m.idempotency_key, ConflictChoice::Discard)
                .unwrap(),
            ResolutionAction::Discard
        );
        assert!(q.next_batch(10).unwrap().is_empty());
        assert_eq!(inbox.count().unwrap(), 0);
        assert_eq!(
            q.list().unwrap()[0].last_error.as_deref(),
            Some("SYNC_DEPENDENCY_FAILED")
        );
    }
}

#[test]
fn duplicate_keep_mine_is_create_and_merge_is_rejected() {
    let (_dir, _store, q, inbox, m) = setup(ConflictCode::DuplicateRecord);
    assert!(
        inbox
            .resolve_merge(
                m.idempotency_key,
                json!({"notes":"x"}).as_object().unwrap().clone()
            )
            .is_err()
    );
    let action = enqueue_action(
        inbox
            .resolve(m.idempotency_key, ConflictChoice::KeepMine)
            .unwrap(),
    );
    assert_eq!(action.op, MutationOp::Create);
    assert_eq!(action.base_version, None);
    assert_eq!(action.payload, m.payload);
    assert_eq!(
        action.resolution.unwrap().code,
        ResolutionCode::DuplicateRecord
    );
    q.enqueue(action).unwrap();
    assert_eq!(q.next_batch(1).unwrap().len(), 1);
}

#[test]
fn use_existing_validates_candidate_and_rebinds_explicit_dependent_drafts() {
    let (_dir, _store, q, inbox, m) = setup(ConflictCode::DuplicateRecord);
    let candidates = inbox.list().unwrap()[0]
        .conflict
        .candidates
        .clone()
        .unwrap();
    let mut child = draft(
        MutationOp::Create,
        Uuid::now_v7(),
        json!({"party_id":m.id.to_string(),"nested":[{"party":m.id.to_string()}]}),
    );
    child.depends_on = vec![m.idempotency_key];
    let child = q.enqueue(child).unwrap();
    assert!(
        inbox
            .resolve(m.idempotency_key, ConflictChoice::UseExisting)
            .is_err()
    );
    assert!(
        inbox
            .resolve_use_existing(m.idempotency_key, Uuid::now_v7())
            .is_err()
    );
    assert_eq!(
        inbox
            .resolve_use_existing(m.idempotency_key, candidates[1])
            .unwrap(),
        ResolutionAction::UseExisting(candidates[1])
    );
    let batch = q.next_batch(1).unwrap();
    assert_eq!(batch[0].idempotency_key, child);
    assert_eq!(batch[0].depends_on, None);
    assert_eq!(batch[0].payload["party_id"], candidates[1].to_string());
    assert_eq!(inbox.count().unwrap(), 0);
}

#[test]
fn offered_choices_are_enforced_and_inbox_survives_reopening() {
    let (dir, store, q, inbox, m) = setup(ConflictCode::VersionConflict);
    let mut record = inbox.list().unwrap().remove(0);
    record.conflict.choices = vec![ConflictChoice::TakeServer];
    inbox.record(record.clone()).unwrap();
    assert!(
        inbox
            .resolve(m.idempotency_key, ConflictChoice::KeepMine)
            .is_err()
    );
    assert_eq!(q.list().unwrap()[0].state, OutboxState::Conflict);
    drop(inbox);
    drop(q);
    drop(store);
    let store =
        Arc::new(Store::open(dir.path().join("inbox.db"), &DbKey::from_bytes([8; 32])).unwrap());
    let inbox = ConflictStore::new(store);
    assert_eq!(inbox.list().unwrap(), vec![record]);
    assert_eq!(inbox.count().unwrap(), 1);
}

#[test]
fn same_row_successor_cannot_block_resolution_and_resolution_validation_is_atomic() {
    let (_dir, _store, q, inbox, m) = setup(ConflictCode::VersionConflict);
    q.enqueue(draft(MutationOp::Update, m.id, json!({"notes":"later"})))
        .unwrap();
    let valid = enqueue_action(
        inbox
            .resolve(m.idempotency_key, ConflictChoice::KeepMine)
            .unwrap(),
    );
    let mut invalid = valid.clone();
    invalid.base_version = Some(99);
    assert!(q.enqueue(invalid).is_err());
    assert_eq!(inbox.count().unwrap(), 1);
    let key = q.enqueue(valid).unwrap();
    let batch = q.next_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].idempotency_key, key);
}
