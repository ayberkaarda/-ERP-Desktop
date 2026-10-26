//! Local reads: list with filter, sort, search and paging; read routing by
//! the manifest `read` mode.

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, params_from_iter};
use serde_json::Value;

use super::Store;
use super::fold::match_expression;
use super::mirror::{Registered, decode_row, lookup};
use super::spec::{column_name, invalid, json_path, validate_field};
use crate::error::Result;
use crate::wire::{ReadMode, ResourceName, ResourceRow};

pub const LIST_LIMIT_DEFAULT: u32 = 50;
pub const LIST_LIMIT_MAX: u32 = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FilterOp {
    /// `IS`: also matches `null` against a missing or null field.
    Eq,
    /// `IS NOT`.
    Ne,
    Lt,
    Lte,
    Gt,
    Gte,
    /// `value` is an array of scalars.
    In,
    IsNull,
    NotNull,
}

/// One condition on a field path. Indexed fields use their generated column;
/// any other path falls back to `json_extract` on `data` (correct, unindexed).
#[derive(Debug, Clone, PartialEq)]
pub struct Filter {
    pub field: String,
    pub op: FilterOp,
    pub value: Value,
}

impl Filter {
    pub fn new(field: impl Into<String>, op: FilterOp, value: impl Into<Value>) -> Self {
        Self {
            field: field.into(),
            op,
            value: value.into(),
        }
    }

