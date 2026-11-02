//! Offline list requests on resources with a manifest `query` section,
//! through `api_request`: the requests the web screens send (manual round
//! finding F5 and `backend/tests/Fixtures/Sync/web-list-queries.json`), the
//! server's order and rows (`server_order.json`, read from PostgreSQL), and
//! what stays refused.

use serde_json::{Value, json};
use wiremock::matchers::{method, path};
use wiremock::{Mock, ResponseTemplate};

use super::*;
use crate::dto::api::ResponseSource;
use crate::router::decide::OFFLINE_MANIFEST;
use crate::router::local_support::*;

const PARTIES: &str = "/api/v1/parties";
const ITEMS: &str = "/api/v1/items";
const QUOTES: &str = "/api/v1/sales-quotes";

/// Requests the web frontend sends to mirrored lists (web repository
/// fixture, read only).
const WEB_QUERIES: &str =
    include_str!("../../../../../backend/tests/Fixtures/Sync/web-list-queries.json");

/// Rows and requests with the ids PostgreSQL gives for the server's SQL.
const SERVER_ORDER: &str = include_str!("server_order.json");

fn offline_of(answer: &ApiResponseDto) -> &Value {
    &answer.json().unwrap()["meta"]["offline"]
}

fn pairs(query: &[(&str, &str)]) -> Value {
    Value::Array(query.iter().map(|(n, v)| json!([n, v])).collect())
}

fn id_of(n: u16) -> Uuid {
    format!("0192f5a0-0000-7000-8000-{n:012x}").parse().unwrap()
}

fn with_id(n: u16, fields: Value) -> (Uuid, Value) {
    let id = id_of(n);
    (id, row(id, 1, fields))
}

/// Path of a manifest list stream, a child under `parent`.
fn list_path(resource: &str, parent: Uuid) -> String {
    let manifest: Value = serde_json::from_str(OFFLINE_MANIFEST).unwrap();
    for entry in manifest["resources"].as_array().unwrap() {
        let children = entry["children"].as_array().cloned().unwrap_or_default();
        for found in std::iter::once(entry).chain(children.iter()) {
            if found["resource"] == resource {
                let path = found["path"].as_str().unwrap();
                return match path.split_once('{') {
                    Some((head, tail)) => {
                        let rest = tail.split_once('}').unwrap().1;
                        format!("{head}{parent}{rest}")
                    }
                    None => path.to_owned(),
                };
            }
        }
    }
    panic!("{resource} is not in the manifest");
}

fn leak(text: &str) -> &'static str {
    Box::leak(text.to_owned().into_boxed_str())
}

// ------------------------------------------------------------ F5 requests

