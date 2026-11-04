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
                {"id": LINE_B, "item_id": ITEM, "lot_no": "L-1", "counted_quantity": null, "system_quantity": "2.000000"},
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
    let added = json!({"item_id": ITEM, "lot_no": "L-2", "counted_quantity": "3"});
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

// ---- mutation round: missing pins ----

fn entry(f: &Fixture, key: Uuid) -> Option<Mutation> {
    f.q.list()
        .unwrap()
        .into_iter()
        .find(|e| e.mutation.idempotency_key == key)
        .map(|e| e.mutation)
}

fn locked_counts(doc: Uuid) -> Fixture {
    locked(counts(
        doc,
        json!({"counts": [{"line_id": LINE_A, "counted_quantity": "5"}]}),
    ))
}

fn later_counts(doc: Uuid, payload: Value) -> NewMutation {
    let mut later = counts(doc, payload);
    later.base_version = Some(7);
    later
}

#[test]
fn counts_of_another_document_stay_queued() {
    let f = locked_counts(Uuid::now_v7());
    let other_doc = Uuid::now_v7();
    let other =
        f.q.enqueue(counts(
            other_doc,
            json!({"add": [{"item_id": ITEM, "counted_quantity": "1"}]}),
        ))
        .unwrap();
    let create = f.q.enqueue(new_draft(&f)).unwrap();
    assert_eq!(entry(&f, other).unwrap().id, other_doc);
    assert_eq!(
        entry(&f, create).unwrap().payload["lines"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn a_misfit_later_count_refuses_the_new_draft_atomically() {
    let doc = Uuid::now_v7();
    let f = locked_counts(doc);
    let fits = json!({"counts": [{"line_id": LINE_B, "counted_quantity": "9"}]});
    let fits = f.q.enqueue(later_counts(doc, fits)).unwrap();
    let misfit = json!({"counts": [{"line_id": Uuid::now_v7(), "counted_quantity": "1"}]});
    let misfit = f.q.enqueue(later_counts(doc, misfit)).unwrap();
    // Queued on the new id it would be rejected line_missing: the count lost.
    assert!(f.q.enqueue(new_draft(&f)).is_err());
    assert_eq!(f.inbox.count().unwrap(), 1);
    for key in [fits, misfit] {
        let kept = entry(&f, key).unwrap();
        assert_eq!((kept.id, kept.base_version), (doc, Some(7)));
    }
    assert_eq!(f.q.list().unwrap().len(), 3);
    // Discard is still offered.
    assert_eq!(
        f.inbox
            .resolve(f.sent.idempotency_key, ConflictChoice::Discard)
            .unwrap(),
        ResolutionAction::Discard
    );
}

#[test]
fn a_later_count_waiting_for_a_failed_change_is_not_folded() {
    let doc = Uuid::now_v7();
    let f = locked_counts(doc);
    let item =
        f.q.enqueue(write(
            MutationOp::Create,
            None,
            Uuid::now_v7(),
            json!({"name": "i"}),
        ))
        .unwrap();
    let mut later = later_counts(
        doc,
        json!({"counts": [{"line_id": LINE_B, "counted_quantity": "9"}]}),
    );
    later.depends_on = vec![item];
    let later = f.q.enqueue(later).unwrap();
    rejected_prerequisite_of(&f, item);
    f.q.next_batch(10).unwrap();
    let waiting = f.q.list().unwrap();
    let waiting = waiting
        .iter()
        .find(|e| e.mutation.idempotency_key == later)
        .unwrap();
    assert_eq!(
        waiting.last_error.as_deref(),
        Some("SYNC_DEPENDENCY_FAILED")
    );
    // Folded, the create would wait for the failed change forever.
    assert!(f.q.enqueue(new_draft(&f)).is_err());
    assert_eq!(f.inbox.count().unwrap(), 1);
    assert_eq!(entry(&f, later).unwrap().id, doc);
}

#[test]
fn a_folded_count_brings_no_dead_prerequisite() {
    let doc = Uuid::now_v7();
    let f = locked_counts(doc);
    // The later count names a create that was rejected after it was queued;
    // no pass has marked it SYNC_DEPENDENCY_FAILED yet.
    let item =
        f.q.enqueue(write(
            MutationOp::Create,
            None,
            Uuid::now_v7(),
            json!({"name": "i"}),
        ))
        .unwrap();
    let mut later = later_counts(
        doc,
        json!({"counts": [{"line_id": LINE_B, "counted_quantity": "9"}]}),
    );
    later.depends_on = vec![item];
    let later = f.q.enqueue(later).unwrap();
    rejected_prerequisite_of(&f, item);
    assert_eq!(entry(&f, later).unwrap().id, doc);
    assert!(f.q.enqueue(new_draft(&f)).is_err());
    assert_eq!(f.inbox.count().unwrap(), 1);
}

/// Sends the queued create `item` (and nothing else) and rejects it.
fn rejected_prerequisite_of(f: &Fixture, item: Uuid) {
    let sent = f.q.next_batch(1).unwrap();
    assert_eq!(sent[0].idempotency_key, item);
    f.q.record_results(&[PushResult {
        idempotency_key: item,
        resource: sent[0].resource.clone(),
        id: sent[0].id,
        status: PushStatus::Rejected,
        replayed: false,
        version: None,
        data: None,
        merged_fields: None,
        conflict: None,
        error: Some(ApiError {
            message: "no".into(),
            code: ErrorCode::ValidationError,
            fields: None,
        }),
    }])
    .unwrap();
}

#[test]
fn an_earlier_add_does_not_overwrite_a_later_count_of_its_line() {
    let doc = Uuid::now_v7();
    let f = locked_counts(doc);
    // Same balance key as LINE_A (item, no location, no lot).
    let add = json!({"add": [{"item_id": ITEM, "lot_no": " ", "counted_quantity": "2", "unit_cost": "4.5"}]});
    f.q.enqueue(later_counts(doc, add)).unwrap();
    let count = json!({"counts": [{"line_id": LINE_A, "counted_quantity": "6"}]});
    f.q.enqueue(later_counts(doc, count)).unwrap();
    let create = f.q.enqueue(new_draft(&f)).unwrap();
    let lines = entry(&f, create).unwrap().payload["lines"]
        .as_array()
        .unwrap()
        .clone();
    // The server merges a create's lines by balance key in list order: an
    // added line left at the end would write 2 over the later count of 6.
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["id"], LINE_A);
    assert_eq!(lines[0]["counted_quantity"], "6");
    assert_eq!(lines[0]["unit_cost"], "4.5");
}

#[test]
fn an_add_with_no_quantity_keeps_the_count_of_its_line() {
    let f = locked(counts(
        Uuid::now_v7(),
        json!({
            "counts": [{"line_id": LINE_B, "counted_quantity": "7"}],
            "add": [{"item_id": ITEM, "lot_no": "L-1", "counted_quantity": null}],
        }),
    ));
    let draft = new_draft(&f);
    let lines = draft.payload["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[1]["counted_quantity"], "7");
}

/// Marks `key` as sent once and left in `state` (raw: the queue itself
/// never sends a later write of a row whose earlier write is in conflict).
fn mark_sent(f: &Fixture, key: Uuid, state: &str) {
    f.q.store()
        .write(|tx| {
            tx.execute(
                "UPDATE outbox_entries SET sent=1, state=?2 WHERE key=?1",
                [key.to_string(), state.to_owned()],
            )?;
            Ok(())
        })
        .unwrap();
}

#[test]
fn a_count_sent_before_refuses_the_new_draft_atomically() {
    for state in ["pending", "in_flight", "quarantined", "rejected"] {
        let doc = Uuid::now_v7();
        let f = locked_counts(doc);
        let later = later_counts(
            doc,
            json!({"counts": [{"line_id": LINE_B, "counted_quantity": "9"}]}),
        );
        let later = f.q.enqueue(later).unwrap();
        // Sent once: the server may hold it under its key already (applied)
        // or not. Folded it could count twice; left on the locked document
        // it would be locked again once this conflict settles and could
        // become a second new document. Only its answer decides.
        mark_sent(&f, later, state);
        let draft = new_draft(&f);
        let new_id = draft.id;
        assert!(f.q.enqueue(draft).is_err(), "{state}");
        assert_eq!(f.inbox.count().unwrap(), 1, "{state}");
        let kept = entry(&f, later).unwrap();
        assert_eq!((kept.id, kept.base_version), (doc, Some(7)), "{state}");
        let entries = f.q.list().unwrap();
        assert_eq!(entries.len(), 2, "{state}");
        assert!(entries.iter().all(|e| e.mutation.id != new_id), "{state}");
        let remaps: i64 = f
            .q
            .store()
            .read(|c| Ok(c.query_row("SELECT count(*) FROM outbox_id_remaps", [], |r| r.get(0))?))
            .unwrap();
        assert_eq!(remaps, 0, "{state}");
        // Discard is still offered.
        assert_eq!(
            f.inbox
                .resolve(f.sent.idempotency_key, ConflictChoice::Discard)
                .unwrap(),
            ResolutionAction::Discard
        );
    }
}

#[test]
fn a_later_count_is_not_sent_while_the_document_is_in_conflict() {
    let doc = Uuid::now_v7();
    let f = locked_counts(doc);
    let later = later_counts(
        doc,
        json!({"counts": [{"line_id": LINE_B, "counted_quantity": "9"}]}),
    );
    let later = f.q.enqueue(later).unwrap();
    f.q.requeue_in_flight().unwrap();
    // The conflict is an implicit prerequisite of the later count: it stays
    // unsent, so saving as a new draft folds it.
    assert!(f.q.next_batch(10).unwrap().is_empty());
    let listed = f.q.list().unwrap();
    let queued = listed
        .iter()
        .find(|e| e.mutation.idempotency_key == later)
        .unwrap();
    assert!(!queued.sent);
    let create = f.q.enqueue(new_draft(&f)).unwrap();
    assert!(entry(&f, later).is_none());
    assert_eq!(
        entry(&f, create).unwrap().payload["lines"][1]["counted_quantity"],
        "9"
    );
}

#[test]
fn a_failed_enqueue_can_be_resolved_again_with_the_same_draft() {
    let f = locked_counts(Uuid::now_v7());
    let first = new_draft(&f);
    let mut broken = first.clone();
    broken.payload.insert("version".into(), json!(1));
    assert!(f.q.enqueue(broken).is_err());
    assert_eq!(f.inbox.count().unwrap(), 1);
    let again = new_draft(&f);
    assert_eq!(again.id, first.id);
    assert_eq!(again.payload, first.payload);
    f.q.enqueue(again).unwrap();
    assert_eq!(f.inbox.count().unwrap(), 0);
}

#[test]
fn a_folded_count_keeps_its_other_prerequisites() {
    let doc = Uuid::now_v7();
    let f = locked_counts(doc);
    let item =
        f.q.enqueue(write(
            MutationOp::Create,
            None,
            Uuid::now_v7(),
            json!({"name": "i"}),
        ))
        .unwrap();
    let mut later = later_counts(
        doc,
        json!({"add": [{"item_id": ITEM, "counted_quantity": "1"}]}),
    );
    later.depends_on = vec![item];
    f.q.enqueue(later).unwrap();
    let create = f.q.enqueue(new_draft(&f)).unwrap();
    assert_eq!(entry(&f, create).unwrap().depends_on, Some(vec![item]));
}

#[test]
fn a_write_naming_a_folded_count_waits_for_the_create() {
    let doc = Uuid::now_v7();
    let f = locked_counts(doc);
    let later = later_counts(
        doc,
        json!({"add": [{"item_id": ITEM, "counted_quantity": "1"}]}),
    );
    let later = f.q.enqueue(later).unwrap();
    let create = f.q.enqueue(new_draft(&f)).unwrap();
    let mut next = write(
        MutationOp::Create,
        None,
        Uuid::now_v7(),
        json!({"name": "n"}),
    );
    next.depends_on = vec![later];
    let next = f.q.enqueue(next).unwrap();
    assert_eq!(entry(&f, next).unwrap().depends_on, Some(vec![create]));
}

#[test]
fn request_keys_of_a_folded_count_answer_with_the_create() {
    let doc = Uuid::now_v7();
    let f = locked_counts(doc);
    let later = later_counts(
        doc,
        json!({"add": [{"item_id": ITEM, "counted_quantity": "1"}]}),
    );
    let later = f.q.enqueue(later).unwrap();
    f.q.store()
        .write(|tx| {
            tx.execute(
                "INSERT INTO outbox_request_keys(key,fingerprint,resource,id,cancelled,created_at,entry_key)
                 VALUES ('rk','fp','stock-documents',?1,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?2)",
                [doc.to_string(), later.to_string()],
            )?;
            Ok(())
        })
        .unwrap();
    let create = f.q.enqueue(new_draft(&f)).unwrap();
    let owner: String =
        f.q.store()
            .read(|c| {
                Ok(c.query_row(
                    "SELECT entry_key FROM outbox_request_keys WHERE key='rk'",
                    [],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
    assert_eq!(owner, create.to_string());
    // A repeat of that request answers with the new document: the key's
    // target follows the identity replacement (find_request).
    let new_id = entry(&f, create).unwrap().id;
    let target: String =
        f.q.store()
            .read(|c| {
                Ok(c.query_row(
                    "SELECT new_id FROM outbox_id_remaps WHERE old_id=?1",
                    [doc.to_string()],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
    assert_eq!(target, new_id.to_string());
}

#[test]
fn a_counts_body_with_other_keys_is_refused() {
    let f = locked(counts(
        Uuid::now_v7(),
        json!({"counts": [{"line_id": LINE_A, "counted_quantity": "5"}], "freeze": false}),
    ));
    assert!(
        f.inbox
            .resolve(f.sent.idempotency_key, ConflictChoice::SaveAsNewDraft)
            .is_err()
    );
}
