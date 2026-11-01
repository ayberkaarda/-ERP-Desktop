//! Offline writes through `api_request`: the accept/refuse matrix of every
//! `write` resource of the manifest, the draft each accepted write queues,
//! repeats of an `Idempotency-Key`, and the way to `applied`.

use std::sync::Arc;

use keystone_sync::engine::Trigger;
use keystone_sync::outbox::OutboxState;
use keystone_sync::store::offline_manifest;
use wiremock::matchers::{method, path};
use wiremock::{Mock, Request, ResponseTemplate};

use super::*;
use crate::dto::api::ResponseSource;
use crate::router::decide::OFFLINE_MANIFEST;
use crate::router::local_support::*;

const PARTIES: &str = "/api/v1/parties";
const QUOTES: &str = "/api/v1/sales-quotes";
const STOCK: &str = "/api/v1/stock-documents";

fn doc(status: &str, extra: Value) -> (Uuid, Value) {
    let id = Uuid::now_v7();
    let mut fields = extra;
    fields["status"] = json!(status);
    fields["document_date"] = json!("2026-10-20");
    (id, row(id, 4, fields))
}

fn pending(answer: &ApiResponseDto) {
    assert_eq!(answer.status, 202, "{:?}", answer.json());
    assert_eq!(answer.source, ResponseSource::Local);
    assert_eq!(answer.json().unwrap()["meta"]["offline"]["pending"], true);
}

fn refused(answer: &ApiResponseDto, status: u16, expected: &str) {
    assert_eq!(answer.status, status, "{:?}", answer.json());
    assert_eq!(answer.source, ResponseSource::Local);
    assert_eq!(code(answer), expected);
}