    pub fn eq(field: impl Into<String>, value: impl Into<Value>) -> Self {
        Self::new(field, FilterOp::Eq, value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SortKey {
    pub field: String,
    pub descending: bool,
}

impl SortKey {
    pub fn asc(field: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            descending: false,
        }
    }

    pub fn desc(field: impl Into<String>) -> Self {
        Self {
            field: field.into(),
            descending: true,
        }
    }
}

/// All filters must hold. Without `sort`, documents come newest window
/// value first, other resources in insertion order. Ties break on insertion
/// order, so paging is stable.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ListQuery {
    pub filters: Vec<Filter>,
    pub sort: Vec<SortKey>,
    /// Free text, matched with Turkish folding as word prefixes.
    pub search: Option<String>,
    /// `None`: [`LIST_LIMIT_DEFAULT`]; capped at [`LIST_LIMIT_MAX`].
    pub limit: Option<u32>,
    pub offset: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ListPage {
    pub rows: Vec<ResourceRow>,
    /// Matching rows before `limit`/`offset`.
    pub total: u64,
}

/// Where a GET for a resource with this `read` mode is answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadRoute {
    /// From the mirror (or the stored snapshot).
    Local,
    /// From the server only.
    Remote,
    /// From the server; from the mirror if the request fails for network.
    RemoteThenLocal,
}

/// `local-first`: always local. `online-first`: server first while online.
/// `offline-fallback` (snapshots): server while online, local copy (shown
/// "as of" its `fetched_at`) only when offline.
pub fn read_route(mode: ReadMode, online: bool) -> ReadRoute {
    match (mode, online) {
        (ReadMode::LocalFirst, _) | (_, false) => ReadRoute::Local,
        (ReadMode::OnlineFirst, true) => ReadRoute::RemoteThenLocal,
        (ReadMode::OfflineFallback, true) => ReadRoute::Remote,
    }
}

impl Store {
    /// Lists local rows of `resource`; empty when it is not registered.
    /// Count and rows come from one read transaction.
    pub fn list(&self, resource: &ResourceName, query: &ListQuery) -> Result<ListPage> {
        self.read(|conn| {
            let Some(reg) = lookup(conn, resource)? else {
                return Ok(ListPage {
                    rows: Vec::new(),
                    total: 0,
                });
            };
            let tx = conn.unchecked_transaction()?;
            let page = list_in(&tx, &reg, query)?;
            tx.commit()?;
            Ok(page)
        })
    }
}

fn list_in(conn: &Connection, reg: &Registered, query: &ListQuery) -> Result<ListPage> {
    let mut clauses: Vec<String> = Vec::new();
    let mut args: Vec<SqlValue> = Vec::new();

    for filter in &query.filters {
        let expr = field_expr(reg, &filter.field)?;
        let clause = match filter.op {
            FilterOp::IsNull => format!("{expr} IS NULL"),
            FilterOp::NotNull => format!("{expr} IS NOT NULL"),
            FilterOp::In => {
                let Value::Array(items) = &filter.value else {
                    return Err(invalid(format!("{}: `in` needs an array", filter.field)));
                };
                if items.is_empty() {
                    "0".to_owned()
                } else {
                    for item in items {
                        args.push(sql_value(item)?);
                    }
                    format!("{expr} IN ({})", vec!["?"; items.len()].join(", "))
                }
            }
            op => {
                args.push(sql_value(&filter.value)?);
                let sym = match op {
                    FilterOp::Eq => "IS",
                    FilterOp::Ne => "IS NOT",
                    FilterOp::Lt => "<",
                    FilterOp::Lte => "<=",
                    FilterOp::Gt => ">",
                    _ => ">=",
                };
                format!("{expr} {sym} ?")
            }
        };
        clauses.push(clause);
    }

    if let Some(text) = &query.search
        && let Some(expr) = match_expression(text)
    {
        let Some(fts) = &reg.fts else {
            return Err(invalid(format!(
                "{} has no search fields",
                reg.spec.resource
            )));
        };
        clauses.push(format!(
            "k IN (SELECT rowid FROM \"{fts}\" WHERE \"{fts}\" MATCH ?)"
        ));
        args.push(SqlValue::Text(expr));
    }

    let mut order: Vec<String> = Vec::new();
    for key in &query.sort {
        let dir = if key.descending { "DESC" } else { "ASC" };
        order.push(format!("{} {dir}", field_expr(reg, &key.field)?));
    }
    if query.sort.is_empty()
        && let Some(window) = &reg.spec.window
    {
        order.push(format!("\"{}\" DESC", column_name(&window.field)));
    }
    order.push("k ASC".to_owned());

    let filter_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    let total: i64 = conn.query_row(
        &format!("SELECT count(*) FROM \"{}\"{filter_sql}", reg.table),
        params_from_iter(args.iter()),
        |r| r.get(0),
    )?;

    let limit = query
        .limit
        .unwrap_or(LIST_LIMIT_DEFAULT)
        .min(LIST_LIMIT_MAX);
    let offset = i64::try_from(query.offset).map_err(|_| invalid("offset out of range"))?;
    let mut page_args = args;
    page_args.push(SqlValue::Integer(i64::from(limit)));
    page_args.push(SqlValue::Integer(offset));
    let mut stmt = conn.prepare(&format!(
        "SELECT data FROM \"{}\"{filter_sql} ORDER BY {} LIMIT ? OFFSET ?",
        reg.table,
        order.join(", ")
    ))?;
    let data = stmt
        .query_map(params_from_iter(page_args.iter()), |r| {
            r.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let rows = data
        .iter()
        .map(|d| decode_row(d))
        .collect::<Result<Vec<_>>>()?;
    Ok(ListPage {
        rows,
        total: u64::try_from(total).unwrap_or(0),
    })
}

/// SQL for a field path: `id`/`version` columns, the generated column of an
/// indexed field, else `json_extract`. Paths are validated before inlining.
fn field_expr(reg: &Registered, field: &str) -> Result<String> {
    match field {
        "id" => return Ok("id".to_owned()),
        "version" => return Ok("version".to_owned()),
        _ => {}
    }
    validate_field(field)?;
    if reg.spec.index_fields().contains(&field) {
        Ok(format!("\"{}\"", column_name(field)))
    } else {
        Ok(format!("json_extract(data, '{}')", json_path(field)))
    }
}

/// JSON scalar as `json_extract` returns it (booleans are 0/1).
fn sql_value(value: &Value) -> Result<SqlValue> {
    Ok(match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().ok_or_else(|| invalid("number out of range"))?),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Array(_) | Value::Object(_) => {
            return Err(invalid("filter value must be a scalar"));
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_by_read_mode() {
        assert_eq!(read_route(ReadMode::LocalFirst, true), ReadRoute::Local);
        assert_eq!(
            read_route(ReadMode::OnlineFirst, true),
            ReadRoute::RemoteThenLocal
        );
        assert_eq!(read_route(ReadMode::OnlineFirst, false), ReadRoute::Local);
        assert_eq!(
            read_route(ReadMode::OfflineFallback, true),
            ReadRoute::Remote
        );
        assert_eq!(
            read_route(ReadMode::OfflineFallback, false),
            ReadRoute::Local
        );
    }
}