#[tokio::test(flavor = "multi_thread")]
async fn the_f5_requests_are_answered_on_this_device() {
    let (p_b, bravo) = with_id(
        0x11,
        json!({"name": "Bravo Tedarik", "code": "P-BRAVO", "roles": ["supplier"], "is_active": false}),
    );
    let (p_c, cevre) = with_id(
        0x12,
        json!({"name": "Çevre Ltd", "code": "P-CEV", "roles": ["customer"], "is_active": true}),
    );
    let (p_a, acme) = with_id(
        0x13,
        json!({"name": "acme", "code": "P-ACME", "roles": ["customer", "supplier"], "is_active": true}),
    );
    let (i_w, widget) = with_id(
        0x21,
        json!({"code": "W-2", "name": "Widget", "is_active": true}),
    );
    let (i_b, bolt) = with_id(
        0x22,
        json!({"code": "BOLT", "name": "Bolt", "is_active": false}),
    );
    let (i_s, screw) = with_id(
        0x23,
        json!({"code": "b-1", "name": "Screw", "is_active": true}),
    );
    let (u_kg, kg) = with_id(
        0x31,
        json!({"code": "KG", "name": "Kilogram", "is_active": true}),
    );
    let (u_ad, ad) = with_id(
        0x32,
        json!({"code": "ADET", "name": "Adet", "is_active": true}),
    );
    let (pt_on, net30) = with_id(0x41, json!({"code": "NET30", "is_active": true}));
    let (_, cash) = with_id(0x42, json!({"code": "CASH", "is_active": false}));
    let (wh_on, main) = with_id(0x51, json!({"code": "MAIN", "is_active": true}));
    let (_, aux) = with_id(0x52, json!({"code": "AUX", "is_active": false}));
    let (tx_on, vat) = with_id(
        0x61,
        json!({"code": "KDV20", "type": "vat", "is_active": true}),
    );
    let (_, wh1) = with_id(
        0x62,
        json!({"code": "WH-1", "type": "withholding", "is_active": false}),
    );
    let (q_old, q1) = with_id(
        0x71,
        json!({"document_date": "2026-10-01", "number": "SQ-1"}),
    );
    let (q_new, q2) = with_id(
        0x72,
        json!({"document_date": "2026-10-20", "number": "SQ-2"}),
    );
    let (s_old, s1) = with_id(
        0x81,
        json!({"document_date": "2026-10-03", "number": "SI-1"}),
    );
    let (s_new, s2) = with_id(
        0x82,
        json!({"document_date": "2026-10-04", "number": "SI-2"}),
    );
    let fx = fixture(vec![
        ("parties", vec![bravo, cevre, acme]),
        ("items", vec![widget, bolt, screw]),
        ("units", vec![kg, ad]),
        ("payment-terms", vec![net30, cash]),
        ("warehouses", vec![main, aux]),
        ("tax-codes", vec![vat, wh1]),
        ("sales-quotes", vec![q1, q2]),
        ("sales-invoices", vec![s1, s2]),
    ])
    .await;
    fx.go_offline();
    let read = |path: &'static str, query: Vec<(&'static str, String)>| {
        let query = Value::Array(query.into_iter().map(|(n, v)| json!([n, v])).collect());
        fx.call(get(path, query))
    };

    let parties = read(
        PARTIES,
        vec![
            ("page", "1".into()),
            ("per_page", "25".into()),
            ("sort", "name".into()),
        ],
    )
    .await;
    assert_eq!(
        (parties.status, parties.source),
        (200, ResponseSource::Local)
    );
    assert_eq!(ids(&parties), [p_a, p_b, p_c]);
    assert_eq!(offline_of(&parties)["applied_filters"], json!(["sort"]));
    let customers = read(PARTIES, vec![("filter[role]", "customer".into())]).await;
    assert_eq!(ids(&customers), [p_c, p_a]);

    let items = read(ITEMS, vec![("sort", "code".into())]).await;
    assert_eq!(ids(&items), [i_s, i_b, i_w]);
    let units = read("/api/v1/units", vec![("sort", "code".into())]).await;
    assert_eq!(ids(&units), [u_ad, u_kg]);

    for (path, active) in [
        ("/api/v1/payment-terms", pt_on),
        ("/api/v1/warehouses", wh_on),
        ("/api/v1/tax-codes", tx_on),
    ] {
        for value in ["1", "true"] {
            let answer = read(path, vec![("filter[is_active]", value.into())]).await;
            assert_eq!(answer.status, 200, "{path} {value}");
            assert_eq!(ids(&answer), [active], "{path} {value}");
        }
    }

    let wanted = format!("{i_w},{}", i_b.to_string().to_uppercase());
    let lookup = read(ITEMS, vec![("filter[id]", wanted)]).await;
    assert_eq!(ids(&lookup), [i_w, i_b]);

    let quotes = read(QUOTES, vec![("sort", "-document_date".into())]).await;
    assert_eq!(ids(&quotes), [q_new, q_old]);
    let invoices = read(
        "/api/v1/sales-invoices",
        vec![("sort", "-document_date".into())],
    )
    .await;
    assert_eq!(invoices.status, 200);
    assert_eq!(ids(&invoices), [s_new, s_old]);
    assert_eq!(fx.received(PARTIES).await + fx.received(ITEMS).await, 0);
}

