//! Pending `counts` actions of a stock document laid over local reads: the
//! counted quantities and added lines the user saved offline show on the
//! document until the action is settled; actions the engine cannot project
//! are left out, and the mirror is never written.

mod engine_support;

use engine_support::*;
use keystone_sync::engine::Trigger;
use keystone_sync::outbox::{EnqueueOutcome, NewMutation};
use keystone_sync::store::ListQuery;
use keystone_sync::store::raw::prelude::*;
use keystone_sync::wire::MutationOp;
use serde_json::{Value, json};
use uuid::Uuid;

const DOCS: &str = "stock-documents";
const ITEM_A: &str = "0192f5a0-0000-7000-8000-00000000000a";
const ITEM_B: &str = "0192f5a0-0000-7000-8000-00000000000b";
const ITEM_C: &str = "0192f5a0-0000-7000-8000-00000000000c";
const LINE_1: &str = "0192f5a0-0000-7000-8000-000000000101";
const LINE_2: &str = "0192f5a0-0000-7000-8000-000000000102";

async fn verified(env: &Env) {
    mount_manifest(&env.server, simple_manifest(&[DOCS, "sales-quotes"])).await;
    mount_empty_pull(&env.server).await;
    env.engine.run_once(Trigger::Startup).await.unwrap();
}

/// A draft count document on the mirror: lines counted 10 and 5.
fn count_document(env: &Env) -> Uuid {
    let id = Uuid::now_v7();
    put_row(
        &env.store,
        DOCS,
        &id.to_string(),
        json!({
            "doc_type": "count",
            "status": "draft",
            "notes": null,
            "lines": [
                {"id": LINE_1, "item_id": ITEM_A, "location_id": null, "lot_no": "L1",
                 "system_quantity": "10", "counted_quantity": "10"},
                {"id": LINE_2, "item_id": ITEM_B, "location_id": null, "lot_no": null,
                 "system_quantity": "5", "counted_quantity": "5"},
            ],
        }),
    );
    id
}

fn action(name: &str, resource: &str, id: Uuid, payload: Value) -> NewMutation {
    NewMutation {
        action: Some(name.into()),
        ..draft(MutationOp::Action, resource, id, payload)
    }
}

fn counts(id: Uuid, payload: Value) -> NewMutation {
    action("counts", DOCS, id, payload)
}

fn enqueue(env: &Env, mutation: NewMutation) -> Uuid {
    match env.engine.enqueue(mutation).unwrap() {
        EnqueueOutcome::Queued(key) => key,
        other => panic!("not queued: {other:?}"),
    }
}

/// What the server's answer does to the outbox: the entry goes.
fn settle(env: &Env, key: Uuid) {
    env.store
        .write(|tx| {
            tx.execute(
                "DELETE FROM outbox_entries WHERE key = ?1",
                [key.to_string()],
            )?;
            Ok(())
        })
        .unwrap();
}

fn lines(env: &Env, id: Uuid) -> (Vec<Value>, bool) {
    let got = env.engine.get(&name(DOCS), id).unwrap().unwrap();
    let lines = got.row.fields["lines"].as_array().cloned().unwrap();
    (lines, got.draft)
}

fn counted(lines: &[Value]) -> Vec<Value> {
    lines
        .iter()
        .map(|l| l["counted_quantity"].clone())
        .collect()
}

fn mirror_counted(env: &Env, id: Uuid) -> Vec<Value> {
    let row = env.store.get_row(&name(DOCS), id).unwrap().unwrap();
    counted(row.fields["lines"].as_array().unwrap())
}

