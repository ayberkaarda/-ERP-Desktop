//! List query parameters of the REST API (`backend/app/Core/Http/ListQuery.php`)
//! on the local copy: what can be answered here and what cannot.
//!
//! Always: `page` and `per_page` (1..=[`MAX_PER_PAGE`], default
//! [`DEFAULT_PER_PAGE`]); `q`, the server's search parameter. `search` is
//! ignored, as on the server. Filter values are trimmed, and an empty one is
//! no filter (the server's `TrimStrings` and `ConvertEmptyStringsToNull`).
//!
//! A resource with a manifest `query` section (version 3) maps exactly what
//! it declares:
//!
//! - `sort`: a comma list; every name (without `-`) must be a declared sort.
//!   A blank `sort=` is refused, as the server refuses it (422).
//!   Typed order, then `id` ascending; without `sort`, `default_sort`, else
//!   `id` ascending.
//! - `filter[<name>]`: a declared filter, its value checked by type (`bool`
//!   takes `1`/`true`/`0`/`false`, `date` takes `YYYY-MM-DD`, `uuid` a uuid,
//!   `max_values`); [`invalid_values`] gives the reasons of refused values.
//! - `q`: substring over `search.fields` when declared; refused when the
//!   server also searches what the rows do not carry (`search.server_also`).
//! - `online_only` names are refused like unknown ones; [`online_only`]
//!   gives their reasons.
//!
//! Without a `query` section only the window field sorts and filters:
//! `sort` on it alone, `filter[<window_field>]` (`a` or `a,b`), and
//! `filter[date_from]`/`filter[date_to]` on it, both inclusive.
//!
//! Anything else is named back to the caller: guessing would show a list that
//! looks filtered and is not. An empty filter value is no filter, as on the
//! server.

use std::collections::HashSet;
use std::sync::OnceLock;

use keystone_sync::store::{
    Condition, Filter, FilterField, FilterMatch, FilterOp, ListQuery, OnlineOnly, OrderKey,
    QuerySpec, ResourceSpec, SortKey, Test, TextSearch, ValueType, bool_value, is_date,
    specs_from_offline_manifest,
};
use keystone_sync::wire::ResourceName;
use serde::Serialize;
use serde_json::Value;

use super::decide::OFFLINE_MANIFEST;

pub const DEFAULT_PER_PAGE: u32 = 25;
pub const MAX_PER_PAGE: u32 = 100;

/// A list request the local copy can answer.
#[derive(Debug, Clone, PartialEq)]
pub struct MappedList {
    pub query: ListQuery,
    pub page: u64,
    pub per_page: u32,
    /// Sort, filter and search names applied here, in request order.
    pub applied: Vec<String>,
}

/// Spec of `resource` in the compiled offline manifest.
pub fn spec_of(resource: &ResourceName) -> Option<&'static ResourceSpec> {
    static SPECS: OnceLock<Vec<ResourceSpec>> = OnceLock::new();
    SPECS
        .get_or_init(|| {
            specs_from_offline_manifest(OFFLINE_MANIFEST)
                .expect("compiled offline manifest is valid")
        })
        .iter()
        .find(|spec| &spec.resource == resource)
}

/// Row field that holds the parent of a child resource.
pub fn parent_field(resource: &str) -> Option<&'static str> {
    match resource {
        "items.variants" | "items.barcodes" => Some("item_id"),
        "price-lists.lines" => Some("price_list_id"),
        "warehouses.locations" => Some("warehouse_id"),
        _ => None,
    }
}

