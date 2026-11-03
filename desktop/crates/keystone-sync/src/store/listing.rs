//! Typed list conditions and sort keys of the offline manifest `query`
//! sections, written once in Rust and used two ways: by SQLite through the
//! functions [`install`] registers on every store connection (`ks_test`,
//! `ks_key`), and by the draft overlay on rows in memory. Both read the same
//! JSON value of a row field, so mirror rows and drafts filter and sort
//! alike.
//!
//! Field paths never enter SQL text: they are checked against the field
//! pattern and bound as quoted JSON paths (`data -> ?`).

use std::cmp::Ordering;

use rusqlite::Connection;
use rusqlite::functions::{Context, FunctionFlags};
use rusqlite::types::ValueRef;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::collate::{collation_key, datetime_key, decimal_key, plain};
use super::spec::{SortType, ValueType};
use crate::error::Result;
use crate::wire::ResourceRow;

/// One typed sort key; ties go on to the next key and finally to `id`
/// ascending. Missing and `null` values sort last ascending and first
/// descending (PostgreSQL).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OrderKey {
    pub field: String,
    pub kind: SortType,
    pub descending: bool,
}

/// One typed filter on a row field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Condition {
    pub field: String,
    pub test: Test,
}

/// What a row value must satisfy. Values are the request's text values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Test {
    /// The value equals one of `values`.
    Eq {
        kind: ValueType,
        values: Vec<String>,
    },
    /// The value is an array with an element (or the `element` field of an
    /// element) equal to one of `values`.
    AnyOf {
        kind: ValueType,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        element: Option<String>,
        values: Vec<String>,
    },
    /// Inclusive bound; `null` never matches.
    Gte {
        kind: ValueType,
        value: String,
    },
    Lte {
        kind: ValueType,
        value: String,
    },
    /// Case- and accent-insensitive substring.
    Contains {
        text: String,
    },
}

/// `q`: [`Test::Contains`] on any of `fields`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextSearch {
    pub fields: Vec<String>,
    pub text: String,
}

/// `1`/`true` and `0`/`false`, any case.
pub fn bool_value(text: &str) -> Option<bool> {
    match text.to_ascii_lowercase().as_str() {
        "1" | "true" => Some(true),
        "0" | "false" => Some(false),
        _ => None,
    }
}

fn same(kind: ValueType, actual: &Value, wanted: &str) -> bool {
    match kind {
        ValueType::String | ValueType::Date => actual.as_str() == Some(wanted),
        ValueType::Uuid => actual
            .as_str()
            .is_some_and(|a| a.eq_ignore_ascii_case(wanted)),
        ValueType::Bool => actual.as_bool().is_some() && actual.as_bool() == bool_value(wanted),
        ValueType::Integer => {
            actual.as_i64().is_some() && actual.as_i64() == wanted.parse::<i64>().ok()
        }
        ValueType::Unknown => false,
    }
}

fn bound(kind: ValueType, actual: &Value, wanted: &str) -> Option<Ordering> {
    match kind {
        ValueType::String | ValueType::Date => Some(actual.as_str()?.cmp(wanted)),
        ValueType::Integer => Some(actual.as_i64()?.cmp(&wanted.parse::<i64>().ok()?)),
        _ => None,
    }
}

fn text_of(value: &Value) -> Option<String> {
    match value {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

impl Test {
    /// Whether the row value `value` (`None`: missing) passes.
    pub fn matches(&self, value: Option<&Value>) -> bool {
        let Some(value) = value.filter(|v| !v.is_null()) else {
            return false;
        };
        match self {
            Self::Eq { kind, values } => values.iter().any(|w| same(*kind, value, w)),
            Self::AnyOf {
                kind,
                element,
                values,
            } => value.as_array().is_some_and(|items| {
                items.iter().any(|item| {
                    let item = match element {
                        Some(field) => item.get(field),
                        None => Some(item),
                    };
                    item.is_some_and(|item| values.iter().any(|w| same(*kind, item, w)))
                })
            }),
            Self::Gte { kind, value: w } => bound(*kind, value, w).is_some_and(Ordering::is_ge),
            Self::Lte { kind, value: w } => bound(*kind, value, w).is_some_and(Ordering::is_le),
            Self::Contains { text } => {
                text_of(value).is_some_and(|actual| plain(&actual).contains(&plain(text)))
            }
        }
    }
}

/// Sort key of a row value; `None` sorts as missing.
pub fn sort_key(kind: SortType, value: Option<&Value>) -> Option<Vec<u8>> {
    let value = value?;
    match kind {
        SortType::Text => text_of(value).map(|t| collation_key(&t)),
        SortType::Date => value.as_str().map(|s| s.as_bytes().to_vec()),
        SortType::Datetime => value.as_str().and_then(datetime_key),
        SortType::Decimal | SortType::Integer => text_of(value).and_then(|t| decimal_key(&t)),
        SortType::Bool => value.as_bool().map(|b| vec![u8::from(b)]),
        SortType::Unknown => None,
    }
}

/// Order of two keys: missing last ascending, first descending.
pub fn compare_keys(a: Option<&[u8]>, b: Option<&[u8]>, descending: bool) -> Ordering {
    let order = match (a, b) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(a), Some(b)) => a.cmp(b),
    };
    if descending { order.reverse() } else { order }
}