// ------------------------------------------------------- server equivalence

#[tokio::test(flavor = "multi_thread")]
async fn local_answers_give_the_server_rows_order_and_total() {
    let fixture_json: Value = serde_json::from_str(SERVER_ORDER).unwrap();
    let seed: Seed = fixture_json["rows"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(resource, rows)| (leak(resource), rows.as_array().unwrap().clone()))
        .collect();
    let fx = fixture(seed).await;
    fx.go_offline();

    let requests = fixture_json["requests"].as_array().unwrap();
    assert!(requests.len() >= 50);
    for request in requests {
        let resource = request["resource"].as_str().unwrap();
        let label = format!(
            "{resource} {} ({})",
            request["query"], request["server_sql"]
        );
        let answer = fx
            .call(get(
                &format!("/api/v1/{resource}"),
                request["query"].clone(),
            ))
            .await;
        assert_eq!(answer.status, 200, "{label}");
        let expected: Vec<Uuid> = request["ids"]
            .as_array()
            .unwrap()
            .iter()
            .map(|id| id.as_str().unwrap().parse().unwrap())
            .collect();
        assert_eq!(ids(&answer), expected, "{label}");
        assert_eq!(
            answer.json().unwrap()["meta"]["pagination"]["total"],
            request["total"],
            "{label}"
        );
    }
}

// ---------------------------------------------------------- web coverage

