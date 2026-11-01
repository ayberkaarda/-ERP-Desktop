//! List query parameters of the REST API (`backend/app/Core/Http/ListQuery.php`)
//! on the local copy: what can be answered here and what cannot.
//!
//! The offline manifest does not say which fields a list filters or sorts
//! on, so only what means the same on any resource is mapped:
//!
//! - `page` and `per_page` (1..=[`MAX_PER_PAGE`], default [`DEFAULT_PER_PAGE`]);
//! - `q`, the server's search parameter, and `search`;
//! - `sort` on the resource's `window_field`;
//! - `filter[<window_field>]` (`a` or `a,b`), and `filter[date_from]` and
//!   `filter[date_to]` on the window field, both inclusive.
//!
//! Anything else is named back to the caller: guessing would show a list that
//! looks filtered and is not. An empty filter value is no filter, as on the
//! server.

use std::collections::HashSet;
use std::sync::OnceLock;

use keystone_sync::store::{
    Filter, FilterOp, ListQuery, ResourceSpec, SortKey, specs_from_offline_manifest,
};
use keystone_sync::wire::ResourceName;
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
    let mut mapped = MappedList {
        query: ListQuery::default(),
        page: 1,
        per_page: DEFAULT_PER_PAGE,
    };
    let mut unsupported: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    for (name, value) in params {
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
                "q" | "search" => {
                    let text = value.trim();
                    if !text.is_empty() {
                        mapped.query.search = Some(text.to_owned());
                    }
                    true
                }
                "sort" => match sort_key(value, window) {
                    Some(key) => {
                        mapped.query.sort.extend(key);
                        true
                    }
                    None => false,
                },
                _ => match filter_name(name) {
                    Some(_) if value.is_empty() => true,
                    Some(filter) => match window_filter(filter, value, window) {
                        Some(condition) => {
                            mapped.query.filters.push(condition);
                            true
                        }
                        None => false,
                    },
                    None => false,
                },
            };
        if !known && !unsupported.contains(name) {
            unsupported.push(name.clone());
        }
    }
    if !unsupported.is_empty() {
        return Err(unsupported);
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

#[cfg(test)]
mod tests {
    use keystone_sync::store::offline_manifest;
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

    fn mapped(pairs: &[(&str, &str)]) -> MappedList {
        list_query(quotes(), &params(pairs)).unwrap()
    }

    fn refused(spec: &ResourceSpec, pairs: &[(&str, &str)]) -> Vec<String> {
        list_query(spec, &params(pairs)).unwrap_err()
    }

    #[test]
    fn no_parameters_are_the_first_default_page() {
        let list = mapped(&[]);
        assert_eq!((list.page, list.per_page), (1, 25));
        assert_eq!(list.query.limit, Some(25));
        assert_eq!(list.query.offset, 0);
        assert!(list.query.filters.is_empty());
        assert!(list.query.sort.is_empty());
        assert_eq!(list.query.search, None);
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
    fn search_takes_both_names_and_ignores_blank_text() {
        assert_eq!(
            mapped(&[("q", " acme ")]).query.search.as_deref(),
            Some("acme")
        );
        assert_eq!(
            mapped(&[("search", "acme")]).query.search.as_deref(),
            Some("acme")
        );
        assert_eq!(mapped(&[("q", "  ")]).query.search, None);
    }

    #[test]
    fn sort_is_the_window_field_alone() {
        assert_eq!(
            mapped(&[("sort", "document_date")]).query.sort,
            [SortKey::asc("document_date")]
        );
        assert_eq!(
            mapped(&[("sort", "-document_date")]).query.sort,
            [SortKey::desc("document_date")]
        );
        assert!(mapped(&[("sort", "")]).query.sort.is_empty());
        for sort in ["total", "-total", "document_date,total", "id"] {
            assert_eq!(refused(quotes(), &[("sort", sort)]), ["sort"], "{sort}");
        }
    }

    #[test]
    fn the_window_field_is_the_only_filter() {
        assert_eq!(
            mapped(&[("filter[document_date]", "2026-10-01")])
                .query
                .filters,
            [Filter::eq("document_date", "2026-10-01")]
        );
        assert_eq!(
            mapped(&[("filter[document_date]", "2026-10-01,2026-10-02")])
                .query
                .filters,
            [Filter::new(
                "document_date",
                FilterOp::In,
                json!(["2026-10-01", "2026-10-02"])
            )]
        );
        assert_eq!(
            mapped(&[
                ("filter[date_from]", "2026-10-01"),
                ("filter[date_to]", "2026-10-31")
            ])
            .query
            .filters,
            [
                Filter::new("document_date", FilterOp::Gte, "2026-10-01"),
                Filter::new("document_date", FilterOp::Lte, "2026-10-31")
            ]
        );
    }

    #[test]
    fn an_empty_filter_is_no_filter() {
        assert!(mapped(&[("filter[status]", "")]).query.filters.is_empty());
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
                ]
            ),
            ["filter[status]", "open", "filter[status][]"]
        );
    }

    #[test]
    fn a_resource_without_a_window_has_no_filter_or_sort() {
        assert_eq!(
            refused(parties(), &[("filter[date_from]", "2026-10-01")]),
            ["filter[date_from]"]
        );
        assert_eq!(refused(parties(), &[("sort", "name")]), ["sort"]);
    }

    #[test]
    fn a_repeated_name_is_not_guessed() {
        assert_eq!(refused(quotes(), &[("page", "1"), ("page", "2")]), ["page"]);
        assert_eq!(
            refused(
                quotes(),
                &[
                    ("filter[document_date]", "2026-10-01"),
                    ("filter[document_date]", "2026-10-02"),
                ]
            ),
            ["filter[document_date]"]
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
            if spec.source == keystone_sync::wire::Source::Pull {
                assert!(!found.search.is_empty(), "{}", spec.resource);
            }
        }
    }
}
