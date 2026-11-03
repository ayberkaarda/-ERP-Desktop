//! Save as new draft on a locked document: the create carries what the
//! user wrote, and writes moved onto it are valid for a version-1 record.

use keystone_sync::conflicts::{ConflictInbox, ConflictStore, ResolutionAction, allowed_choices};
use keystone_sync::outbox::{NewMutation, Outbox, OutboxQueue};
use keystone_sync::store::raw::prelude::*;
use keystone_sync::store::{DbKey, Store};
use keystone_sync::wire::*;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use uuid::Uuid;

const LINE_A: &str = "0190a000-0000-7000-8000-00000000000a";
const LINE_B: &str = "0190a000-0000-7000-8000-00000000000b";
const ITEM: &str = "0190a000-0000-7000-8000-0000000000c1";

fn object(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

fn write(op: MutationOp, action: Option<&str>, id: Uuid, payload: Value) -> NewMutation {
    NewMutation {
        op,
        action: action.map(str::to_owned),
        resource: ResourceName("stock-documents".into()),
        id,
        parent_id: None,
        base_version: (op != MutationOp::Create).then_some(3),
        payload: object(payload),
        depends_on: vec![],
        occurred_at: Timestamp("2026-10-25T10:00:00Z".into()),
        resolution: None,
    }
}

/// The document as the server answers it: posted, version 7.
fn server_document(id: Uuid) -> ResourceRow {
    ResourceRow {
        id,
        version: Some(7),
        fields: object(json!({
            "doc_type": "count",
            "number": "SAY-1",
            "status": "posted",
            "document_date": "2026-10-25",
            "warehouse_id": "0190a000-0000-7000-8000-0000000000d1",
            "lines": [
                {"id": LINE_A, "item_id": ITEM, "counted_quantity": "1.000000", "system_quantity": "4.000000"},
                {"id": LINE_B, "item_id": ITEM, "counted_quantity": null, "system_quantity": "2.000000"},
            ],
        })),
    }
}

struct Fixture {
    _dir: tempfile::TempDir,
    q: Outbox,
    inbox: ConflictStore,
    sent: Mutation,
}

/// `first` is sent and answered DOCUMENT_LOCKED.
fn locked(first: NewMutation) -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let store =
        Arc::new(Store::open(dir.path().join("draft.db"), &DbKey::from_bytes([9; 32])).unwrap());
    let q = Outbox::new(store.clone());
    let inbox = ConflictStore::new(store);
    q.enqueue(first).unwrap();
    let sent = q.next_batch(1).unwrap().remove(0);
    q.record_results(&[PushResult {
        idempotency_key: sent.idempotency_key,
        resource: sent.resource.clone(),
        id: sent.id,
        status: PushStatus::Conflict,
        replayed: false,
        version: None,
        data: None,
        merged_fields: None,
        conflict: Some(Conflict {
            code: ConflictCode::DocumentLocked,
            message: None,
            base_version: sent.base_version,
            server_version: Some(7),
            conflicting_fields: vec![],
            server_data: Some(server_document(sent.id)),
            candidates: None,
            choices: allowed_choices(ConflictCode::DocumentLocked).to_vec(),
        }),
        error: None,
    }])
    .unwrap();
    Fixture {
        _dir: dir,
        q,
        inbox,
        sent,
    }
}

fn new_draft(f: &Fixture) -> NewMutation {
    match f
        .inbox
        .resolve(f.sent.idempotency_key, ConflictChoice::SaveAsNewDraft)
        .unwrap()
    {
        ResolutionAction::Enqueue(draft) => draft,
        other => panic!("expected a create: {other:?}"),
    }
}

fn counts(id: Uuid, payload: Value) -> NewMutation {
    write(MutationOp::Action, Some("counts"), id, payload)
}

#[test]
fn counts_become_the_lines_of_the_new_draft() {
    let added = json!({"item_id": ITEM, "lot_no": "L-9", "counted_quantity": "2"});
    let f = locked(counts(
        Uuid::now_v7(),
        json!({
            "counts": [{"line_id": LINE_A, "counted_quantity": "5"}],
            "add": [added.clone()],
        }),
    ));
    let draft = new_draft(&f);
    assert_eq!(draft.op, MutationOp::Create);
    assert_eq!(draft.action, None);
    // A create has no `counts`/`add`: the server would drop them silently.
    assert!(!draft.payload.contains_key("counts"));
    assert!(!draft.payload.contains_key("add"));
    let lines = draft.payload["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0]["counted_quantity"], "5");
    assert_eq!(lines[1]["counted_quantity"], Value::Null);
    assert_eq!(lines[2], added);
    assert_eq!(draft.payload["doc_type"], "count");
    assert!(!draft.payload.contains_key("status"));

    let key = f.q.enqueue(draft).unwrap();
    assert_eq!(f.inbox.count().unwrap(), 0);
    let batch = f.q.next_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].idempotency_key, key);
    assert_eq!(batch[0].payload["lines"][0]["counted_quantity"], "5");
}