/// `a=1&filter[x]=b` as pairs, `@uuid` replaced.
fn web_pairs(query: &str, uuid: Uuid) -> Vec<(String, String)> {
    query
        .split('&')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let (name, value) = part.split_once('=').unwrap_or((part, ""));
            (name.to_owned(), value.replace("@uuid", &uuid.to_string()))
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn every_known_web_request_is_answered_as_the_web_fixture_classifies_it() {
    let known: Value = serde_json::from_str(WEB_QUERIES).unwrap();
    let queries = known["queries"].as_array().unwrap();
    assert!(queries.len() >= 88, "{}", queries.len());
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let parent = Uuid::now_v7();
    let mut counts = [0usize; 3];

    for entry in queries {
        let resource = entry["resource"].as_str().unwrap();
        let query = web_pairs(entry["query"].as_str().unwrap(), Uuid::now_v7());
        let label = format!("{resource}?{}", entry["query"]);
        let request = Value::Array(query.iter().map(|(n, v)| json!([n, v])).collect());
        let answer = fx.call(get(&list_path(resource, parent), request)).await;
        assert_eq!(answer.source, ResponseSource::Local, "{label}");
        match entry["expect"].as_str().unwrap() {
            "local" => {
                assert_eq!(answer.status, 200, "{label} {:?}", answer.json());
                counts[0] += 1;
            }
            "online_only" => {
                assert_eq!(answer.status, 503, "{label}");
                assert_eq!(code(&answer), "OFFLINE_UNAVAILABLE");
                let offline = offline_of(&answer);
                let refused = offline["unsupported_filters"].as_array().unwrap();
                let online_only = offline["online_only"].as_array().unwrap();
                assert!(!online_only.is_empty(), "{label}");
                for entry in online_only {
                    let param = entry["param"].as_str().unwrap();
                    assert!(refused.iter().any(|r| r == param), "{label} {param}");
                    assert!(!entry["reason"].as_str().unwrap().is_empty());
                }
                // Everything else of the request is declared.
                assert_eq!(refused.len(), online_only.len(), "{label} {refused:?}");
                counts[1] += 1;
            }
            "server_rejects" => {
                assert_eq!(answer.status, 503, "{label}");
                assert!(offline_of(&answer)["online_only"].is_null(), "{label}");
                counts[2] += 1;
            }
            other => panic!("{other}"),
        }
    }
    assert_eq!(counts, [81, 6, 1]);
    assert_eq!(fx.server.received_requests().await.unwrap().len(), 2);
}

// ------------------------------------------------------------- refusals

#[tokio::test(flavor = "multi_thread")]
async fn undeclared_names_are_still_refused_in_request_order() {
    let (_, acme) = with_id(1, json!({"name": "Acme", "roles": ["customer"]}));
    let fx = fixture(vec![("parties", vec![acme])]).await;
    fx.go_offline();

    let answer = fx
        .call(get(
            PARTIES,
            pairs(&[
                ("filter[roles]", "customer"),
                ("sort", "name,type"),
                ("filter[legal_name]", "x"),
                ("filter[is_active]", "1"),
                ("include", "addresses"),
            ]),
        ))
        .await;

    assert_eq!(answer.status, 503);
    assert_eq!(code(&answer), "OFFLINE_UNAVAILABLE");
    assert_eq!(
        offline_of(&answer)["unsupported_filters"],
        json!(["filter[roles]", "sort", "filter[legal_name]", "include"])
    );
    assert!(offline_of(&answer)["online_only"].is_null());
    let details = &answer.json().unwrap()["errors"]["details"];
    assert_eq!(details, &json!({"method": "GET", "path": "/parties"}));
}

#[tokio::test(flavor = "multi_thread")]
async fn online_only_parameters_are_refused_offline_with_their_reason() {
    let (_, bolt) = with_id(1, json!({"code": "BOLT", "is_active": true}));
    let fx = fixture(vec![("items", vec![bolt])]).await;
    fx.go_offline();

    let category = Uuid::now_v7().to_string();
    let answer = fx
        .call(get(
            ITEMS,
            pairs(&[
                ("sort", "code"),
                ("filter[category]", &category),
                ("filter[colour]", "red"),
            ]),
        ))
        .await;

    assert_eq!(answer.status, 503);
    let offline = offline_of(&answer);
    assert_eq!(
        offline["unsupported_filters"],
        json!(["filter[category]", "filter[colour]"])
    );
    let online_only = offline["online_only"].as_array().unwrap();
    assert_eq!(online_only.len(), 1);
    assert_eq!(online_only[0]["param"], "filter[category]");
    assert!(
        online_only[0]["reason"]
            .as_str()
            .unwrap()
            .contains("alt ağac")
    );

    // An empty value is no filter, as on the server.
    let empty = fx
        .call(get(ITEMS, pairs(&[("filter[category]", "")])))
        .await;
    assert_eq!(empty.status, 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn online_an_online_only_filter_goes_to_the_server() {
    let (_, bolt) = with_id(1, json!({"code": "BOLT"}));
    let fx = fixture(vec![("items", vec![bolt])]).await;
    Mock::given(method("GET"))
        .and(path(ITEMS))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": [] })))
        .mount(&fx.server)
        .await;

    let category = Uuid::now_v7().to_string();
    let answer = fx
        .call(get(ITEMS, pairs(&[("filter[category]", &category)])))
        .await;
    assert_eq!(answer.source, ResponseSource::Network);
    assert_eq!(fx.received(ITEMS).await, 1);

    // A declared one is answered here, online too.
    let local = fx.call(get(ITEMS, pairs(&[("sort", "-code")]))).await;
    assert_eq!(local.source, ResponseSource::Local);
    assert_eq!(fx.received(ITEMS).await, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn values_the_server_refuses_are_not_answered() {
    let fx = fixture(vec![]).await;
    fx.go_offline();
    let many: Vec<String> = (0..101).map(|_| Uuid::now_v7().to_string()).collect();
    let two = format!("{},{}", Uuid::now_v7(), Uuid::now_v7());
    let cases: [(&str, (&str, String)); 6] = [
        (PARTIES, ("filter[is_active]", "yes".into())),
        (PARTIES, ("filter[is_active]", "1,2".into())),
        (QUOTES, ("filter[date_from]", "#invalid-date".into())),
        (QUOTES, ("filter[date_to]", "2026-10-01,2026-10-02".into())),
        (ITEMS, ("filter[id]", many.join(","))),
        (QUOTES, ("filter[item_id]", two)),
    ];
    for (path, (name, value)) in cases {
        let answer = fx.call(get(path, json!([[name, value]]))).await;
        assert_eq!(answer.status, 503, "{path} {name}");
        assert_eq!(offline_of(&answer)["unsupported_filters"], json!([name]));
    }
    let hundred = many[..100].join(",");
    let answer = fx.call(get(ITEMS, json!([["filter[id]", hundred]]))).await;
    assert_eq!(answer.status, 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn names_shaped_like_sql_or_paths_are_refused_and_change_nothing() {
    let (_, acme) = with_id(1, json!({"name": "Acme", "code": "A"}));
    let fx = fixture(vec![("parties", vec![acme])]).await;
    fx.go_offline();

    for (name, value) in [
        ("sort", "name') DESC --"),
        ("sort", "name\" DESC"),
        ("sort", "$.name"),
        ("sort", "name.x"),
        ("filter[name') OR 1=1 --]", "x"),
        ("filter[$.roles]", "x"),
        ("filter[roles[0]]", "customer"),
        ("filter[is_active\"]", "1"),
    ] {
        let answer = fx.call(get(PARTIES, json!([[name, value]]))).await;
        assert_eq!(answer.status, 503, "{name}={value}");
        assert_eq!(
            offline_of(&answer)["unsupported_filters"],
            json!([name]),
            "{name}"
        );
    }
    // A hostile value is only a value.
    let answer = fx
        .call(get(PARTIES, json!([["filter[country]", "TR' OR '1'='1"]])))
        .await;
    assert_eq!(answer.status, 200);
    assert!(ids(&answer).is_empty());
    let all = fx.call(get(PARTIES, json!([]))).await;
    assert_eq!(ids(&all).len(), 1);
}

// --------------------------------------------------------- order details

#[tokio::test(flavor = "multi_thread")]
async fn paging_a_sort_with_ties_is_stable() {
    let rows: Vec<(Uuid, Value)> = [5u16, 2, 4, 1, 3]
        .iter()
        .map(|n| with_id(*n, json!({"name": "Aynı", "code": format!("C{n}")})))
        .collect();
    let fx = fixture(vec![(
        "parties",
        rows.iter().map(|(_, row)| row.clone()).collect(),
    )])
    .await;
    fx.go_offline();

    let mut seen = Vec::new();
    for page in ["1", "2", "3"] {
        let answer = fx
            .call(get(
                PARTIES,
                pairs(&[("sort", "-name"), ("per_page", "2"), ("page", page)]),
            ))
            .await;
        assert_eq!(answer.json().unwrap()["meta"]["pagination"]["total"], 5);
        seen.extend(ids(&answer));
    }
    assert_eq!(seen, (1..=5).map(id_of).collect::<Vec<_>>());
    let beyond = fx
        .call(get(PARTIES, pairs(&[("per_page", "2"), ("page", "4")])))
        .await;
    assert_eq!(beyond.status, 200);
    assert!(ids(&beyond).is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn turkish_letters_sort_beside_their_base_letter() {
    let names = [
        "Zeytin", "Çiçek", "cam", "Ilgaz", "İnci", "ılık", "Öz", "Oya", "şeker", "Su", "Üzüm",
        "Ural",
    ];
    let rows: Vec<Value> = names
        .iter()
        .enumerate()
        .map(|(n, name)| with_id(u16::try_from(n).unwrap() + 1, json!({"name": name})).1)
        .collect();
    let fx = fixture(vec![("parties", rows)]).await;
    fx.go_offline();

    let answer = fx.call(get(PARTIES, pairs(&[("sort", "name")]))).await;
    let sorted: Vec<String> = answer.json().unwrap()["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        sorted,
        [
            "cam", "Çiçek", "Ilgaz", "İnci", "ılık", "Oya", "Öz", "şeker", "Su", "Ural", "Üzüm",
            "Zeytin"
        ]
    );
}

// --------------------------------------------------- drafts and isolation

#[tokio::test(flavor = "multi_thread")]
async fn drafts_are_filtered_and_sorted_with_the_mirror() {
    let (b, bravo) = with_id(
        1,
        json!({"name": "Bravo", "roles": ["customer"], "is_active": true}),
    );
    let (d, delta) = with_id(
        2,
        json!({"name": "Delta", "roles": ["customer"], "is_active": true}),
    );
    let (_, echo) = with_id(
        3,
        json!({"name": "Echo", "roles": ["supplier"], "is_active": true}),
    );
    let fx = fixture(vec![("parties", vec![bravo, delta, echo])]).await;
    fx.go_offline();

    let created = fx
        .call(send(
            "POST",
            PARTIES,
            None,
            Some(json!({"name": "Çınar", "roles": ["customer"], "is_active": true})),
        ))
        .await;
    assert_eq!(created.status, 202, "{:?}", created.json());
    let c: Uuid = created.json().unwrap()["data"]["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    fx.call(send(
        "POST",
        PARTIES,
        None,
        Some(json!({"name": "Alfa", "roles": ["supplier"], "is_active": true})),
    ))
    .await;

    let query = pairs(&[("sort", "name"), ("filter[role]", "customer")]);
    let list = fx.call(get(PARTIES, query)).await;
    assert_eq!(ids(&list), [b, c, d]);
    assert_eq!(offline_of(&list)["pending"], true);
    assert_eq!(list.json().unwrap()["meta"]["pagination"]["total"], 3);

    let second = fx
        .call(get(
            PARTIES,
            pairs(&[
                ("sort", "-name"),
                ("filter[role]", "customer"),
                ("per_page", "1"),
                ("page", "2"),
            ]),
        ))
        .await;
    assert_eq!(ids(&second), [c]);
    let found = fx.call(get(PARTIES, pairs(&[("q", "ınar")]))).await;
    assert_eq!(ids(&found), [c]);
}

#[tokio::test(flavor = "multi_thread")]
async fn rows_of_another_company_are_never_listed() {
    let (a, acme) = with_id(
        1,
        json!({"name": "Acme", "roles": ["customer"], "is_active": true}),
    );
    let fx = fixture(vec![("parties", vec![acme])]).await;
    let other = "0192f5a0-0000-7000-8000-0000000000c2";
    let (b, beta) = with_id(
        2,
        json!({"name": "Beta", "roles": ["customer"], "is_active": true}),
    );
    let mut manifest = sync_manifest(3);
    manifest["data"]["company_id"] = json!(other);
    Mock::given(method("GET"))
        .and(path("/api/v1/sync/manifest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(manifest))
        .with_priority(1)
        .mount(&fx.server)
        .await;
    mount_pull(&fx, vec![("parties", vec![beta])]).await;
    fx.go_offline();

    let before = fx
        .call(get(
            PARTIES,
            pairs(&[("sort", "name"), ("filter[role]", "customer")]),
        ))
        .await;
    assert_eq!(ids(&before), [a]);

    let _ = fx
        .engine
        .run_once(keystone_sync::engine::Trigger::Startup)
        .await;
    let after = fx
        .call(get(
            PARTIES,
            pairs(&[("sort", "name"), ("filter[role]", "customer")]),
        ))
        .await;
    assert!(!ids(&after).contains(&a), "{:?}", after.json());
    if after.status == 200 {
        assert_eq!(ids(&after), [b]);
    }
}