/// Maps query `params` of a list. `Err`: the names the local copy cannot
/// apply, in request order.
pub fn list_query(
    spec: &ResourceSpec,
    params: &[(String, String)],
) -> Result<MappedList, Vec<String>> {
    let window = spec.window.as_ref().map(|window| window.field.as_str());
    let declared = spec.query.as_ref();
    let mut mapped = MappedList {
        query: ListQuery::default(),
        page: 1,
        per_page: DEFAULT_PER_PAGE,
        applied: Vec::new(),
    };
    let mut sorted = false;
    let mut unsupported: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for (name, value) in params {
        let applied = match name.as_str() {
            "q" | "sort" => !value.trim().is_empty(),
            _ => filter_name(name).is_some() && !value.trim().is_empty(),
        };
        let known = seen.insert(name.as_str())
            && match name.as_str() {
                "page" => set(value.parse().ok().filter(|p| *p >= 1), &mut mapped.page),
                "per_page" => set(
                    value
                        .parse()
                        .ok()
                        .filter(|n| (1..=MAX_PER_PAGE).contains(n)),
                    &mut mapped.per_page,
                ),
                // The server reads `q` only; `search` changes nothing there.
                "search" => true,
                "q" => {
                    let text = value.trim();
                    match declared.and_then(|q| q.search.as_ref()) {
                        _ if text.is_empty() => true,
                        // The server also searches what the rows do not
                        // carry (item barcodes and variant SKUs): an empty
                        // local answer would look like "no such item".
                        Some(search) if search.server_also.is_some() => false,
                        Some(search) => {
                            mapped.query.text = Some(TextSearch {
                                fields: search.fields.clone(),
                                text: text.to_owned(),
                            });
                            true
                        }
                        None => {
                            mapped.query.search = Some(text.to_owned());
                            true
                        }
                    }
                }
                // `sort=` (blank) is refused by the server (422): Laravel makes
                // it null and `ListQuery` takes a string only.
                "sort" if value.trim().is_empty() => false,
                "sort" => match declared {
                    Some(query) => match typed_order(query, value) {
                        Some(keys) => {
                            sorted |= !keys.is_empty();
                            mapped.query.order = Some(keys);
                            true
                        }
                        None => false,
                    },
                    None => match sort_key(value, window) {
                        Some(key) => {
                            mapped.query.sort.extend(key);
                            true
                        }
                        None => false,
                    },
                },
                // Values are trimmed and an empty one is no filter, as the
                // server's TrimStrings and ConvertEmptyStringsToNull do.
                _ => match filter_name(name) {
                    Some(_) if value.trim().is_empty() => true,
                    Some(filter) => match declared {
                        Some(query) => {
                            let field = query.filters.get(filter);
                            match field.and_then(|f| typed_filter(filter, f, value.trim())) {
                                Some(condition) => {
                                    mapped.query.conditions.push(condition);
                                    true
                                }
                                None => false,
                            }
                        }
                        None => match window_filter(filter, value.trim(), window) {
                            Some(condition) => {
                                mapped.query.filters.push(condition);
                                true
                            }
                            None => false,
                        },
                    },
                    None => false,
                },
            };
        if !known && !unsupported.contains(name) {
            unsupported.push(name.clone());
        } else if known && applied {
            mapped.applied.push(name.clone());
        }
    }
    if !unsupported.is_empty() {
        return Err(unsupported);
    }
    if let Some(query) = declared
        && !sorted
    {
        mapped.query.order = Some(default_order(query));
    }
    let offset = (mapped.page - 1).checked_mul(u64::from(mapped.per_page));
    let Some(offset) = offset.filter(|offset| i64::try_from(*offset).is_ok()) else {
        return Err(vec!["page".to_owned()]);
    };
    mapped.query.offset = offset;
    mapped.query.limit = Some(mapped.per_page);
    Ok(mapped)
}

fn set<T>(value: Option<T>, slot: &mut T) -> bool {
    match value {
        Some(value) => {
            *slot = value;
            true
        }
        None => false,
    }
}

/// `Some(None)`: no sort. `None`: a sort the local copy cannot apply.
fn sort_key(value: &str, window: Option<&str>) -> Option<Option<SortKey>> {
    let mut parts = value.split(',').filter(|part| !part.is_empty());
    let Some(part) = parts.next() else {
        return Some(None);
    };
    let (field, descending) = match part.strip_prefix('-') {
        Some(field) => (field, true),
        None => (part, false),
    };
    if parts.next().is_some() || Some(field) != window {
        return None;
    }
    Some(Some(if descending {
        SortKey::desc(field)
    } else {
        SortKey::asc(field)
    }))
}

fn filter_name(name: &str) -> Option<&str> {
    name.strip_prefix("filter[")?.strip_suffix(']')
}

fn window_filter(name: &str, value: &str, window: Option<&str>) -> Option<Filter> {
    let field = window?;
    match name {
        "date_from" => Some(Filter::new(field, FilterOp::Gte, value)),
        "date_to" => Some(Filter::new(field, FilterOp::Lte, value)),
        _ if name != field => None,
        _ => Some(match value.split_once(',') {
            None => Filter::eq(field, value),
            Some(_) => {
                let values: Vec<Value> = value.split(',').map(Value::from).collect();
                Filter::new(field, FilterOp::In, values)
            }
        }),
    }
}