fn data_id(answer: &ApiResponseDto) -> Uuid {
    answer.json().unwrap()["data"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}

// ------------------------------------------------------------------- matrix

type Target = Option<(&'static str, Option<&'static str>)>;
type Verdict = Option<(u16, &'static str)>;

/// One write of the matrix.
struct Case {
    resource: &'static str,
    op: MutationOp,
    action: Option<&'static str>,
    /// Row status and `doc_type` of the target; `None` for create.
    target: Target,
    body: Value,
    /// `None`: queued.
    refused: Verdict,
}

fn case(resource: &'static str, op: MutationOp, target: Target, body: Value, v: Verdict) -> Case {
    Case {
        resource,
        op,
        action: None,
        target,
        body,
        refused: v,
    }
}

const LOCKED: Verdict = Some((409, "DOCUMENT_LOCKED"));
const NOT_ALLOWED: Verdict = Some((422, "SYNC_OFFLINE_WRITE_NOT_ALLOWED"));

fn matrix() -> Vec<Case> {
    use MutationOp::{Action, Create, Delete, Update};
    const STOCK_DOCS: &str = "stock-documents";
    let edit = || json!({"notes": "x"});
    let mut cases = vec![case("parties", Create, None, json!({"name": "A"}), None)];
    for resource in ["sales-quotes", "sales-orders", "purchase-requests"] {
        cases.push(case(resource, Create, None, edit(), None));
        cases.push(case(resource, Update, Some(("draft", None)), edit(), None));
        cases.push(case(
            resource,
            Delete,
            Some(("draft", None)),
            json!({}),
            None,
        ));
        let approved = Some(("approved", None));
        cases.push(case(resource, Update, approved, edit(), LOCKED));
        cases.push(case(resource, Delete, approved, json!({}), LOCKED));
    }
    let rejected = Some(("rejected", None));
    for resource in ["sales-quotes", "sales-orders"] {
        cases.push(case(resource, Update, rejected, edit(), LOCKED));
        cases.push(case(resource, Delete, rejected, json!({}), LOCKED));
    }
    cases.push(case("purchase-requests", Update, rejected, edit(), None));
    cases.push(case("purchase-requests", Delete, rejected, json!({}), None));

    let count: Target = Some(("draft", Some("count")));
    let receipt: Target = Some(("draft", Some("receipt")));
    let posted: Target = Some(("posted", Some("count")));
    let to_receipt = json!({"doc_type": "receipt"});
    cases.extend([
        case(STOCK_DOCS, Create, None, json!({"doc_type": "count"}), None),
        case(STOCK_DOCS, Create, None, to_receipt.clone(), NOT_ALLOWED),
        case(STOCK_DOCS, Update, count, edit(), None),
        case(STOCK_DOCS, Update, count, to_receipt, NOT_ALLOWED),
        case(STOCK_DOCS, Update, receipt, edit(), NOT_ALLOWED),
        case(STOCK_DOCS, Update, posted, edit(), LOCKED),
        case(STOCK_DOCS, Delete, count, json!({}), None),
        case(STOCK_DOCS, Delete, receipt, json!({}), NOT_ALLOWED),
        case(STOCK_DOCS, Delete, posted, json!({}), LOCKED),
    ]);
    for (target, refused) in [(count, None), (receipt, NOT_ALLOWED), (posted, LOCKED)] {
        cases.push(Case {
            resource: STOCK_DOCS,
            op: Action,
            action: Some("counts"),
            target,
            body: json!({"counts": [{"line_id": "l", "counted_quantity": "3"}]}),
            refused,
        });
    }
    cases
}

fn method_of(op: MutationOp) -> &'static str {
    match op {
        MutationOp::Create => "POST",
        MutationOp::Update | MutationOp::Action => "PATCH",
        MutationOp::Delete => "DELETE",
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn every_write_of_the_manifest_is_accepted_or_refused_as_it_says() {
    let cases = matrix();
    for spec in offline_manifest(OFFLINE_MANIFEST).unwrap().specs {
        for op in spec.write.iter().flat_map(|w| &w.ops) {
            let accepted = cases.iter().any(|c| {
                c.resource == spec.resource.as_str()
                    && c.op == op.op
                    && c.action == op.action.as_deref()
                    && c.refused.is_none()
            });
            assert!(accepted, "{} {:?} is not in the matrix", spec.resource, op);
        }
    }

    let mut seed: Seed = Vec::new();
    let mut targets = Vec::new();
    for case in &cases {
        let target = case.target.map(|(status, doc_type)| {
            let extra = doc_type.map_or(json!({}), |t| json!({"doc_type": t}));
            let (id, row) = doc(status, extra);
            match seed.iter_mut().find(|(name, _)| *name == case.resource) {
                Some((_, rows)) => rows.push(row),
                None => seed.push((case.resource, vec![row])),
            }
            id
        });
        targets.push(target);
    }
    let fx = fixture(seed).await;
    fx.go_offline();

    for (case, target) in cases.iter().zip(targets) {
        let base = format!("/api/v1/{}", case.resource);
        let path = match (target, case.action) {
            (Some(id), Some(action)) => format!("{base}/{id}/{action}"),
            (Some(id), None) => format!("{base}/{id}"),
            _ => base,
        };
        let before = fx.outbox().len();
        let body = (case.op != MutationOp::Delete).then(|| case.body.clone());
        let answer = fx.call(send(method_of(case.op), &path, None, body)).await;
        let label = format!(
            "{} {:?} {:?} {:?}",
            case.resource, case.op, case.action, case.target
        );
        match case.refused {
            None => {
                assert_eq!(answer.status, 202, "{label}: {:?}", answer.json());
                assert_eq!(fx.outbox().len(), before + 1, "{label}");
            }
            Some((status, expected)) => {
                assert_eq!(answer.status, status, "{label}: {:?}", answer.json());
                assert_eq!(code(&answer), expected, "{label}");
                assert_eq!(fx.outbox().len(), before, "{label}");
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn writes_outside_the_manifest_stay_online_only() {
    let (party, row_a) = doc("draft", json!({}));
    let fx = fixture(vec![("parties", vec![row_a])]).await;
    fx.go_offline();
    let id = Uuid::now_v7();

    for (method, path) in [
        ("PATCH", format!("{PARTIES}/{party}")),
        ("DELETE", format!("{PARTIES}/{party}")),
        ("POST", "/api/v1/items".to_owned()),
        ("POST", "/api/v1/sales-deliveries".to_owned()),
        ("POST", format!("{QUOTES}/{id}/send")),
        ("POST", format!("{STOCK}/{id}/post")),
    ] {
        let answer = fx
            .call(send(method, &path, None, Some(json!({"a": 1}))))
            .await;
        refused(&answer, 503, "OFFLINE_UNAVAILABLE");
    }
    assert!(fx.outbox().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_manifest_mismatch_closes_writes_but_not_reads() {
    let (a, row_a) = doc("draft", json!({}));
    let fx = fixture_with(vec![("sales-quotes", vec![row_a])], &[], 3).await;
    fx.go_offline();

    let create = fx
        .call(send("POST", QUOTES, None, Some(json!({"notes": "n"}))))
        .await;
    refused(&create, 422, "SYNC_OFFLINE_WRITE_NOT_ALLOWED");
    let path = format!("{QUOTES}/{a}");
    let update = fx
        .call(send("PATCH", &path, None, Some(json!({"notes": "n"}))))
        .await;
    refused(&update, 422, "SYNC_OFFLINE_WRITE_NOT_ALLOWED");

    assert!(fx.outbox().is_empty());
    assert_eq!(ids(&fx.call(get(QUOTES, json!([]))).await), [a]);
}

/// The reason is the mismatch, whatever else is wrong with the write: the
/// engine alone only sees writes that got as far as a draft.
#[tokio::test(flavor = "multi_thread")]
async fn a_manifest_mismatch_comes_before_the_checks_of_a_draft() {
    let fx = fixture_with(vec![], &[], 3).await;
    fx.go_offline();
    let unknown = format!("{QUOTES}/{}", Uuid::now_v7());

    let not_held = fx
        .call(send("PATCH", &unknown, None, Some(json!({"notes": "n"}))))
        .await;
    refused(&not_held, 422, "SYNC_OFFLINE_WRITE_NOT_ALLOWED");
    let bad_body = fx.call(send("POST", QUOTES, None, None)).await;
    refused(&bad_body, 422, "SYNC_OFFLINE_WRITE_NOT_ALLOWED");

    assert!(fx.outbox().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_target_this_device_does_not_hold_cannot_be_drafted() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let path = format!("{QUOTES}/{}", Uuid::now_v7());

    let answer = fx
        .call(send("PATCH", &path, None, Some(json!({"notes": "x"}))))
        .await;

    refused(&answer, 503, "OFFLINE_UNAVAILABLE");
    assert!(fx.outbox().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_row_with_a_delete_draft_cannot_be_edited() {
    let (a, row_a) = doc("draft", json!({}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();
    let path = format!("{QUOTES}/{a}");
    fx.call(send("DELETE", &path, None, None)).await;

    let answer = fx
        .call(send("PATCH", &path, None, Some(json!({"notes": "x"}))))
        .await;

    refused(&answer, 404, "NOT_FOUND");
    assert_eq!(fx.outbox().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_sign_in_queues_nothing() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    fx.sign_in_again().await;

    let answer = fx
        .call(send("POST", PARTIES, None, Some(json!({"name": "A"}))))
        .await;

    refused(&answer, 503, "OFFLINE_UNAVAILABLE");
}

// --------------------------------------------------------------- the draft

#[tokio::test(flavor = "multi_thread")]
async fn a_create_answers_the_row_and_queues_a_uuid_v7_draft() {
    let fx = fixture(vec![]).await;
    fx.go_offline();

    let answer = fx
        .call(send(
            "POST",
            PARTIES,
            None,
            Some(json!({"name": "Acme", "version": 9})),
        ))
        .await;

    pending(&answer);
    assert_eq!(answer.json().unwrap()["data"]["name"], "Acme");
    let outbox = fx.outbox();
    let m = &outbox[0].mutation;
    assert_eq!(m.op, MutationOp::Create);
    assert_eq!(m.id, data_id(&answer));
    assert_eq!(m.id.get_version_num(), 7);
    assert_eq!(m.base_version, None);
    assert_eq!(Value::Object(m.payload.clone()), json!({"name": "Acme"}));
    assert!(m.changed_fields.is_empty());
    let stamp = regex::Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$").unwrap();
    assert!(stamp.is_match(&m.occurred_at.0), "{}", m.occurred_at.0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_create_keeps_the_id_the_client_chose() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let id = Uuid::now_v7();
    let body = |name: &str| Some(json!({"id": id, "name": name}));

    let answer = fx.call(send("POST", PARTIES, None, body("A"))).await;

    pending(&answer);
    assert_eq!(data_id(&answer), id);
    assert!(!fx.outbox()[0].mutation.payload.contains_key("id"));

    let again = fx.call(send("POST", PARTIES, None, body("B"))).await;
    refused(&again, 422, "VALIDATION_ERROR");
    assert!(again.json().unwrap()["errors"]["fields"]["id"].is_array());
    assert_eq!(fx.outbox().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn bad_bodies_are_validation_errors() {
    let (a, row_a) = doc("draft", json!({}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();
    let path = format!("{QUOTES}/{a}");

    for (method, path, body, field) in [
        ("POST", QUOTES, None, None),
        ("POST", QUOTES, Some(json!([1])), None),
        ("POST", QUOTES, Some(json!({"id": "x"})), Some("id")),
        (
            "POST",
            QUOTES,
            Some(json!({"id": "0192F5A0-0000-7000-8000-00000000000A"})),
            Some("id"),
        ),
        (
            "POST",
            QUOTES,
            Some(json!({"id": "0192f5a0-0000-4000-8000-00000000000a"})),
            Some("id"),
        ),
        ("PATCH", path.as_str(), Some(json!({})), None),
        ("PATCH", path.as_str(), Some(json!({"version": 4})), None),
        (
            "PATCH",
            path.as_str(),
            Some(json!({"version": 0, "notes": "x"})),
            Some("version"),
        ),
        (
            "PATCH",
            path.as_str(),
            Some(json!({"version": "4", "notes": "x"})),
            Some("version"),
        ),
    ] {
        let answer = fx.call(send(method, path, None, body.clone())).await;
        refused(&answer, 422, "VALIDATION_ERROR");
        if let Some(field) = field {
            let fields = &answer.json().unwrap()["errors"]["fields"];
            assert!(fields[field].is_array(), "{body:?}");
        }
    }
    assert!(fx.outbox().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn an_update_is_based_on_the_row_it_changes() {
    let (a, row_a) = doc("draft", json!({"notes": "old", "party_name": "Ege"}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();
    let path = format!("{QUOTES}/{a}");

    let answer = fx
        .call(send("PATCH", &path, None, Some(json!({"notes": "new"}))))
        .await;

    pending(&answer);
    let data = &answer.json().unwrap()["data"];
    assert_eq!(data["notes"], "new");
    assert_eq!(data["party_name"], "Ege", "the draft is laid over the row");
    let outbox = fx.outbox();
    let m = &outbox[0].mutation;
    assert_eq!(m.op, MutationOp::Update);
    assert_eq!(m.base_version, Some(4));
    assert_eq!(m.changed_fields, ["notes"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_update_of_an_older_version_keeps_that_base() {
    let (a, row_a) = doc("draft", json!({"notes": "server"}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();
    let path = format!("{QUOTES}/{a}");

    let answer = fx
        .call(send(
            "PATCH",
            &path,
            None,
            Some(json!({"notes": "mine", "version": 2})),
        ))
        .await;

    pending(&answer);
    let outbox = fx.outbox();
    let m = &outbox[0].mutation;
    assert_eq!(m.base_version, Some(2), "the server must see the old base");
    assert!(!m.payload.contains_key("version"));
    assert_eq!(m.changed_fields, ["notes"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_delete_takes_its_version_from_the_query_or_the_row() {
    let (a, row_a) = doc("draft", json!({}));
    let (b, row_b) = doc("draft", json!({}));
    let fx = fixture(vec![("sales-quotes", vec![row_a, row_b])]).await;
    fx.go_offline();

    let mut request = send("DELETE", &format!("{QUOTES}/{a}"), None, None);
    request["query"] = json!([["version", "3"]]);
    let answer = fx.call(request).await;
    pending(&answer);
    assert_eq!(answer.json().unwrap()["data"], Value::Null);
    let answer = fx
        .call(send("DELETE", &format!("{QUOTES}/{b}"), None, None))
        .await;
    pending(&answer);

    let outbox = fx.outbox();
    let base = |id| {
        outbox
            .iter()
            .find(|e| e.mutation.id == id)
            .unwrap()
            .mutation
            .base_version
    };
    assert_eq!((base(a), base(b)), (Some(3), Some(4)));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_draft_of_a_local_create_is_merged_into_it() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let created = fx
        .call(send("POST", QUOTES, None, Some(json!({"notes": "a"}))))
        .await;
    let path = format!("{QUOTES}/{}", data_id(&created));

    let updated = fx
        .call(send("PATCH", &path, None, Some(json!({"notes": "b"}))))
        .await;

    pending(&updated);
    assert_eq!(updated.json().unwrap()["data"]["notes"], "b");
    let outbox = fx.outbox();
    assert_eq!(outbox.len(), 1);
    assert_eq!(outbox[0].mutation.op, MutationOp::Create);
    assert_eq!(outbox[0].mutation.payload["notes"], "b");

    let deleted = fx.call(send("DELETE", &path, None, None)).await;
    assert_eq!(deleted.status, 200);
    let json = deleted.json().unwrap();
    assert_eq!(json["data"], Value::Null);
    assert_eq!(json["meta"]["offline"]["pending"], Value::Null);
    assert!(fx.outbox().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_document_of_a_local_party_waits_for_that_party() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let party = fx
        .call(send("POST", PARTIES, None, Some(json!({"name": "Yeni"}))))
        .await;

    let quote = fx
        .call(send(
            "POST",
            QUOTES,
            None,
            Some(json!({"party_id": data_id(&party), "lines": []})),
        ))
        .await;

    pending(&quote);
    let outbox = fx.outbox();
    let key = outbox[0].mutation.idempotency_key;
    assert_eq!(outbox[1].mutation.depends_on, Some(vec![key]));
}

#[test]
fn nested_ids_count_as_references() {
    let id = Uuid::now_v7();
    assert!(references(&json!({"a": [{"b": id}]}), id));
    assert!(!references(
        &json!({"a": [{"b": Uuid::now_v7()}], "n": 1}),
        id
    ));
}

// -------------------------------------------------------------- idempotency

#[tokio::test(flavor = "multi_thread")]
async fn a_repeated_create_gives_the_same_draft() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let request = send(
        "POST",
        PARTIES,
        Some("key-1"),
        Some(json!({"name": "Acme"})),
    );

    let first = fx.call(request.clone()).await;
    let second = fx.call(request).await;

    pending(&first);
    assert_eq!(first, second);
    assert_eq!(fx.outbox().len(), 1);
    assert_eq!(fx.outbox()[0].mutation.id.get_version_num(), 7);
}

#[tokio::test(flavor = "multi_thread")]
async fn different_keys_create_different_rows() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let body = || Some(json!({"name": "Acme"}));

    let a = fx.call(send("POST", PARTIES, Some("a"), body())).await;
    let b = fx.call(send("POST", PARTIES, Some("b"), body())).await;
    let c = fx.call(send("POST", QUOTES, Some("a"), body())).await;

    assert_ne!(data_id(&a), data_id(&b));
    refused(&c, 422, "IDEMPOTENCY_KEY_REUSED");
    assert_eq!(fx.outbox().len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_same_key_with_another_body_is_refused() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let body = |name: &str| Some(json!({ "name": name }));
    fx.call(send("POST", PARTIES, Some("k"), body("A"))).await;

    let answer = fx.call(send("POST", PARTIES, Some("k"), body("B"))).await;

    refused(&answer, 422, "IDEMPOTENCY_KEY_REUSED");
    assert_eq!(fx.outbox()[0].mutation.payload["name"], "A");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeated_create_after_the_push_is_the_same_row_online_and_offline() {
    let fx = fixture(vec![]).await;
    fx.mount_push_applied().await;
    fx.go_offline();
    let request = send("POST", PARTIES, Some("k"), Some(json!({"name": "A"})));
    let first = fx.call(request.clone()).await;
    pending(&first);
    fx.engine.run_once(Trigger::Manual).await.unwrap();
    assert!(fx.outbox().is_empty());

    fx.go_online();
    let online = fx.call(request.clone()).await;
    fx.go_offline();
    let offline = fx.call(request).await;

    for again in [&online, &offline] {
        assert_eq!(again.status, 202);
        assert_eq!(again.source, ResponseSource::Local);
        assert_eq!(data_id(again), data_id(&first));
        assert_eq!(again.json().unwrap()["data"]["name"], "A");
    }
    assert_eq!(
        online.json().unwrap()["meta"]["offline"]["pending"],
        Value::Null
    );
    assert!(fx.outbox().is_empty(), "no new draft");
    assert_eq!(fx.pushed().await.len(), 1, "no second push");
    assert_eq!(
        fx.received(PARTIES).await,
        0,
        "no second create on the server"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn repeats_after_the_push_queue_nothing_for_any_operation() {
    let (a, row_a) = doc("draft", json!({}));
    let (b, row_b) = doc("draft", json!({}));
    let id = Uuid::now_v7();
    let stock = row(
        id,
        2,
        json!({"status": "draft", "doc_type": "count", "document_date": "2026-10-20"}),
    );
    let fx = fixture(vec![
        ("sales-quotes", vec![row_a, row_b]),
        ("stock-documents", vec![stock]),
    ])
    .await;
    fx.mount_push_applied().await;
    fx.go_offline();
    let requests = [
        send(
            "PATCH",
            &format!("{QUOTES}/{a}"),
            Some("u"),
            Some(json!({"notes": "x"})),
        ),
        send("DELETE", &format!("{QUOTES}/{b}"), Some("d"), None),
        send(
            "PATCH",
            &format!("{STOCK}/{id}/counts"),
            Some("c"),
            Some(json!({"counts": [1]})),
        ),
    ];
    for request in &requests {
        pending(&fx.call(request.clone()).await);
    }
    fx.engine.run_once(Trigger::Manual).await.unwrap();
    assert!(fx.outbox().is_empty());
    let pushed = fx.pushed().await.len();

    for online in [true, false] {
        if online {
            fx.go_online();
        } else {
            fx.go_offline();
        }
        for request in &requests {
            let again = fx.call(request.clone()).await;
            assert_eq!(again.status, 202, "{:?}", again.json());
            assert_eq!(again.source, ResponseSource::Local);
        }
    }

    assert!(fx.outbox().is_empty());
    assert_eq!(fx.pushed().await.len(), pushed);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeat_is_answered_after_the_row_was_locked() {
    let (a, row_a) = doc("draft", json!({}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.mount_push_applied().await;
    fx.go_offline();
    let path_a = format!("{QUOTES}/{a}");
    let request = send(
        "PATCH",
        &path_a,
        Some("k"),
        Some(json!({"status": "approved"})),
    );
    pending(&fx.call(request.clone()).await);
    fx.engine.run_once(Trigger::Manual).await.unwrap();
    let other = send("PATCH", &path_a, Some("n"), Some(json!({"notes": "x"})));
    refused(&fx.call(other).await, 409, "DOCUMENT_LOCKED");

    let again = fx.call(request).await;

    assert_eq!(again.status, 202);
    assert!(fx.outbox().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_key_racing_past_the_lookup_is_not_stopped_by_a_locked_row() {
    use keystone_sync::outbox::{KeyedOutcome, NewMutation, RequestKey};
    let (a, row_a) = doc("approved", json!({}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    let key = RequestKey {
        key: "k".to_owned(),
        fingerprint: "f".to_owned(),
    };
    let update = NewMutation {
        op: MutationOp::Update,
        action: None,
        resource: name("sales-quotes"),
        id: a,
        parent_id: None,
        base_version: Some(4),
        payload: json!({"notes": "x"}).as_object().cloned().unwrap(),
        depends_on: Vec::new(),
        occurred_at: keystone_sync::wire::Timestamp("2026-10-27T10:15:00Z".into()),
        resolution: None,
    };
    let locked = fx.engine.enqueue(update.clone()).unwrap_err();
    assert_eq!(locked.code(), "DOCUMENT_LOCKED");
    let draft = |status: &str| {
        let mut draft = update.clone();
        draft.id = Uuid::now_v7();
        draft.op = MutationOp::Create;
        draft.base_version = None;
        draft.payload.insert("status".into(), json!(status));
        draft
    };
    let created = draft("approved");
    let id = created.id;
    fx.engine.enqueue_keyed(created, &key).unwrap();

    let again = NewMutation { id, ..update };

    assert!(matches!(
        fx.engine.enqueue_keyed(again, &key).unwrap(),
        KeyedOutcome::Repeat(_)
    ));
}

fn name_rejected() -> Value {
    json!({
        "message": "the name is taken",
        "code": "VALIDATION_ERROR",
        "fields": {"name": ["taken"]},
    })
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeat_of_a_rejected_draft_gives_the_rejection_online_and_offline() {
    let fx = fixture(vec![]).await;
    fx.mount_push_rejected(name_rejected()).await;
    fx.go_offline();
    let request = send("POST", PARTIES, Some("k"), Some(json!({"name": "A"})));
    pending(&fx.call(request.clone()).await);
    fx.engine.run_once(Trigger::Manual).await.unwrap();
    assert_eq!(fx.outbox()[0].state, OutboxState::Rejected);

    let offline = fx.call(request.clone()).await;
    fx.go_online();
    let online = fx.call(request).await;

    for again in [&offline, &online] {
        refused(again, 422, "VALIDATION_ERROR");
        assert_eq!(again.json().unwrap(), &json!({ "errors": name_rejected() }));
    }
    assert_eq!(fx.outbox().len(), 1, "no new draft");
    assert_eq!(fx.received(PARTIES).await, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_rejection_of_a_merged_draft_answers_every_key() {
    let (a, row_a) = doc("draft", json!({}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.mount_push_rejected(name_rejected()).await;
    fx.go_offline();
    let path_a = format!("{QUOTES}/{a}");
    let write =
        |key, notes: &str| send("PATCH", &path_a, Some(key), Some(json!({ "notes": notes })));
    fx.call(write("k1", "one")).await;
    fx.call(write("k2", "two")).await;
    assert_eq!(fx.outbox().len(), 1);
    fx.engine.run_once(Trigger::Manual).await.unwrap();

    refused(&fx.call(write("k1", "one")).await, 422, "VALIDATION_ERROR");
    refused(&fx.call(write("k2", "two")).await, 422, "VALIDATION_ERROR");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_retried_rejection_is_pending_again() {
    let fx = fixture(vec![]).await;
    fx.mount_push_rejected(name_rejected()).await;
    fx.go_offline();
    let request = send("POST", PARTIES, Some("k"), Some(json!({"name": "A"})));
    fx.call(request.clone()).await;
    fx.engine.run_once(Trigger::Manual).await.unwrap();

    fx.engine
        .retry(fx.outbox()[0].mutation.idempotency_key)
        .unwrap();

    pending(&fx.call(request).await);
    assert_eq!(fx.outbox().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeat_after_a_discard_is_a_new_request() {
    let fx = fixture(vec![]).await;
    fx.mount_push_rejected(name_rejected()).await;
    fx.go_offline();
    let request = send("POST", PARTIES, Some("k"), Some(json!({"name": "A"})));
    let first = fx.call(request.clone()).await;
    fx.engine.run_once(Trigger::Manual).await.unwrap();
    fx.engine
        .discard(fx.outbox()[0].mutation.idempotency_key)
        .unwrap();
    assert!(fx.outbox().is_empty());

    let again = fx.call(request).await;

    pending(&again);
    assert_ne!(data_id(&again), data_id(&first));
    assert_eq!(fx.outbox().len(), 1);
}

/// A POST on the server, to count what reaches it.
async fn mount_server_create(fx: &Fixture) {
    Mock::given(method("POST"))
        .and(path(PARTIES))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": {"id": "s"}})))
        .mount(&fx.server)
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeat_of_a_resource_the_user_lost_is_refused_here() {
    let fx = fixture(vec![]).await;
    fx.mount_push_applied().await;
    fx.go_offline();
    let request = send("POST", PARTIES, Some("k"), Some(json!({"name": "A"})));
    pending(&fx.call(request.clone()).await);
    fx.engine.run_once(Trigger::Manual).await.unwrap();
    fx.drop_from_manifest("parties").await;
    fx.engine.run_once(Trigger::Manual).await.unwrap();
    mount_server_create(&fx).await;

    fx.go_online();
    let answer = fx.call(request).await;

    refused(&answer, 403, "FORBIDDEN");
    assert_eq!(answer.json().unwrap().get("data"), None);
    assert_eq!(
        fx.received(PARTIES).await,
        0,
        "the key must not reach the server"
    );
}

/// A recorded key whose row cannot be read because the store failed. The
/// store cannot be made to fail between the lookup and the read from here,
/// so the failure is handed to the real mapping.
struct StoreFailsOnRepeat;

impl crate::router::LocalResolver for StoreFailsOnRepeat {
    fn local_copy(
        &self,
        _: &Engine,
        _: Option<&keystone_sync::store::Store>,
        _: &ResourceName,
    ) -> CommandResult<keystone_sync::store::LocalCopy> {
        Ok(keystone_sync::store::LocalCopy::Missing)
    }

    fn resolve(
        &self,
        _: &Engine,
        _: Option<&keystone_sync::store::Store>,
        _: &crate::router::LocalPlan,
        _: &ApiCall,
    ) -> CommandResult<LocalOutcome> {
        Ok(LocalOutcome::Unsupported {
            unsupported_filters: Vec::new(),
        })
    }

    fn replay(&self, _: &Engine, _: &ApiCall) -> CommandResult<Option<ApiResponseDto>> {
        let failed = crate::commands::CommandError::new("STORE_ERROR", "database is locked");
        repeat_outcome(Err(failed))
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_store_failure_of_a_repeat_stays_an_error_and_sends_nothing() {
    let fx = fixture(vec![]).await;
    mount_server_create(&fx).await;
    let request = send("POST", PARTIES, Some("k"), Some(json!({"name": "A"})));

    let answer = fx.try_call(Arc::new(StoreFailsOnRepeat), request).await;

    assert_eq!(answer.unwrap_err().code, "STORE_ERROR");
    assert_eq!(
        fx.received(PARTIES).await,
        0,
        "the key must not reach the server"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_same_key_with_another_body_is_refused_after_the_push() {
    let fx = fixture(vec![]).await;
    fx.mount_push_applied().await;
    fx.go_offline();
    let body = |name: &str| Some(json!({ "name": name }));
    fx.call(send("POST", PARTIES, Some("k"), body("A"))).await;
    fx.engine.run_once(Trigger::Manual).await.unwrap();

    fx.go_online();
    let answer = fx.call(send("POST", PARTIES, Some("k"), body("B"))).await;

    refused(&answer, 422, "IDEMPOTENCY_KEY_REUSED");
    assert_eq!(fx.received(PARTIES).await, 0);
    assert!(fx.outbox().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeat_gives_the_row_as_it_reads_now() {
    let (a, row_a) = doc("draft", json!({}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();
    let path_a = format!("{QUOTES}/{a}");
    let first = send("PATCH", &path_a, Some("k1"), Some(json!({"notes": "one"})));
    fx.call(first.clone()).await;
    fx.call(send(
        "PATCH",
        &path_a,
        Some("k2"),
        Some(json!({"notes": "two"})),
    ))
    .await;

    let again = fx.call(first).await;

    assert_eq!(again.json().unwrap()["data"]["notes"], "two");
    assert_eq!(fx.outbox()[0].mutation.payload["notes"], "two");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeat_of_a_cancelling_delete_stays_cancelled() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let created = fx
        .call(send("POST", QUOTES, Some("c"), Some(json!({"notes": "a"}))))
        .await;
    let delete = send(
        "DELETE",
        &format!("{QUOTES}/{}", data_id(&created)),
        Some("d"),
        None,
    );
    let first = fx.call(delete.clone()).await;
    assert_eq!(first.status, 200);

    let again = fx.call(delete).await;
    let recreate = fx
        .call(send("POST", QUOTES, Some("c"), Some(json!({"notes": "a"}))))
        .await;

    assert_eq!(again, first);
    assert_eq!(recreate.json().unwrap()["data"], Value::Null);
    assert!(fx.outbox().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_key_nothing_recorded_goes_to_the_server_online() {
    let fx = fixture(vec![]).await;
    Mock::given(method("POST"))
        .and(path(PARTIES))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"data": {}})))
        .mount(&fx.server)
        .await;
    let request = send("POST", PARTIES, Some("fresh"), Some(json!({"name": "A"})));

    let answer = fx.call(request.clone()).await;
    fx.sign_in_again().await;
    let unverified = fx.call(request).await;

    assert_eq!(answer.source, ResponseSource::Network);
    assert_eq!(unverified.source, ResponseSource::Network);
    assert_eq!(fx.received(PARTIES).await, 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeat_of_a_queued_write_queues_nothing() {
    let (a, row_a) = doc("draft", json!({}));
    let (b, row_b) = doc("draft", json!({}));
    let id = Uuid::now_v7();
    let stock = row(
        id,
        2,
        json!({"status": "draft", "doc_type": "count", "document_date": "2026-10-20"}),
    );
    let fx = fixture(vec![
        ("sales-quotes", vec![row_a, row_b]),
        ("stock-documents", vec![stock]),
    ])
    .await;
    fx.go_offline();

    for request in [
        send(
            "PATCH",
            &format!("{QUOTES}/{a}"),
            Some("u"),
            Some(json!({"notes": "x"})),
        ),
        send("DELETE", &format!("{QUOTES}/{b}"), Some("d"), None),
        send(
            "PATCH",
            &format!("{STOCK}/{id}/counts"),
            Some("c"),
            Some(json!({"counts": [1]})),
        ),
    ] {
        let first = fx.call(request.clone()).await;
        pending(&first);
        let before = fx.outbox().len();
        assert_eq!(fx.call(request).await, first);
        assert_eq!(fx.outbox().len(), before);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn without_a_key_every_action_is_a_new_draft() {
    let id = Uuid::now_v7();
    let fields = json!({"status": "draft", "doc_type": "count", "document_date": "2026-10-20"});
    let fx = fixture(vec![("stock-documents", vec![row(id, 2, fields)])]).await;
    fx.go_offline();
    let request = send(
        "PATCH",
        &format!("{STOCK}/{id}/counts"),
        None,
        Some(json!({"counts": [1]})),
    );

    fx.call(request.clone()).await;
    fx.call(request).await;

    assert_eq!(fx.outbox().len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeat_after_the_row_moved_on_is_a_new_write() {
    let (a, row_a) = doc("draft", json!({}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();
    let path = format!("{QUOTES}/{a}");
    let write = |key, notes: &str| send("PATCH", &path, Some(key), Some(json!({ "notes": notes })));

    fx.call(write("k1", "one")).await;
    // A sent write is never merged: the next one gets its own entry.
    Mock::given(method("POST"))
        .and(wiremock::matchers::path("/api/v1/sync/push"))
        .respond_with(ResponseTemplate::new(500).set_body_json(json!({
            "errors": {"message": "x", "code": "SERVER_ERROR"}
        })))
        .mount(&fx.server)
        .await;
    assert!(fx.engine.run_once(Trigger::Manual).await.is_err());
    assert!(fx.outbox()[0].sent);
    fx.call(write("k2", "two")).await;
    assert_eq!(fx.outbox().len(), 2);

    let answer = fx.call(write("k3", "one")).await;

    assert_eq!(answer.json().unwrap()["data"]["notes"], "one");
    let outbox = fx.outbox();
    assert_eq!(outbox.len(), 2);
    assert_eq!(outbox[1].mutation.payload["notes"], "one");
}

#[tokio::test(flavor = "multi_thread")]
async fn repeats_racing_each_other_queue_one_draft() {
    let fx = Arc::new(fixture(vec![]).await);
    fx.go_offline();
    let request = send("POST", PARTIES, Some("race"), Some(json!({"name": "A"})));

    let mut calls = Vec::new();
    for _ in 0..8 {
        let (fx, request) = (fx.clone(), request.clone());
        calls.push(tokio::spawn(async move { fx.call(request).await }));
    }
    for call in calls {
        assert_eq!(call.await.unwrap().status, 202);
    }

    assert_eq!(fx.outbox().len(), 1);
}

// --------------------------------------------------------------- end to end

#[tokio::test(flavor = "multi_thread")]
async fn an_offline_draft_is_pushed_online_and_applied() {
    let (quote, row_quote) = doc("draft", json!({"notes": "old"}));
    let fx = fixture(vec![("sales-quotes", vec![row_quote])]).await;
    fx.mount_push_applied().await;
    fx.go_offline();

    let party = fx
        .call(send(
            "POST",
            PARTIES,
            Some("p-1"),
            Some(json!({"name": "Yeni Cari"})),
        ))
        .await;
    pending(&party);
    let party_id = data_id(&party);
    let edit = fx
        .call(send(
            "PATCH",
            &format!("{QUOTES}/{quote}"),
            Some("q-1"),
            Some(json!({"notes": "new", "party_id": party_id})),
        ))
        .await;
    pending(&edit);
    assert_eq!(fx.engine.status().pending, 2);
    assert!(fx.pushed().await.is_empty(), "offline, nothing leaves");

    fx.engine.run_once(Trigger::Manual).await.unwrap();

    let pushed = fx.pushed().await;
    assert_eq!(pushed.len(), 2);
    let create = &pushed[0];
    assert_eq!(create["op"], "create");
    assert_eq!(create["id"], json!(party_id));
    assert_eq!(create["base_version"], Value::Null);
    assert_eq!(create["payload"], json!({"name": "Yeni Cari"}));
    let update = &pushed[1];
    assert_eq!(update["op"], "update");
    assert_eq!(update["id"], json!(quote));
    assert_eq!(update["base_version"], 4);
    assert_eq!(update["changed_fields"], json!(["notes", "party_id"]));
    assert_eq!(update["depends_on"], json!([create["idempotency_key"]]));

    assert!(fx.outbox().is_empty(), "applied entries are settled");
    assert_eq!(fx.engine.status().pending, 0);
    let stored = fx.engine.get(&name("parties"), party_id).unwrap().unwrap();
    assert!(!stored.draft, "the server row replaced the draft");
    assert_eq!(stored.row.version, Some(1));
    let read = fx
        .call(get(&format!("{PARTIES}/{party_id}"), json!([])))
        .await;
    assert_eq!(read.json().unwrap()["data"]["name"], "Yeni Cari");
}

/// Every pushed write of row `a` is answered with this conflict.
async fn mount_conflict(fx: &Fixture, a: Uuid, code: &'static str, choices: Value) {
    Mock::given(method("POST"))
        .and(path("/api/v1/sync/push"))
        .respond_with(move |request: &Request| {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            let m = &body["mutations"][0];
            let server = row(a, 5, json!({"notes": "theirs", "status": "draft"}));
            ResponseTemplate::new(200).set_body_json(json!({"data": {"results": [{
                "idempotency_key": m["idempotency_key"],
                "resource": m["resource"],
                "id": m["id"],
                "status": "conflict",
                "replayed": false,
                "conflict": {
                    "code": code,
                    "base_version": 4,
                    "server_version": 5,
                    "server_data": server,
                    "conflicting_fields": ["notes"],
                    "choices": choices,
                },
            }]}, "meta": {}}))
        })
        .up_to_n_times(1)
        .with_priority(1)
        .mount(&fx.server)
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_rejection_of_a_conflict_decision_answers_the_first_key() {
    use keystone_sync::conflicts::ResolutionAction;
    use keystone_sync::wire::ConflictChoice;
    let (a, row_a) = doc("draft", json!({"notes": "old"}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();
    let request = send(
        "PATCH",
        &format!("{QUOTES}/{a}"),
        Some("k"),
        Some(json!({"notes": "mine"})),
    );
    fx.call(request.clone()).await;
    let choices = json!(["keep_mine", "take_server", "merge"]);
    mount_conflict(&fx, a, "VERSION_CONFLICT", choices).await;
    fx.mount_push_rejected(name_rejected()).await;
    fx.engine.run_once(Trigger::Manual).await.unwrap();
    let key = fx.outbox()[0].mutation.idempotency_key;

    let action = fx.engine.resolve_conflict(key, ConflictChoice::KeepMine);
    let ResolutionAction::Enqueue(decision) = action.unwrap() else {
        panic!("keep_mine queues a decision");
    };
    fx.engine.enqueue(decision).unwrap();
    fx.engine.run_once(Trigger::Manual).await.unwrap();

    refused(&fx.call(request).await, 422, "VALIDATION_ERROR");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_repeat_after_a_discarded_conflict_is_a_new_request() {
    use keystone_sync::wire::ConflictChoice;
    let (a, row_a) = doc("draft", json!({"notes": "old"}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();
    let request = send(
        "PATCH",
        &format!("{QUOTES}/{a}"),
        Some("k"),
        Some(json!({"notes": "mine"})),
    );
    fx.call(request.clone()).await;
    let choices = json!(["save_as_new_draft", "discard"]);
    mount_conflict(&fx, a, "DOCUMENT_LOCKED", choices).await;
    fx.engine.run_once(Trigger::Manual).await.unwrap();
    let key = fx.outbox()[0].mutation.idempotency_key;

    fx.engine
        .resolve_conflict(key, ConflictChoice::Discard)
        .unwrap();
    assert!(fx.outbox().is_empty());

    pending(&fx.call(request).await);
    assert_eq!(fx.outbox().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_conflict_keeps_the_draft_visible_and_is_not_overwritten() {
    let (a, row_a) = doc("draft", json!({"notes": "old"}));
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();
    let path_a = format!("{QUOTES}/{a}");
    fx.call(send("PATCH", &path_a, None, Some(json!({"notes": "mine"}))))
        .await;
    let choices = json!(["keep_mine", "take_server", "merge"]);
    mount_conflict(&fx, a, "VERSION_CONFLICT", choices).await;

    fx.engine.run_once(Trigger::Manual).await.unwrap();

    assert_eq!(fx.outbox()[0].state, OutboxState::Conflict);
    assert_eq!(fx.engine.conflict_records().unwrap().len(), 1);
    let read = fx.call(get(&path_a, json!([]))).await;
    assert_eq!(read.json().unwrap()["data"]["notes"], "mine");
    assert_eq!(read.json().unwrap()["meta"]["offline"]["pending"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn online_a_write_never_becomes_a_draft() {
    let fx = fixture(vec![]).await;
    Mock::given(method("POST"))
        .and(path(PARTIES))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"data": {}})))
        .mount(&fx.server)
        .await;

    let answer = fx
        .call(send("POST", PARTIES, None, Some(json!({"name": "A"}))))
        .await;

    assert_eq!(answer.status, 201);
    assert_eq!(answer.source, ResponseSource::Network);
    assert!(fx.outbox().is_empty());
}