#[tokio::test]
async fn counts_and_added_lines_show_on_get_and_list() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    enqueue(
        &env,
        counts(
            doc,
            json!({
                "counts": [
                    {"line_id": LINE_1, "counted_quantity": "12"},
                    {"line_id": LINE_2, "counted_quantity": "7"},
                ],
                "add": [{"item_id": ITEM_C, "location_id": null, "lot_no": null,
                         "counted_quantity": "3"}],
            }),
        ),
    );

    let (got, draft) = lines(&env, doc);
    assert!(draft, "the answer carries pending changes");
    assert_eq!(counted(&got), [json!("12"), json!("7"), json!("3")]);
    assert_eq!(got[2]["item_id"], ITEM_C);
    assert_eq!(got[0]["system_quantity"], "10", "the rest of a line stays");

    let page = env.engine.list(&name(DOCS), &ListQuery::default()).unwrap();
    assert_eq!(page.drafts, [doc]);
    assert_eq!(page.total, 1);
    let listed = page.rows[0].fields["lines"].as_array().unwrap();
    assert_eq!(counted(listed), [json!("12"), json!("7"), json!("3")]);

    // Read-time only: the mirror keeps the server's values.
    assert_eq!(mirror_counted(&env, doc), [json!("10"), json!("5")]);
}

#[tokio::test]
async fn actions_apply_in_outbox_order_and_an_equal_line_merges() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": LINE_1, "counted_quantity": "12"}]}),
        ),
    );
    enqueue(
        &env,
        counts(
            doc,
            json!({
                "counts": [{"line_id": LINE_1, "counted_quantity": "13"}],
                // Same balance key as line 1 (trimmed lot): merged, not appended.
                "add": [
                    {"item_id": ITEM_A, "location_id": null, "lot_no": " L1 ",
                     "counted_quantity": "14", "unit_cost": "2.50"},
                    {"item_id": ITEM_C, "location_id": null, "counted_quantity": "1"},
                ],
            }),
        ),
    );
    enqueue(
        &env,
        counts(
            doc,
            json!({"add": [{"item_id": ITEM_C, "location_id": null, "lot_no": "",
                            "counted_quantity": "4"}]}),
        ),
    );

    let (got, draft) = lines(&env, doc);
    assert!(draft);
    assert_eq!(got.len(), 3, "equal lines merge by balance key");
    assert_eq!(counted(&got), [json!("14"), json!("5"), json!("4")]);
    assert_eq!(got[0]["unit_cost"], "2.50");
    assert_eq!(got[0]["id"], LINE_1);
}

#[tokio::test]
async fn a_settled_action_no_longer_shows() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    let key = enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": LINE_2, "counted_quantity": "8"}]}),
        ),
    );
    assert_eq!(counted(&lines(&env, doc).0), [json!("10"), json!("8")]);

    settle(&env, key);

    let (got, draft) = lines(&env, doc);
    assert!(!draft);
    assert_eq!(counted(&got), [json!("10"), json!("5")]);
    let page = env.engine.list(&name(DOCS), &ListQuery::default()).unwrap();
    assert!(page.drafts.is_empty());
}

#[tokio::test]
async fn an_action_on_another_record_does_not_leak() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    let other = count_document(&env);
    enqueue(
        &env,
        counts(
            other,
            json!({"counts": [{"line_id": LINE_1, "counted_quantity": "99"}]}),
        ),
    );

    let (got, draft) = lines(&env, doc);
    assert!(!draft);
    assert_eq!(counted(&got), [json!("10"), json!("5")]);
    assert_eq!(counted(&lines(&env, other).0), [json!("99"), json!("5")]);
    let page = env.engine.list(&name(DOCS), &ListQuery::default()).unwrap();
    assert_eq!(page.drafts, [other]);
}