/// Typed keys of a `sort` value (`-a,b`, empty parts skipped); `None` when
/// a name is not a declared sort of a known type.
fn typed_order(query: &QuerySpec, value: &str) -> Option<Vec<OrderKey>> {
    let mut keys = Vec::new();
    for part in value.split(',').filter(|part| !part.is_empty()) {
        let (name, descending) = match part.strip_prefix('-') {
            Some(name) => (name, true),
            None => (part, false),
        };
        let sort = query.sort.get(name)?;
        if sort.kind == keystone_sync::store::SortType::Unknown {
            return None;
        }
        keys.push(OrderKey {
            field: sort.field_of(name).to_owned(),
            kind: sort.kind,
            descending,
        });
    }
    Some(keys)
}

/// `default_sort` up to its first name without a declared sort.
fn default_order(query: &QuerySpec) -> Vec<OrderKey> {
    let mut keys = Vec::new();
    for part in &query.default_sort {
        match typed_order(query, part) {
            Some(key) => keys.extend(key),
            None => break,
        }
    }
    keys
}

/// The condition of `filter[name]=value` on a declared filter; `None` when
/// the server would refuse the value (or this build cannot apply it).
fn typed_filter(name: &str, filter: &FilterField, value: &str) -> Option<Condition> {
    let kind = filter.kind;
    let valid = |v: &str| match kind {
        ValueType::Bool => bool_value(v).is_some(),
        ValueType::Date => is_date(v),
        ValueType::Integer => v.parse::<i64>().is_ok(),
        ValueType::Uuid => is_uuid(v),
        ValueType::String => true,
        ValueType::Unknown => false,
    };
    let values: Vec<String> = value.split(',').map(str::to_owned).collect();
    let fits = filter
        .max_values
        .is_none_or(|max| values.len() <= usize::try_from(max).unwrap_or(usize::MAX));
    let test = match filter.matching {
        FilterMatch::Eq if fits && values.iter().all(|v| valid(v)) => Test::Eq { kind, values },
        FilterMatch::AnyOf
            if fits && kind != ValueType::Bool && values.iter().all(|v| valid(v)) =>
        {
            Test::AnyOf {
                kind,
                element: filter.element_field.clone(),
                values,
            }
        }
        FilterMatch::Gte | FilterMatch::Lte
            if matches!(kind, ValueType::Date | ValueType::Integer) && valid(value) =>
        {
            let value = value.to_owned();
            if filter.matching == FilterMatch::Gte {
                Test::Gte { kind, value }
            } else {
                Test::Lte { kind, value }
            }
        }
        FilterMatch::Contains if kind == ValueType::String => Test::Contains {
            text: value.to_owned(),
        },
        _ => return None,
    };
    Some(Condition {
        field: filter.field_of(name).to_owned(),
        test,
    })
}

/// `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` in hex digits, any case (the
/// server's `Str::isUuid`; a uuid column refuses anything else).
fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes.iter().enumerate().all(|(i, b)| match i {
            8 | 13 | 18 | 23 => *b == b'-',
            _ => b.is_ascii_hexdigit(),
        })
}

/// A filter value of the request the server would refuse, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct InvalidValue {
    pub param: String,
    pub reason: String,
}

/// Why `value` (trimmed, not empty) does not fit the declared filter.
fn value_problem(filter: &FilterField, value: &str) -> String {
    let count = value.split(',').count();
    if let Some(max) = filter.max_values
        && count > usize::try_from(max).unwrap_or(usize::MAX)
        && !matches!(filter.matching, FilterMatch::Gte | FilterMatch::Lte)
    {
        return format!("more than {max} values");
    }
    match filter.kind {
        ValueType::Uuid => "not a uuid",
        ValueType::Date => "not a date (YYYY-MM-DD)",
        ValueType::Bool => "not a bool (1, true, 0, false)",
        ValueType::Integer => "not an integer",
        ValueType::String | ValueType::Unknown => "not applied on this device",
    }
    .to_owned()
}

/// The declared filters of `params` whose value the server would refuse
/// (`filter[id]=abc`), each with its reason; request order.
pub fn invalid_values(spec: &ResourceSpec, params: &[(String, String)]) -> Vec<InvalidValue> {
    params
        .iter()
        .filter_map(|(name, value)| {
            if name == "sort" && value.trim().is_empty() {
                return Some(InvalidValue {
                    param: name.clone(),
                    reason: "empty".into(),
                });
            }
            let query = spec.query.as_ref()?;
            let filter_name = filter_name(name)?;
            let filter = query.filters.get(filter_name)?;
            let value = value.trim();
            (!value.is_empty() && typed_filter(filter_name, filter, value).is_none()).then(|| {
                InvalidValue {
                    param: name.clone(),
                    reason: value_problem(filter, value),
                }
            })
        })
        .collect()
}