/// Value of a field path of a row; `id` and `version` from the row itself.
pub fn row_value(row: &ResourceRow, path: &str) -> Option<Value> {
    match path {
        "id" => return Some(Value::String(row.id.to_string())),
        "version" => return row.version.map(Value::from),
        _ => {}
    }
    let mut segments = path.split('.');
    let mut node = row.fields.get(segments.next()?)?;
    for segment in segments {
        node = node.get(segment)?;
    }
    Some(node.clone())
}

/// Row order of typed `keys`, then `id` ascending.
pub fn compare_rows(a: &ResourceRow, b: &ResourceRow, keys: &[OrderKey]) -> Ordering {
    for key in keys {
        let ka = sort_key(key.kind, row_value(a, &key.field).as_ref());
        let kb = sort_key(key.kind, row_value(b, &key.field).as_ref());
        let order = compare_keys(ka.as_deref(), kb.as_deref(), key.descending);
        if order != Ordering::Equal {
            return order;
        }
    }
    a.id.cmp(&b.id)
}

/// Whether a row passes every condition and the text search.
pub fn row_matches(row: &ResourceRow, conditions: &[Condition], text: Option<&TextSearch>) -> bool {
    conditions
        .iter()
        .all(|c| c.test.matches(row_value(row, &c.field).as_ref()))
        && text.is_none_or(|search| {
            let test = Test::Contains {
                text: search.text.clone(),
            };
            search
                .fields
                .iter()
                .any(|field| test.matches(row_value(row, field).as_ref()))
        })
}

/// Name of a sort type as `ks_key` takes it.
pub(crate) fn kind_name(kind: SortType) -> &'static str {
    match kind {
        SortType::Text => "text",
        SortType::Date => "date",
        SortType::Datetime => "datetime",
        SortType::Decimal => "decimal",
        SortType::Integer => "integer",
        SortType::Bool => "bool",
        SortType::Unknown => "unknown",
    }
}

fn kind_of(name: &str) -> SortType {
    match name {
        "text" => SortType::Text,
        "date" => SortType::Date,
        "datetime" => SortType::Datetime,
        "decimal" => SortType::Decimal,
        "integer" => SortType::Integer,
        "bool" => SortType::Bool,
        _ => SortType::Unknown,
    }
}

/// The JSON text `data -> path` gives (`NULL`: missing) as a value.
fn fragment(ctx: &Context<'_>, idx: usize) -> rusqlite::Result<Option<Value>> {
    match ctx.get_raw(idx) {
        ValueRef::Null => Ok(None),
        ValueRef::Text(bytes) => serde_json::from_slice(bytes)
            .map(Some)
            .map_err(|e| rusqlite::Error::UserFunctionError(Box::new(e))),
        _ => Err(rusqlite::Error::UserFunctionError(
            "ks_* takes a JSON fragment".into(),
        )),
    }
}