#[tokio::test]
async fn actions_that_cannot_be_projected_are_left_out() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    // A line that is not on the document: the server decides, not us.
    enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": Uuid::now_v7(), "counted_quantity": "1"},
                              {"line_id": LINE_1, "counted_quantity": "2"}]}),
        ),
    );
    // Another body shape, and another action.
    enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": LINE_1, "counted_quantity": "3"}], "note": "x"}),
        ),
    );
    enqueue(&env, action("post", DOCS, doc, json!({"lines": []})));

    let (got, draft) = lines(&env, doc);
    assert!(!draft, "nothing projected, nothing pending shown");
    assert_eq!(counted(&got), [json!("10"), json!("5")]);

    // A `counts` of another resource is not a stock count.
    let quote = Uuid::now_v7();
    put_row(
        &env.store,
        "sales-quotes",
        &quote.to_string(),
        json!({"lines": [{"id": LINE_1, "counted_quantity": "1"}]}),
    );
    enqueue(
        &env,
        action(
            "counts",
            "sales-quotes",
            quote,
            json!({"counts": [{"line_id": LINE_1, "counted_quantity": "9"}]}),
        ),
    );
    let got = env
        .engine
        .get(&name("sales-quotes"), quote)
        .unwrap()
        .unwrap();
    assert!(!got.draft);
    assert_eq!(got.row.fields["lines"][0]["counted_quantity"], "1");
}

#[tokio::test]
async fn an_update_draft_and_an_action_both_show() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    enqueue(
        &env,
        draft(MutationOp::Update, DOCS, doc, json!({"notes": "depo A"})),
    );
    enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": LINE_1, "counted_quantity": "11"}]}),
        ),
    );

    let got = env.engine.get(&name(DOCS), doc).unwrap().unwrap();
    assert!(got.draft);
    assert_eq!(got.row.fields["notes"], "depo A");
    let lines = got.row.fields["lines"].as_array().unwrap();
    assert_eq!(counted(lines), [json!("11"), json!("5")]);
    assert_eq!(mirror_counted(&env, doc), [json!("10"), json!("5")]);
}

#[tokio::test]
async fn a_count_shows_on_the_saved_base_when_the_mirror_row_is_gone() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": LINE_1, "counted_quantity": "12"}]}),
        ),
    );
    assert!(env.store.remove_row(&name(DOCS), doc).unwrap());
    let (got, draft) = lines(&env, doc);
    assert!(draft);
    assert_eq!(counted(&got), [json!("12"), json!("5")]);
}

#[tokio::test]
async fn a_count_lies_over_the_newer_mirror_row_not_the_old_base() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": LINE_2, "counted_quantity": "8"}]}),
        ),
    );
    // A pull refreshes the document after the enqueue saved its base.
    put_row(
        &env.store,
        DOCS,
        &doc.to_string(),
        json!({
            "doc_type": "count", "status": "draft", "notes": "yeni",
            "lines": [
                {"id": LINE_1, "item_id": ITEM_A, "location_id": null, "lot_no": "L1", "counted_quantity": "10"},
                {"id": LINE_2, "item_id": ITEM_B, "location_id": null, "lot_no": null, "counted_quantity": "5"},
            ],
        }),
    );
    let got = env.engine.get(&name(DOCS), doc).unwrap().unwrap();
    assert_eq!(got.row.fields["notes"], "yeni");
    assert_eq!(
        counted(got.row.fields["lines"].as_array().unwrap()),
        [json!("10"), json!("8")]
    );
}

#[tokio::test]
async fn another_action_with_a_counts_body_is_not_projected() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    enqueue(
        &env,
        action(
            "recount",
            DOCS,
            doc,
            json!({"counts": [{"line_id": LINE_1, "counted_quantity": "2"}]}),
        ),
    );
    let (got, draft) = lines(&env, doc);
    assert!(!draft);
    assert_eq!(counted(&got), [json!("10"), json!("5")]);
}

#[tokio::test]
async fn a_child_counts_action_is_not_projected() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    enqueue(
        &env,
        NewMutation {
            parent_id: Some(Uuid::now_v7()),
            ..counts(
                doc,
                json!({"counts": [{"line_id": LINE_1, "counted_quantity": "2"}]}),
            )
        },
    );
    let (got, draft) = lines(&env, doc);
    assert!(!draft);
    assert_eq!(counted(&got), [json!("10"), json!("5")]);
}