/// The `online_only` entries of `spec` that `params` use: `filter[x]` with a
/// value, or a `sort` naming `x` (`sort=x`). Manifest order; then `q` with a
/// value when the server searches more than the rows carry
/// (`search.server_also`, its text the reason).
pub fn online_only(spec: &ResourceSpec, params: &[(String, String)]) -> Vec<OnlineOnly> {
    let mut found = declared_online_only(spec, params);
    let server_also = spec
        .query
        .as_ref()
        .and_then(|query| query.search.as_ref())
        .and_then(|search| search.server_also.as_ref());
    if let Some(reason) = server_also
        && params
            .iter()
            .any(|(name, value)| name == "q" && !value.trim().is_empty())
    {
        found.push(OnlineOnly {
            param: "q".to_owned(),
            reason: reason.clone(),
        });
    }
    found
}

fn declared_online_only(spec: &ResourceSpec, params: &[(String, String)]) -> Vec<OnlineOnly> {
    let Some(query) = &spec.query else {
        return Vec::new();
    };
    let used = |param: &str| {
        params
            .iter()
            .any(|(name, value)| match param.strip_prefix("sort=") {
                Some(field) => {
                    name == "sort"
                        && value
                            .split(',')
                            .any(|part| part.strip_prefix('-').unwrap_or(part) == field)
                }
                None => name == param && !value.trim().is_empty(),
            })
    };
    query
        .online_only
        .iter()
        .filter(|entry| used(&entry.param))
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use keystone_sync::store::{SortType, Window, offline_manifest};
    use serde_json::json;

    use super::*;
    use crate::router::local_support::name;

    fn params(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(n, v)| ((*n).to_owned(), (*v).to_owned()))
            .collect()
    }

    fn quotes() -> &'static ResourceSpec {
        spec_of(&name("sales-quotes")).unwrap()
    }

    fn parties() -> &'static ResourceSpec {
        spec_of(&name("parties")).unwrap()
    }

    /// A document resource without a query section (manifest version 2).
    fn windowed() -> ResourceSpec {
        let mut spec = ResourceSpec::new(name("x-documents"));
        spec.window = Some(Window {
            field: "document_date".into(),
            days: None,
        });
        spec
    }

    fn mapped(pairs: &[(&str, &str)]) -> MappedList {
        list_query(quotes(), &params(pairs)).unwrap()
    }

    fn refused(spec: &ResourceSpec, pairs: &[(&str, &str)]) -> Vec<String> {
        list_query(spec, &params(pairs)).unwrap_err()
    }

    fn key(field: &str, kind: SortType, descending: bool) -> OrderKey {
        OrderKey {
            field: field.into(),
            kind,
            descending,
        }
    }

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn no_parameters_are_the_first_default_page() {
        let list = mapped(&[]);
        assert_eq!((list.page, list.per_page), (1, 25));
        assert_eq!(list.query.limit, Some(25));
        assert_eq!(list.query.offset, 0);
        assert!(list.query.filters.is_empty());
        assert!(list.query.conditions.is_empty());
        assert!(list.query.sort.is_empty());
        assert_eq!(list.query.search, None);
        assert!(list.applied.is_empty());
    }

    #[test]
    fn pages_become_limit_and_offset() {
        let list = mapped(&[("page", "3"), ("per_page", "100")]);
        assert_eq!((list.page, list.per_page), (3, 100));
        assert_eq!((list.query.limit, list.query.offset), (Some(100), 200));
    }

    #[test]
    fn pages_the_server_refuses_are_not_answered() {
        for (key, value) in [
            ("page", "0"),
            ("page", "x"),
            ("page", "-1"),
            ("page", "18446744073709551615"),
            ("per_page", "0"),
            ("per_page", "101"),
            ("per_page", "x"),
        ] {
            assert_eq!(refused(quotes(), &[(key, value)]), [key], "{value}");
        }
    }

    #[test]
    fn search_is_a_substring_over_the_declared_fields() {
        let text = mapped(&[("q", " acme ")]).query.text.unwrap();
        assert_eq!(text.text, "acme");
        assert_eq!(text.fields, ["number", "party_name", "notes"]);
        // The server reads `q` only: `search` is no filter here either.
        let ignored = mapped(&[("search", "acme")]);
        assert_eq!((ignored.query.text, ignored.query.search), (None, None));
        assert!(ignored.applied.is_empty());
        assert_eq!(mapped(&[("q", "  ")]).query.text, None);
        assert_eq!(mapped(&[("q", "acme")]).query.search, None);
        // Without a query section: the word search of the mirror.
        let list = list_query(&windowed(), &params(&[("q", "acme")])).unwrap();
        assert_eq!(list.query.search.as_deref(), Some("acme"));
        assert_eq!(list.query.text, None);
    }

    #[test]
    fn declared_sorts_are_typed_and_any_number_of_them() {
        assert_eq!(
            mapped(&[("sort", "-total,party_name,created_at")])
                .query
                .order,
            Some(vec![
                key("total", SortType::Decimal, true),
                key("party_name", SortType::Text, false),
                key("created_at", SortType::Datetime, false),
            ])
        );
        assert!(mapped(&[("sort", "-total")]).query.sort.is_empty());
        for sort in ["id", "-lines", "total,notes", "document_date,"] {
            let result = list_query(quotes(), &params(&[("sort", sort)]));
            assert_eq!(
                result.is_ok(),
                sort == "document_date,",
                "{sort}: {result:?}"
            );
        }
    }

    #[test]
    fn without_a_sort_the_default_sort_then_id() {
        let default = Some(vec![
            key("document_date", SortType::Date, true),
            key("created_at", SortType::Datetime, true),
        ]);
        assert_eq!(mapped(&[]).query.order, default);
        let parties = list_query(parties(), &params(&[])).unwrap();
        assert_eq!(parties.query.order, Some(Vec::new()));
        // Up to the first name without a declared sort.
        let mut partly = quotes().clone();
        partly.query.as_mut().unwrap().sort.remove("created_at");
        let list = list_query(&partly, &params(&[])).unwrap();
        assert_eq!(
            list.query.order,
            Some(vec![key("document_date", SortType::Date, true)])
        );
    }

    #[test]
    fn declared_filters_become_typed_conditions() {
        let item = "0192F5A0-0000-7000-8000-0000000000AA";
        let list = mapped(&[
            ("filter[status]", "draft,sent"),
            ("filter[date_from]", "2026-10-01"),
            ("filter[date_to]", "2026-10-31"),
            ("filter[number]", "SQ-1"),
            ("filter[item_id]", item),
        ]);
        assert_eq!(
            list.query.conditions,
            [
                Condition {
                    field: "status".into(),
                    test: Test::Eq {
                        kind: ValueType::String,
                        values: strings(&["draft", "sent"]),
                    },
                },
                Condition {
                    field: "document_date".into(),
                    test: Test::Gte {
                        kind: ValueType::Date,
                        value: "2026-10-01".into(),
                    },
                },
                Condition {
                    field: "document_date".into(),
                    test: Test::Lte {
                        kind: ValueType::Date,
                        value: "2026-10-31".into(),
                    },
                },
                Condition {
                    field: "number".into(),
                    test: Test::Contains {
                        text: "SQ-1".into(),
                    },
                },
                Condition {
                    field: "lines".into(),
                    test: Test::AnyOf {
                        kind: ValueType::Uuid,
                        element: Some("item_id".into()),
                        values: strings(&[item]),
                    },
                },
            ]
        );
        assert!(list.query.filters.is_empty());
        assert_eq!(
            list.applied,
            [
                "filter[status]",
                "filter[date_from]",
                "filter[date_to]",
                "filter[number]",
                "filter[item_id]"
            ]
        );
        let roles = list_query(parties(), &params(&[("filter[role]", "customer")])).unwrap();
        assert_eq!(
            roles.query.conditions,
            [Condition {
                field: "roles".into(),
                test: Test::AnyOf {
                    kind: ValueType::String,
                    element: None,
                    values: strings(&["customer"]),
                },
            }]
        );
        let documents = spec_of(&name("stock-documents")).unwrap();
        let by_type = list_query(documents, &params(&[("filter[type]", "count")])).unwrap();
        assert_eq!(by_type.query.conditions[0].field, "doc_type");
    }

    #[test]
    fn values_are_checked_by_type() {
        for value in ["1", "0", "true", "FALSE"] {
            let list = list_query(parties(), &params(&[("filter[is_active]", value)])).unwrap();
            assert_eq!(list.query.conditions.len(), 1, "{value}");
        }
        for value in ["yes", "2", "1,x"] {
            assert_eq!(
                refused(parties(), &[("filter[is_active]", value)]),
                ["filter[is_active]"],
                "{value}"
            );
        }
        for value in ["#invalid-date", "2026-10", "2026-10-01,2026-10-02"] {
            assert_eq!(
                refused(quotes(), &[("filter[date_from]", value)]),
                ["filter[date_from]"],
                "{value}"
            );
        }
        let mut numbered = parties().clone();
        numbered.query.as_mut().unwrap().filters.insert(
            "level".into(),
            FilterField {
                field: Some("levels".into()),
                matching: FilterMatch::AnyOf,
                kind: ValueType::Integer,
                element_field: None,
                max_values: None,
            },
        );
        assert!(list_query(&numbered, &params(&[("filter[level]", "1,2")])).is_ok());
        assert_eq!(
            refused(&numbered, &[("filter[level]", "1,x")]),
            ["filter[level]"]
        );
        let two = "0192f5a0-0000-7000-8000-000000000001,0192f5a0-0000-7000-8000-000000000002";
        assert_eq!(
            refused(quotes(), &[("filter[item_id]", two)]),
            ["filter[item_id]"]
        );
    }

    #[test]
    fn an_empty_filter_is_no_filter() {
        assert!(
            mapped(&[("filter[status]", "")])
                .query
                .conditions
                .is_empty()
        );
        assert!(
            mapped(&[("filter[nothing]", "")])
                .query
                .conditions
                .is_empty()
        );
    }

    #[test]
    fn everything_else_is_named() {
        assert_eq!(
            refused(
                quotes(),
                &[
                    ("filter[status]", "draft"),
                    ("page", "2"),
                    ("open", "1"),
                    ("filter[status][]", "a"),
                    ("filter[document_date]", "2026-10-01"),
                ]
            ),
            ["open", "filter[status][]", "filter[document_date]"]
        );
    }

    #[test]
    fn online_only_names_are_refused_and_give_their_reason() {
        let invoices = spec_of(&name("sales-invoices")).unwrap();
        let request = params(&[("filter[open]", "1"), ("filter[status]", "issued")]);
        assert_eq!(
            list_query(invoices, &request).unwrap_err(),
            ["filter[open]"]
        );
        let reasons = online_only(invoices, &request);
        assert_eq!(reasons.len(), 1);
        assert_eq!(reasons[0].param, "filter[open]");
        assert!(reasons[0].reason.contains("balance_due"));
        assert!(online_only(invoices, &params(&[("filter[open]", "")])).is_empty());
        assert!(online_only(parties(), &params(&[("filter[open]", "1")])).is_empty());
        let mut sorted = invoices.clone();
        sorted.query.as_mut().unwrap().online_only = vec![OnlineOnly {
            param: "sort=balance".into(),
            reason: "r".into(),
        }];
        assert_eq!(
            online_only(&sorted, &params(&[("sort", "number,-balance")])).len(),
            1
        );
        assert!(online_only(&sorted, &params(&[("sort", "balance_due")])).is_empty());
    }

    #[test]
    fn without_a_query_section_only_the_window_field_sorts_and_filters() {
        let spec = windowed();
        let list = |pairs: &[(&str, &str)]| list_query(&spec, &params(pairs));
        assert_eq!(
            list(&[("sort", "-document_date")]).unwrap().query.sort,
            [SortKey::desc("document_date")]
        );
        assert_eq!(list(&[]).unwrap().query.order, None);
        assert_eq!(
            list(&[("filter[document_date]", "2026-10-01,2026-10-02")])
                .unwrap()
                .query
                .filters,
            [Filter::new(
                "document_date",
                FilterOp::In,
                json!(["2026-10-01", "2026-10-02"])
            )]
        );
        assert_eq!(
            list(&[
                ("filter[date_from]", "2026-10-01"),
                ("filter[date_to]", "2026-10-31")
            ])
            .unwrap()
            .query
            .filters,
            [
                Filter::new("document_date", FilterOp::Gte, "2026-10-01"),
                Filter::new("document_date", FilterOp::Lte, "2026-10-31")
            ]
        );
        assert_eq!(list(&[("sort", "total")]).unwrap_err(), ["sort"]);
        assert_eq!(
            list(&[("filter[status]", "x")]).unwrap_err(),
            ["filter[status]"]
        );
        let plain = ResourceSpec::new(name("x-things"));
        assert_eq!(
            list_query(&plain, &params(&[("sort", "name")])).unwrap_err(),
            ["sort"]
        );
    }

    #[test]
    fn a_repeated_name_is_not_guessed() {
        assert_eq!(refused(quotes(), &[("page", "1"), ("page", "2")]), ["page"]);
        assert_eq!(
            refused(
                quotes(),
                &[("filter[status]", "draft"), ("filter[status]", "sent")]
            ),
            ["filter[status]"]
        );
    }

    #[test]
    fn every_child_of_the_manifest_names_its_parent_field() {
        let manifest: Value = serde_json::from_str(OFFLINE_MANIFEST).unwrap();
        for resource in manifest["resources"].as_array().unwrap() {
            for child in resource["children"].as_array().into_iter().flatten() {
                let child = child["resource"].as_str().unwrap();
                assert!(parent_field(child).is_some(), "{child}");
            }
        }
    }

    #[test]
    fn every_pull_resource_of_the_manifest_has_a_spec_and_search() {
        for spec in offline_manifest(OFFLINE_MANIFEST).unwrap().specs {
            let found = spec_of(&spec.resource).unwrap();
            assert_eq!(found.window, spec.window);
            assert_eq!(found.query, spec.query);
            if spec.source == keystone_sync::wire::Source::Pull {
                assert!(!found.search.is_empty(), "{}", spec.resource);
            }
        }
    }

    /// The compiled manifest is the version whose query sections this build
    /// reads, and the F5 lists carry one.
    #[test]
    fn the_compiled_manifest_declares_the_list_queries() {
        let manifest = offline_manifest(OFFLINE_MANIFEST).unwrap();
        assert_eq!(
            manifest.manifest_version,
            keystone_sync::store::QUERY_MANIFEST_VERSION
        );
        for resource in [
            "parties",
            "items",
            "units",
            "payment-terms",
            "warehouses",
            "tax-codes",
            "sales-quotes",
            "sales-invoices",
            "warehouses.locations",
        ] {
            assert!(
                spec_of(&name(resource)).unwrap().query.is_some(),
                "{resource}"
            );
        }
        assert!(spec_of(&name("items.barcodes")).unwrap().query.is_none());
    }
    #[test]
    fn filter_values_are_trimmed_as_the_server_trims_them() {
        let parties = parties();
        let list = list_query(parties, &params(&[("filter[country]", " TR ")])).unwrap();
        assert_eq!(
            list.query.conditions,
            [Condition {
                field: "country".into(),
                test: Test::Eq {
                    kind: ValueType::String,
                    values: strings(&["TR"]),
                },
            }]
        );
        let bool_value = list_query(parties, &params(&[("filter[is_active]", " 1 ")])).unwrap();
        assert_eq!(bool_value.query.conditions.len(), 1);
        // Blank is empty: no filter and not applied.
        let blank = list_query(parties, &params(&[("filter[country]", "   ")])).unwrap();
        assert!(blank.query.conditions.is_empty());
        assert!(blank.applied.is_empty());
        let number = mapped(&[("filter[number]", " SQ ")]);
        assert_eq!(
            number.query.conditions[0].test,
            Test::Contains { text: "SQ".into() }
        );
        // Without a query section the window filter is trimmed too.
        let spec = windowed();
        let window = list_query(&spec, &params(&[("filter[date_from]", " 2026-10-01")])).unwrap();
        assert_eq!(
            window.query.filters,
            [Filter::new("document_date", FilterOp::Gte, "2026-10-01")]
        );
    }

    #[test]
    fn a_uuid_filter_takes_uuids_only_and_names_the_reason() {
        let items = spec_of(&name("items")).unwrap();
        let good = "0192F5A0-0000-7000-8000-0000000000AA,0192f5a0-0000-7000-8000-0000000000bb";
        assert!(list_query(items, &params(&[("filter[id]", good)])).is_ok());
        for value in [
            "abc",
            "0192f5a0-0000-7000-8000-0000000000aa,",
            "0192f5a0000070008000000000000000aaaa",
            "0192f5a0-0000-7000-8000-0000000000ag",
        ] {
            let request = params(&[("filter[id]", value)]);
            assert_eq!(
                list_query(items, &request).unwrap_err(),
                ["filter[id]"],
                "{value}"
            );
            assert_eq!(
                invalid_values(items, &request),
                [InvalidValue {
                    param: "filter[id]".into(),
                    reason: "not a uuid".into(),
                }],
                "{value}"
            );
        }
        let many: Vec<String> = (0..101)
            .map(|n| format!("0192f5a0-0000-7000-8000-{n:012x}"))
            .collect();
        let request = params(&[("filter[id]", &many.join(","))]);
        assert_eq!(
            invalid_values(items, &request)[0].reason,
            "more than 100 values"
        );
        let hundred = params(&[("filter[id]", &many[..100].join(","))]);
        assert!(list_query(items, &hundred).is_ok());
        assert!(invalid_values(items, &hundred).is_empty());
        let reasons = invalid_values(
            quotes(),
            &params(&[
                ("filter[date_from]", "#invalid-date"),
                ("filter[status]", "draft"),
                ("filter[colour]", "red"),
                ("filter[party_id]", "not-a-uuid"),
            ]),
        );
        assert_eq!(
            reasons,
            [
                InvalidValue {
                    param: "filter[date_from]".into(),
                    reason: "not a date (YYYY-MM-DD)".into(),
                },
                InvalidValue {
                    param: "filter[party_id]".into(),
                    reason: "not a uuid".into(),
                },
            ]
        );
    }

    /// No `sort` is the default order. A blank `sort=` is refused: the
    /// server answers it 422 (measured over HTTP on every mirrored list:
    /// Laravel's `ConvertEmptyStringsToNull` makes it null and the
    /// `ListQuery` rule takes a string only).
    #[test]
    fn a_missing_sort_is_the_default_sort_and_a_blank_one_is_refused() {
        let list = mapped(&[]);
        assert_eq!(
            list.query.order,
            Some(vec![
                key("document_date", SortType::Date, true),
                key("created_at", SortType::Datetime, true),
            ])
        );
        assert!(list.applied.is_empty());
        for value in ["", " "] {
            let request = params(&[("sort", value), ("page", "1")]);
            assert_eq!(
                list_query(quotes(), &request).unwrap_err(),
                ["sort"],
                "{value:?}"
            );
            assert_eq!(
                invalid_values(quotes(), &request),
                [InvalidValue {
                    param: "sort".into(),
                    reason: "empty".into(),
                }]
            );
            // On every list, with or without a query section.
            assert_eq!(list_query(&windowed(), &request).unwrap_err(), ["sort"]);
            assert_eq!(invalid_values(&windowed(), &request).len(), 1);
        }
    }

    #[test]
    fn default_sort_stops_at_its_first_undeclared_name() {
        let mut spec = quotes().clone();
        spec.query.as_mut().unwrap().default_sort =
            vec!["-document_date".into(), "-ghost".into(), "number".into()];
        let list = list_query(&spec, &params(&[])).unwrap();
        assert_eq!(
            list.query.order,
            Some(vec![key("document_date", SortType::Date, true)])
        );
    }

    #[test]
    fn a_sort_of_an_unknown_type_is_refused() {
        let mut spec = quotes().clone();
        spec.query.as_mut().unwrap().sort.insert(
            "weird".into(),
            keystone_sync::store::SortField {
                field: None,
                kind: SortType::Unknown,
            },
        );
        for sort in ["weird", "number,-weird"] {
            assert_eq!(
                list_query(&spec, &params(&[("sort", sort)])).unwrap_err(),
                ["sort"],
                "{sort}"
            );
        }
    }

    #[test]
    fn applied_names_are_exactly_what_was_applied() {
        let list = mapped(&[
            ("q", "acme"),
            ("filter[status]", ""),
            ("search", "x"),
            ("filter[number]", "SQ"),
        ]);
        assert_eq!(list.applied, ["q", "filter[number]"]);
    }

    #[test]
    fn any_of_on_bool_values_is_refused() {
        let mut spec = quotes().clone();
        spec.query.as_mut().unwrap().filters.insert(
            "flags".into(),
            FilterField {
                field: None,
                matching: FilterMatch::AnyOf,
                kind: ValueType::Bool,
                element_field: None,
                max_values: None,
            },
        );
        assert_eq!(
            list_query(&spec, &params(&[("filter[flags]", "1")])).unwrap_err(),
            ["filter[flags]"]
        );
    }

    #[test]
    fn a_date_value_must_be_a_calendar_date() {
        for value in ["2026-1x-01", "2026-13-01", "2026/10/01", "abcdefghij"] {
            assert_eq!(
                refused(quotes(), &[("filter[date_from]", value)]),
                ["filter[date_from]"],
                "{value}"
            );
        }
    }
}