#[test]
fn add_only_counts_append_lines() {
    let added = json!({"item_id": ITEM, "counted_quantity": "3"});
    let f = locked(counts(Uuid::now_v7(), json!({"add": [added.clone()]})));
    let draft = new_draft(&f);
    assert!(!draft.payload.contains_key("add"));
    let lines = draft.payload["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0]["counted_quantity"], "1.000000");
    assert_eq!(lines[2], added);
}

#[test]
fn counts_of_a_line_the_server_lacks_are_refused_not_dropped() {
    let f = locked(counts(
        Uuid::now_v7(),
        json!({"counts": [{"line_id": Uuid::now_v7(), "counted_quantity": "5"}]}),
    ));
    assert!(
        f.inbox
            .resolve(f.sent.idempotency_key, ConflictChoice::SaveAsNewDraft)
            .is_err()
    );
    assert_eq!(f.inbox.count().unwrap(), 1);
    // Discard is still there.
    assert_eq!(
        f.inbox
            .resolve(f.sent.idempotency_key, ConflictChoice::Discard)
            .unwrap(),
        ResolutionAction::Discard
    );
}

#[test]
fn other_actions_cannot_become_a_new_draft() {
    let f = locked(write(
        MutationOp::Action,
        Some("approve"),
        Uuid::now_v7(),
        json!({"note": "x"}),
    ));
    assert!(
        f.inbox
            .resolve(f.sent.idempotency_key, ConflictChoice::SaveAsNewDraft)
            .is_err()
    );
    assert_eq!(f.inbox.count().unwrap(), 1);
}

#[test]
fn later_updates_moved_onto_the_new_draft_are_based_on_its_first_version() {
    let doc = Uuid::now_v7();
    let f = locked(write(
        MutationOp::Update,
        None,
        doc,
        json!({"notes": "mine"}),
    ));
    // Edited later on this device: based on the locked document's version.
    let mut later = write(MutationOp::Update, None, doc, json!({"reason": "later"}));
    later.base_version = Some(7);
    let later = f.q.enqueue(later).unwrap();
    let draft = new_draft(&f);
    let new_id = draft.id;
    let create = f.q.enqueue(draft).unwrap();

    let moved =
        f.q.list()
            .unwrap()
            .into_iter()
            .find(|e| e.mutation.idempotency_key == later)
            .unwrap()
            .mutation;
    assert_eq!(moved.id, new_id);
    // The server creates the record at version 1; base 7 would be refused
    // SYNC_BASE_VERSION_AHEAD.
    assert_eq!(moved.base_version, Some(1));
    assert_eq!(moved.depends_on, Some(vec![create]));

    let batch = f.q.next_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].idempotency_key, create);
    f.q.record_results(&[PushResult {
        idempotency_key: create,
        resource: batch[0].resource.clone(),
        id: new_id,
        status: PushStatus::Applied,
        replayed: false,
        version: Some(1),
        data: Some(Some(ResourceRow {
            id: new_id,
            version: Some(1),
            fields: Map::new(),
        })),
        merged_fields: None,
        conflict: None,
        error: None,
    }])
    .unwrap();
    let batch = f.q.next_batch(10).unwrap();
    assert_eq!(batch[0].idempotency_key, later);
    assert_eq!(batch[0].base_version, Some(1));
}

#[test]
fn later_counts_fold_into_the_new_draft_and_their_dependants_follow() {
    let doc = Uuid::now_v7();
    let f = locked(counts(
        doc,
        json!({"counts": [{"line_id": LINE_A, "counted_quantity": "5"}]}),
    ));
    let mut later = counts(
        doc,
        json!({"counts": [{"line_id": LINE_B, "counted_quantity": "9"}, {"line_id": LINE_A, "counted_quantity": "6"}]}),
    );
    later.base_version = Some(7);
    let later = f.q.enqueue(later).unwrap();
    let mut dependant = write(MutationOp::Create, None, Uuid::now_v7(), json!({}));
    dependant.depends_on = vec![later];
    let dependant = f.q.enqueue(dependant).unwrap();

    let draft = new_draft(&f);
    let create = f.q.enqueue(draft).unwrap();
    let entries = f.q.list().unwrap();
    // The later counts name the locked document's lines: they cannot be sent
    // to the new one, so they are part of its create.
    assert!(entries.iter().all(|e| e.mutation.idempotency_key != later));
    let created = &entries
        .iter()
        .find(|e| e.mutation.idempotency_key == create)
        .unwrap()
        .mutation;
    assert_eq!(created.payload["lines"][0]["counted_quantity"], "6");
    assert_eq!(created.payload["lines"][1]["counted_quantity"], "9");
    let dependant = entries
        .iter()
        .find(|e| e.mutation.idempotency_key == dependant)
        .unwrap();
    assert_eq!(dependant.mutation.depends_on, Some(vec![create]));
    assert_eq!(dependant.last_error, None);
    assert_eq!(f.inbox.count().unwrap(), 0);
}