#[tokio::test]
async fn a_count_does_not_bring_back_a_deleted_draft() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    enqueue(&env, draft(MutationOp::Delete, DOCS, doc, json!({})));
    let _ = env.engine.enqueue(counts(
        doc,
        json!({"counts": [{"line_id": LINE_1, "counted_quantity": "2"}]}),
    ));
    assert!(env.engine.get(&name(DOCS), doc).unwrap().is_none());
    assert!(
        env.engine
            .list(&name(DOCS), &ListQuery::default())
            .unwrap()
            .rows
            .is_empty()
    );
}

#[tokio::test]
async fn a_sent_count_keeps_showing_until_settled() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    let key = enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": LINE_2, "counted_quantity": "8"}]}),
        ),
    );
    env.store
        .write(|tx| {
            tx.execute(
                "UPDATE outbox_entries SET sent = 1, state = 'in_flight' WHERE key = ?1",
                [key.to_string()],
            )?;
            Ok(())
        })
        .unwrap();
    let (got, draft) = lines(&env, doc);
    assert!(draft);
    assert_eq!(counted(&got), [json!("10"), json!("8")]);
}

#[tokio::test]
async fn an_uncounted_line_shows_as_not_counted() {
    let env = env().await;
    verified(&env).await;
    let doc = count_document(&env);
    // `apply_counts` writes the value as sent: `null` takes the count back.
    enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": LINE_1, "counted_quantity": null}]}),
        ),
    );
    let (got, draft) = lines(&env, doc);
    assert!(draft);
    assert_eq!(counted(&got), [Value::Null, json!("5")]);
}

#[tokio::test]
async fn a_conflicted_or_rejected_count_keeps_showing() {
    // Deliberate, as for drafts: the count stays visible until the user
    // settles it in the inbox or the outbox, instead of seeming lost.
    for state in ["conflict", "rejected", "quarantined"] {
        let env = env().await;
        verified(&env).await;
        let doc = count_document(&env);
        let key = enqueue(
            &env,
            counts(
                doc,
                json!({"counts": [{"line_id": LINE_2, "counted_quantity": "8"}]}),
            ),
        );
        env.store
            .write(|tx| {
                tx.execute(
                    "UPDATE outbox_entries SET sent = 1, state = ?1 WHERE key = ?2",
                    [state.to_owned(), key.to_string()],
                )?;
                Ok(())
            })
            .unwrap();
        let (got, draft) = lines(&env, doc);
        assert!(draft, "{state}");
        assert_eq!(counted(&got), [json!("10"), json!("8")], "{state}");
    }
}

#[tokio::test]
async fn a_count_on_an_unsent_create_adds_lines_but_names_no_line_ids() {
    let env = env().await;
    verified(&env).await;
    let doc = Uuid::now_v7();
    enqueue(
        &env,
        draft(
            MutationOp::Create,
            DOCS,
            doc,
            json!({"doc_type": "count", "status": "draft",
                   "lines": [{"item_id": ITEM_A, "location_id": null, "counted_quantity": "1"}]}),
        ),
    );
    // The create's lines have no ids yet: a count by line id does not fit.
    enqueue(
        &env,
        counts(
            doc,
            json!({"counts": [{"line_id": LINE_1, "counted_quantity": "9"}]}),
        ),
    );
    // An added line merges by balance key or is appended.
    enqueue(
        &env,
        counts(
            doc,
            json!({"add": [
                {"item_id": ITEM_A, "location_id": null, "counted_quantity": "2"},
                {"item_id": ITEM_B, "location_id": null, "counted_quantity": "4"},
            ]}),
        ),
    );
    let (got, draft) = lines(&env, doc);
    assert!(draft);
    assert_eq!(counted(&got), [json!("2"), json!("4")]);
}
