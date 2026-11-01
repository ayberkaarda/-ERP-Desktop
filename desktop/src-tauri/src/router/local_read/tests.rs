//! Offline reads through `api_request`: mirror rows with drafts laid over,
//! the filters the local copy can apply, freshness labels and snapshots.

use keystone_sync::wire::Timestamp;
use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

use super::*;
use crate::dto::api::{ApiResponseDto, ResponseSource};
use crate::router::local_support::*;

const QUOTES: &str = "/api/v1/sales-quotes";
const PARTIES: &str = "/api/v1/parties";
const BALANCES: &str = "/api/v1/stock-balances";
const AT: &str = "2026-10-26T09:30:00+03:00";

fn party(name: &str) -> (Uuid, Value) {
    let id = Uuid::now_v7();
    (id, row(id, 3, json!({"name": name, "city": "Ankara"})))
}

fn quote(date: &str, status: &str) -> (Uuid, Value) {
    let id = Uuid::now_v7();
    let fields = json!({"document_date": date, "status": status, "party_name": "Ege"});
    (id, row(id, 2, fields))
}

fn offline_of(answer: &ApiResponseDto) -> &Value {
    &answer.json().unwrap()["meta"]["offline"]
}

fn with_store(fx: &Fixture) -> Arc<LocalAnswers> {
    Arc::new(LocalAnswers::with_store(fx.store.clone()))
}

// ------------------------------------------------------------- list, item