/// Registers `ks_test(test_json, fragment)` and `ks_key(kind, fragment)`.
pub(crate) fn install(conn: &Connection) -> Result<()> {
    let flags = FunctionFlags::SQLITE_UTF8
        | FunctionFlags::SQLITE_DETERMINISTIC
        | FunctionFlags::SQLITE_INNOCUOUS;
    conn.create_scalar_function("ks_test", 2, flags, |ctx| {
        let test = ctx.get_or_create_aux(0, |raw| -> std::result::Result<Test, String> {
            let text = raw.as_str().map_err(|e| e.to_string())?;
            serde_json::from_str(text).map_err(|e| e.to_string())
        })?;
        Ok(test.matches(fragment(ctx, 1)?.as_ref()))
    })?;
    conn.create_scalar_function("ks_key", 2, flags, |ctx| {
        let kind = kind_of(ctx.get_raw(0).as_str().unwrap_or(""));
        Ok(sort_key(kind, fragment(ctx, 1)?.as_ref()))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use uuid::Uuid;

    use super::*;

    fn eq(kind: ValueType, values: &[&str]) -> Test {
        Test::Eq {
            kind,
            values: values.iter().map(|v| (*v).to_owned()).collect(),
        }
    }

    #[test]
    fn equality_is_typed() {
        let string = eq(ValueType::String, &["TR", "DE"]);
        assert!(string.matches(Some(&json!("DE"))));
        assert!(!string.matches(Some(&json!("de"))));
        assert!(!string.matches(None));
        assert!(!string.matches(Some(&Value::Null)));

        let uuid = eq(ValueType::Uuid, &["0192F5A0-0000-7000-8000-000000000001"]);
        assert!(uuid.matches(Some(&json!("0192f5a0-0000-7000-8000-000000000001"))));

        for (token, row) in [("1", true), ("TRUE", true), ("0", false), ("false", false)] {
            let test = eq(ValueType::Bool, &[token]);
            assert!(test.matches(Some(&json!(row))), "{token}");
            assert!(!test.matches(Some(&json!(!row))), "{token}");
            assert!(!test.matches(Some(&json!(u8::from(row)))), "{token}");
        }
        assert!(!eq(ValueType::Bool, &["yes"]).matches(Some(&json!(true))));

        let int = eq(ValueType::Integer, &["5"]);
        assert!(int.matches(Some(&json!(5))));
        assert!(!int.matches(Some(&json!("5"))));
        assert!(!eq(ValueType::Unknown, &["5"]).matches(Some(&json!("5"))));
    }

    #[test]
    fn any_of_reads_arrays_and_element_fields() {
        let roles = Test::AnyOf {
            kind: ValueType::String,
            element: None,
            values: vec!["customer".into()],
        };
        assert!(roles.matches(Some(&json!(["supplier", "customer"]))));
        assert!(!roles.matches(Some(&json!(["supplier"]))));
        assert!(!roles.matches(Some(&json!("customer"))));
        let lines = Test::AnyOf {
            kind: ValueType::Uuid,
            element: Some("item_id".into()),
            values: vec!["AA".into()],
        };
        assert!(lines.matches(Some(&json!([{"item_id": "bb"}, {"item_id": "aa"}]))));
        assert!(!lines.matches(Some(&json!([{"id": "aa"}]))));
    }

    #[test]
    fn bounds_are_inclusive_and_typed() {
        let from = Test::Gte {
            kind: ValueType::Date,
            value: "2026-10-10".into(),
        };
        let to = Test::Lte {
            kind: ValueType::Integer,
            value: "10".into(),
        };
        assert!(from.matches(Some(&json!("2026-10-10"))));
        assert!(!from.matches(Some(&json!("2026-10-09"))));
        assert!(!from.matches(None));
        assert!(to.matches(Some(&json!(9))));
        assert!(to.matches(Some(&json!(10))));
        assert!(!to.matches(Some(&json!(11))));
        assert!(!to.matches(Some(&json!("9"))));
    }

    #[test]
    fn contains_folds_case_accents_and_turkish_i() {
        let test = Test::Contains {
            text: "ISTANB".into(),
        };
        assert!(test.matches(Some(&json!("Yeni İstanbul Şube"))));
        let number = Test::Contains {
            text: "q2026-0002".into(),
        };
        assert!(number.matches(Some(&json!("SQ2026-0002"))));
        assert!(!number.matches(Some(&json!("SQ2026-0001"))));
        assert!(Test::Contains { text: "120".into() }.matches(Some(&json!(1200))));
    }

    #[test]
    fn rows_sort_with_nulls_last_ascending_then_by_id() {
        let row = |n: u128, total: Value| ResourceRow {
            id: Uuid::from_u128(n),
            version: Some(1),
            fields: json!({ "total": total }).as_object().cloned().unwrap(),
        };
        let mut rows = [
            row(1, Value::Null),
            row(2, json!("96.00")),
            row(3, json!("288.00")),
            row(4, json!("96.0")),
        ];
        let asc = [OrderKey {
            field: "total".into(),
            kind: SortType::Decimal,
            descending: false,
        }];
        rows.sort_by(|a, b| compare_rows(a, b, &asc));
        let ids: Vec<u128> = rows.iter().map(|r| r.id.as_u128()).collect();
        assert_eq!(ids, [2, 4, 3, 1]);
        let desc = [OrderKey {
            descending: true,
            ..asc[0].clone()
        }];
        rows.sort_by(|a, b| compare_rows(a, b, &desc));
        let ids: Vec<u128> = rows.iter().map(|r| r.id.as_u128()).collect();
        assert_eq!(ids, [1, 3, 2, 4]);
    }

    #[test]
    fn tests_round_trip_through_json() {
        let test = Test::AnyOf {
            kind: ValueType::Uuid,
            element: Some("item_id".into()),
            values: vec!["a".into()],
        };
        let text = serde_json::to_string(&test).unwrap();
        assert_eq!(serde_json::from_str::<Test>(&text).unwrap(), test);
    }
}