#[tokio::test(flavor = "multi_thread")]
async fn a_list_comes_from_the_mirror_in_the_server_envelope() {
    let (a, row_a) = party("Ankara Ltd");
    let (b, row_b) = party("Bursa AŞ");
    let (c, row_c) = party("Çorum");
    let fx = fixture(vec![("parties", vec![row_a, row_b, row_c])]).await;
    fx.go_offline();

    let second = fx
        .call(get(PARTIES, json!([["page", "2"], ["per_page", "2"]])))
        .await;

    assert_eq!(second.status, 200);
    assert_eq!(second.source, ResponseSource::Local);
    assert_eq!(ids(&second), [c]);
    assert_eq!(
        second.json().unwrap()["meta"]["pagination"],
        json!({"current_page": 2, "per_page": 2, "total": 3, "last_page": 2})
    );
    let first = fx.call(get(PARTIES, json!([["per_page", "2"]]))).await;
    assert_eq!(ids(&first), [a, b]);
    assert_eq!(first.json().unwrap()["data"][0]["name"], "Ankara Ltd");
    assert_eq!(first.json().unwrap()["data"][0]["version"], 3);
    assert_eq!(fx.received(PARTIES).await, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn search_folds_turkish_text_under_both_parameter_names() {
    let (a, row_a) = party("İSTANBUL Şişli");
    let (_, row_b) = party("Bursa");
    let fx = fixture(vec![("parties", vec![row_a, row_b])]).await;
    fx.go_offline();

    for name in ["search", "q"] {
        let answer = fx.call(get(PARTIES, json!([[name, "istan sis"]]))).await;
        assert_eq!(ids(&answer), [a], "{name}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_window_field_filters_and_sorts_documents() {
    let (old, row_old) = quote("2026-10-01", "draft");
    let (mid, row_mid) = quote("2026-10-10", "draft");
    let (new, row_new) = quote("2026-10-20", "sent");
    let fx = fixture(vec![("sales-quotes", vec![row_old, row_mid, row_new])]).await;
    fx.go_offline();
    let list = |query: Value| fx.call(get(QUOTES, query));

    assert_eq!(ids(&list(json!([])).await), [new, mid, old]);
    assert_eq!(
        ids(&list(json!([["sort", "document_date"]])).await),
        [old, mid, new]
    );
    assert_eq!(
        ids(&list(json!([["sort", "-document_date"]])).await),
        [new, mid, old]
    );
    assert_eq!(
        ids(&list(json!([["filter[document_date]", "2026-10-10"]])).await),
        [mid]
    );
    assert_eq!(
        ids(&list(json!([["filter[document_date]", "2026-10-10,2026-10-20"]])).await),
        [new, mid]
    );
    let range = json!([
        ["filter[date_from]", "2026-10-02"],
        ["filter[date_to]", "2026-10-10"]
    ]);
    assert_eq!(ids(&list(range).await), [mid]);
}

#[tokio::test(flavor = "multi_thread")]
async fn other_filters_are_refused_offline_and_named() {
    let (_, row_a) = quote("2026-10-01", "draft");
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();

    let answer = fx
        .call(get(
            QUOTES,
            json!([
                ["filter[status]", "draft"],
                ["sort", "total"],
                ["open", "1"]
            ]),
        ))
        .await;

    assert_eq!(answer.status, 503);
    assert_eq!(answer.source, ResponseSource::Local);
    assert_eq!(code(&answer), "OFFLINE_UNAVAILABLE");
    assert_eq!(
        offline_of(&answer)["unsupported_filters"],
        json!(["filter[status]", "sort", "open"])
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn online_an_unsupported_filter_goes_to_the_server() {
    let (_, row_a) = party("Acme");
    let fx = fixture(vec![("parties", vec![row_a])]).await;
    Mock::given(method("GET"))
        .and(path(PARTIES))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": [] })))
        .mount(&fx.server)
        .await;

    let answer = fx
        .call_with(
            with_store(&fx),
            get(PARTIES, json!([["filter[role]", "customer"]])),
        )
        .await;

    assert_eq!(answer.source, ResponseSource::Network);
    assert_eq!(fx.received(PARTIES).await, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn online_a_complete_copy_answers_without_the_server() {
    let (a, row_a) = party("Acme");
    let fx = fixture(vec![("parties", vec![row_a])]).await;

    let answer = fx.call_with(with_store(&fx), get(PARTIES, json!([]))).await;

    assert_eq!(answer.source, ResponseSource::Local);
    assert_eq!(ids(&answer), [a]);
    assert_eq!(fx.received(PARTIES).await, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_item_comes_from_the_mirror_and_a_missing_one_is_not_found() {
    let (a, row_a) = party("Acme");
    let fx = fixture(vec![("parties", vec![row_a])]).await;
    fx.go_offline();

    let answer = fx.call(get(&format!("{PARTIES}/{a}"), json!([]))).await;
    assert_eq!(answer.status, 200);
    assert_eq!(answer.json().unwrap()["data"]["name"], "Acme");
    assert_eq!(offline_of(&answer)["pending"], Value::Null);

    let path = format!("{PARTIES}/{}", Uuid::now_v7());
    let missing = fx.call_with(with_store(&fx), get(&path, json!([]))).await;
    assert_eq!(missing.status, 404);
    assert_eq!(code(&missing), "NOT_FOUND");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_item_read_with_a_query_is_not_guessed() {
    let (a, row_a) = party("Acme");
    let fx = fixture(vec![("parties", vec![row_a])]).await;
    fx.go_offline();

    let path = format!("{PARTIES}/{a}");
    let answer = fx.call(get(&path, json!([["include", "x"]]))).await;

    assert_eq!(answer.status, 503);
    assert_eq!(
        offline_of(&answer)["unsupported_filters"],
        json!(["include"])
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_document_outside_the_window_is_unavailable_not_missing() {
    let (_, row_a) = quote("2026-10-01", "draft");
    let fx = fixture(vec![("sales-quotes", vec![row_a])]).await;
    fx.go_offline();

    let path = format!("{QUOTES}/{}", Uuid::now_v7());
    let answer = fx.call_with(with_store(&fx), get(&path, json!([]))).await;

    assert_eq!(answer.status, 503);
    assert_eq!(code(&answer), "OFFLINE_UNAVAILABLE");
}

#[tokio::test(flavor = "multi_thread")]
async fn children_are_read_under_their_parent_only() {
    let (item_a, item_b) = (Uuid::now_v7(), Uuid::now_v7());
    let (va, vb) = (Uuid::now_v7(), Uuid::now_v7());
    let fx = fixture(vec![(
        "items.variants",
        vec![
            row(va, 1, json!({"item_id": item_a, "code": "A"})),
            row(vb, 1, json!({"item_id": item_b, "code": "B"})),
        ],
    )])
    .await;
    fx.go_offline();

    let list = fx
        .call(get(&format!("/api/v1/items/{item_a}/variants"), json!([])))
        .await;
    assert_eq!(ids(&list), [va]);

    let good = format!("/api/v1/items/{item_a}/variants/{va}");
    assert_eq!(fx.call(get(&good, json!([]))).await.status, 200);
    let foreign = format!("/api/v1/items/{item_a}/variants/{vb}");
    assert_ne!(fx.call(get(&foreign, json!([]))).await.status, 200);
}

// ----------------------------------------------------------- drafts, labels

#[tokio::test(flavor = "multi_thread")]
async fn drafts_are_laid_over_reads() {
    let (a, row_a) = party("Ankara Ltd");
    let fx = fixture(vec![("parties", vec![row_a])]).await;
    fx.go_offline();

    let created = fx
        .call(send(
            "POST",
            PARTIES,
            None,
            Some(json!({"name": "Yeni Cari"})),
        ))
        .await;
    let id: Uuid = created.json().unwrap()["data"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();

    let list = fx.call(get(PARTIES, json!([]))).await;
    assert_eq!(ids(&list), [id, a]);
    assert_eq!(offline_of(&list)["pending"], true);
    let item = fx.call(get(&format!("{PARTIES}/{id}"), json!([]))).await;
    assert_eq!(item.json().unwrap()["data"]["name"], "Yeni Cari");
    assert_eq!(offline_of(&item)["pending"], true);
    let found = fx.call(get(PARTIES, json!([["search", "yeni"]]))).await;
    assert_eq!(ids(&found), [id]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_draft_makes_a_resource_readable_before_it_has_rows() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    assert_eq!(fx.call(get(PARTIES, json!([]))).await.status, 503);

    let created = fx
        .call(send("POST", PARTIES, None, Some(json!({"name": "Yeni"}))))
        .await;

    assert_eq!(created.status, 202);
    assert_eq!(ids(&fx.call(get(PARTIES, json!([]))).await).len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_row_deleted_in_a_draft_is_not_found() {
    let (a, row_a) = quote("2026-10-01", "draft");
    let (_, row_b) = quote("2026-10-02", "draft");
    let fx = fixture(vec![("sales-quotes", vec![row_a, row_b])]).await;
    fx.go_offline();
    let path = format!("{QUOTES}/{a}");

    assert_eq!(fx.call(send("DELETE", &path, None, None)).await.status, 202);

    let answer = fx.call(get(&path, json!([]))).await;
    assert_eq!(answer.status, 404);
    assert_eq!(code(&answer), "NOT_FOUND");
    assert!(!ids(&fx.call(get(QUOTES, json!([]))).await).contains(&a));
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_say_how_fresh_they_are() {
    let (_, row_a) = party("Acme");
    let fx = fixture(vec![("parties", vec![row_a])]).await;
    fx.go_offline();

    let answer = fx.call_with(with_store(&fx), get(PARTIES, json!([]))).await;

    let offline = offline_of(&answer);
    assert_eq!(offline["partial"], false);
    assert_eq!(offline["stale"], false);
    let state = fx.store.resource_state(&name("parties")).unwrap().unwrap();
    assert_eq!(offline["as_of"], json!(state.synced_at));
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unfinished_download_is_labelled_partial() {
    let (_, row_a) = party("Acme");
    let fx = fixture_with(vec![("parties", vec![row_a])], &["parties"], 2).await;
    fx.go_offline();

    let answer = fx.call_with(with_store(&fx), get(PARTIES, json!([]))).await;

    assert_eq!(answer.status, 200);
    assert_eq!(offline_of(&answer)["partial"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn online_first_answers_are_stale_offline() {
    let id = Uuid::now_v7();
    let invoice = row(
        id,
        1,
        json!({"document_date": "2026-10-01", "status": "issued"}),
    );
    let fx = fixture(vec![("sales-invoices", vec![invoice])]).await;
    fx.go_offline();

    let list = fx.call(get("/api/v1/sales-invoices", json!([]))).await;

    assert_eq!(ids(&list), [id]);
    assert_eq!(offline_of(&list)["stale"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn without_the_store_a_copy_is_never_claimed_complete() {
    let (_, row_a) = party("Acme");
    let fx = fixture(vec![("parties", vec![row_a])]).await;
    let resolver = LocalAnswers::default();

    assert_eq!(
        resolver.local_copy(&fx.engine, &name("parties")).unwrap(),
        LocalCopy::Partial
    );
    assert_eq!(
        resolver.local_copy(&fx.engine, &name("units")).unwrap(),
        LocalCopy::Missing
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn the_store_decides_the_state_of_the_copy_when_it_is_given() {
    let (_, row_a) = party("Acme");
    let (_, row_b) = party("Bursa");
    let seed = vec![("parties", vec![row_a]), ("units", vec![row_b])];
    let fx = fixture_with(seed, &["units"], 2).await;
    let resolver = LocalAnswers::with_store(fx.store.clone());

    assert_eq!(
        resolver.local_copy(&fx.engine, &name("parties")).unwrap(),
        LocalCopy::Complete
    );
    assert_eq!(
        resolver.local_copy(&fx.engine, &name("units")).unwrap(),
        LocalCopy::Partial
    );
}

// ---------------------------------------------------------------- snapshots

fn stored(fx: &Fixture, data: &Value) {
    let client = fx.state.client().unwrap();
    let generation = client.session().record().unwrap().generation;
    fx.engine
        .put_snapshot(
            &name("stock-balances"),
            data,
            &Timestamp(AT.into()),
            generation,
        )
        .unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn a_snapshot_answers_offline_as_of_its_time() {
    let fx = fixture(vec![]).await;
    let body = json!({
        "data": [{"item_id": "a", "quantity": "4"}],
        "meta": {"pagination": {"current_page": 1, "per_page": 25, "total": 1, "last_page": 1}}
    });
    stored(&fx, &body);
    fx.go_offline();

    let answer = fx.call(get(BALANCES, json!([["per_page", "25"]]))).await;

    assert_eq!(answer.status, 200);
    assert_eq!(answer.source, ResponseSource::Local);
    let json = answer.json().unwrap();
    assert_eq!(json["data"], body["data"]);
    assert_eq!(json["meta"]["pagination"], body["meta"]["pagination"]);
    assert_eq!(json["meta"]["offline"]["as_of"], AT);
    assert_eq!(json["meta"]["offline"]["stale"], true);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_snapshot_stored_without_an_envelope_gets_one() {
    let fx = fixture(vec![]).await;
    stored(&fx, &json!([{"quantity": "4"}]));
    fx.go_offline();

    let answer = fx.call(get(BALANCES, json!([]))).await;

    assert_eq!(answer.json().unwrap()["data"], json!([{"quantity": "4"}]));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_snapshot_cannot_answer_a_narrower_question() {
    let fx = fixture(vec![]).await;
    stored(&fx, &json!({"data": []}));
    fx.go_offline();

    let filtered = fx
        .call(get(BALANCES, json!([["filter[warehouse_id]", "a"]])))
        .await;
    assert_eq!(filtered.status, 503);
    assert_eq!(
        offline_of(&filtered)["unsupported_filters"],
        json!(["filter[warehouse_id]"])
    );
    let second = fx.call(get(BALANCES, json!([["page", "2"]]))).await;
    assert_eq!(offline_of(&second)["unsupported_filters"], json!(["page"]));
}

#[tokio::test(flavor = "multi_thread")]
async fn no_snapshot_is_unavailable_offline() {
    let fx = fixture(vec![]).await;
    fx.go_offline();

    let answer = fx.call(get(BALANCES, json!([]))).await;

    assert_eq!(answer.status, 503);
    assert_eq!(code(&answer), "OFFLINE_UNAVAILABLE");
}

// ------------------------------------------------------------- local access

#[tokio::test(flavor = "multi_thread")]
async fn a_new_sign_in_reads_nothing_of_the_previous_one() {
    let (_, row_a) = party("Acme");
    let fx = fixture(vec![("parties", vec![row_a])]).await;
    stored(&fx, &json!({"data": []}));
    fx.go_offline();
    fx.sign_in_again().await;

    for path in [PARTIES, BALANCES] {
        for resolver in [with_store(&fx), Arc::new(LocalAnswers::default())] {
            let answer = fx.call_with(resolver, get(path, json!([]))).await;
            assert_eq!(answer.status, 503, "{path}");
            assert_eq!(code(&answer), "OFFLINE_UNAVAILABLE");
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_resolver_of_the_command_answers_locally() {
    let (a, row_a) = party("Acme");
    let fx = fixture(vec![("parties", vec![row_a])]).await;
    fx.go_offline();

    assert_eq!(ids(&fx.call(get(PARTIES, json!([]))).await), [a]);
}
