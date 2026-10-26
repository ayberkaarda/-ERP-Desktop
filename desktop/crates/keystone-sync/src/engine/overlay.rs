//! Draft layer: outbox writes laid over mirror rows for local reads.
//!
//! Every outbox entry of a row counts, whatever its state (pending, in
//! flight, conflict, rejected, quarantined), until it is settled or
//! discarded: the user keeps seeing their own work. In outbox order a
//! `create` sets the row to its payload, an `update` merges its payload's
//! top-level keys into the row so far, a `delete` hides the row; actions do
//! not change the row. An update starts from the mirror row, else from the
//! base saved at enqueue time ([`super::SyncEngine::enqueue`]), so retention
//! or a reset that removes the mirror row does not hide the draft.
//!
//! Filters, sort and search are evaluated for drafts in Rust with the
//! store's SQLite semantics (NULL < numbers < text, `IS` equality, NULL
//! comparisons false). Search uses the store's Turkish folding plus a small
//! Latin diacritic map, as word prefixes (an approximation of FTS5
//! `unicode61 remove_diacritics 2`).

use std::cmp::Ordering;
use std::collections::HashMap;

use rusqlite::Connection;
use serde_json::{Map, Value};
use uuid::Uuid;

use super::local;
use crate::error::Result;
use crate::store::{
    Filter, FilterOp, LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX, ListQuery, ResourceSpec, SortKey, Store,
    fold,
};
use crate::wire::{MutationOp, ResourceName, ResourceRow};

/// A local list page. `drafts` holds the ids of rows on this page that come
/// from (or are changed by) a local draft.
#[derive(Debug, Clone, PartialEq)]
pub struct LocalPage {
    pub rows: Vec<ResourceRow>,
    pub total: u64,
    pub drafts: Vec<Uuid>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LocalRow {
    pub row: ResourceRow,
    /// The row carries unsent local changes.
    pub draft: bool,
}

/// Overlay state of one row.
#[derive(Debug, Clone, PartialEq)]
enum Draft {
    Row(ResourceRow),
    Hidden,
}

pub(super) fn list(store: &Store, resource: &ResourceName, query: &ListQuery) -> Result<LocalPage> {
    // Specs change only on register; read outside the snapshot below.
    let spec = store.resource_spec(resource)?;
    store.read(|conn| snapshot(conn, |conn| list_in(conn, spec.as_ref(), resource, query)))
}

pub(super) fn get(store: &Store, resource: &ResourceName, id: Uuid) -> Result<Option<LocalRow>> {
    store.read(|conn| {
        snapshot(conn, |conn| {
            let drafts = drafts_in(conn, resource, Some(id))?;
            match drafts.into_iter().next() {
                Some((_, Draft::Row(row))) => Ok(Some(LocalRow { row, draft: true })),
                Some((_, Draft::Hidden)) => Ok(None),
                None => Ok(Store::get_row_on(conn, resource, id)?
                    .map(|row| LocalRow { row, draft: false })),
            }
        })
    })
}

fn snapshot<T>(conn: &Connection, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
    conn.execute_batch("SAVEPOINT engine_overlay;")?;
    let value = f(conn);
    conn.execute_batch("RELEASE engine_overlay;")?;
    value
}

/// Draft state per row id of `resource` (only `only`, when given), in
/// order of first outbox entry.
fn drafts_in(
    conn: &Connection,
    resource: &ResourceName,
    only: Option<Uuid>,
) -> Result<Vec<(Uuid, Draft)>> {
    let entries = crate::outbox::load(conn)?;
    let mut order: Vec<Uuid> = Vec::new();
    let mut state: HashMap<Uuid, Option<Draft>> = HashMap::new();
    for entry in entries {
        let m = &entry.mutation;
        if m.resource != *resource || only.is_some_and(|id| id != m.id) {
            continue;
        }
        if m.op == MutationOp::Action {
            continue;
        }
        let slot = match state.entry(m.id) {
            std::collections::hash_map::Entry::Occupied(slot) => slot.into_mut(),
            std::collections::hash_map::Entry::Vacant(slot) => {
                let base = match Store::get_row_on(conn, resource, m.id)? {
                    Some(row) => Some(row),
                    None => local::base_on(conn, resource, m.id)?,
                };
                order.push(m.id);
                slot.insert(base.map(Draft::Row))
            }
        };
        match m.op {
            MutationOp::Create => {
                *slot = Some(Draft::Row(row_from(m.id, None, &m.payload)));
            }
            MutationOp::Update => {
                let mut row = match slot.take() {
                    Some(Draft::Row(row)) => row,
                    _ => row_from(m.id, None, &Map::new()),
                };
                merge(&mut row, &m.payload);
                *slot = Some(Draft::Row(row));
            }
            MutationOp::Delete => *slot = Some(Draft::Hidden),
            MutationOp::Action => {}
        }
    }
    Ok(order
        .into_iter()
        .filter_map(|id| state.remove(&id).flatten().map(|d| (id, d)))
        .collect())
}

fn row_from(id: Uuid, version: Option<u64>, payload: &Map<String, Value>) -> ResourceRow {
    let mut row = ResourceRow {
        id,
        version,
        fields: Map::new(),
    };
    merge(&mut row, payload);
    row
}

fn merge(row: &mut ResourceRow, payload: &Map<String, Value>) {
    for (key, value) in payload {
        if key != "id" && key != "version" {
            row.fields.insert(key.clone(), value.clone());
        }
    }
}

fn list_in(
    conn: &Connection,
    spec: Option<&ResourceSpec>,
    resource: &ResourceName,
    query: &ListQuery,
) -> Result<LocalPage> {
    let drafts = drafts_in(conn, resource, None)?;
    if drafts.is_empty() {
        let page = Store::list_on(conn, resource, query)?;
        return Ok(LocalPage {
            rows: page.rows,
            total: page.total,
            drafts: Vec::new(),
        });
    }

    let mut mirror_query = query.clone();
    for (id, _) in &drafts {
        mirror_query
            .filters
            .push(Filter::new("id", FilterOp::Ne, id.to_string()));
    }
    let keys: Vec<SortKey> = if query.sort.is_empty() {
        spec.and_then(|s| s.window.as_ref())
            .map(|w| vec![SortKey::desc(w.field.clone())])
            .unwrap_or_default()
    } else {
        query.sort.clone()
    };
    let search_fields: &[String] = spec.map_or(&[], |s| s.search.as_slice());
    let mut rows: Vec<ResourceRow> = drafts
        .into_iter()
        .filter_map(|(_, d)| match d {
            Draft::Row(row) => Some(row),
            Draft::Hidden => None,
        })
        .filter(|row| query.filters.iter().all(|f| matches_filter(row, f)))
        .filter(|row| {
            query
                .search
                .as_deref()
                .is_none_or(|text| matches_search(row, search_fields, text))
        })
        .collect();
    rows.sort_by(|a, b| compare_rows(a, b, &keys));

    let limit = usize::try_from(
        query
            .limit
            .unwrap_or(LIST_LIMIT_DEFAULT)
            .min(LIST_LIMIT_MAX),
    )
    .unwrap_or(usize::MAX);
    let offset = usize::try_from(query.offset).unwrap_or(usize::MAX);
    let drafted = rows.len();

    let (page_rows, mirror_total) = if keys.is_empty() {
        // No order to merge on: drafts come first.
        let from = offset.min(drafted);
        let to = offset.saturating_add(limit).min(drafted);
        let mut out: Vec<ResourceRow> = rows[from..to].to_vec();
        mirror_query.offset = u64::try_from(offset.saturating_sub(drafted)).unwrap_or(u64::MAX);
        mirror_query.limit = Some(u32::try_from(limit - out.len()).unwrap_or(LIST_LIMIT_MAX));
        let page = Store::list_on(conn, resource, &mirror_query)?;
        out.extend(page.rows);
        (out, page.total)
    } else {
        merge_sorted(
            conn,
            resource,
            &mut mirror_query,
            rows.clone(),
            &keys,
            offset,
            limit,
        )?
    };

    let draft_ids: Vec<Uuid> = page_rows
        .iter()
        .filter(|r| rows.iter().any(|d| d.id == r.id))
        .map(|r| r.id)
        .collect();
    Ok(LocalPage {
        rows: page_rows,
        total: mirror_total + u64::try_from(drafted).unwrap_or(0),
        drafts: draft_ids,
    })
}

/// Walks the mirror in sort order and merges the sorted drafts in (a draft
/// goes before a mirror row it ties with) until the page is filled.
fn merge_sorted(
    conn: &Connection,
    resource: &ResourceName,
    mirror_query: &mut ListQuery,
    drafts: Vec<ResourceRow>,
    keys: &[SortKey],
    offset: usize,
    limit: usize,
) -> Result<(Vec<ResourceRow>, u64)> {
    let need = offset.saturating_add(limit);
    let mut merged: Vec<ResourceRow> = Vec::new();
    let mut drafts = drafts.into_iter().peekable();
    let mut mirror_offset: u64 = 0;
    let mut total: u64;
    mirror_query.sort = keys.to_vec();
    mirror_query.limit = Some(LIST_LIMIT_MAX);
    'outer: loop {
        mirror_query.offset = mirror_offset;
        let page = Store::list_on(conn, resource, mirror_query)?;
        total = page.total;
        let fetched = page.rows.len();
        for row in page.rows {
            while let Some(draft) =
                drafts.next_if(|d| compare_rows(d, &row, keys) != Ordering::Greater)
            {
                merged.push(draft);
            }
            merged.push(row);
            if merged.len() >= need {
                break 'outer;
            }
        }
        if fetched < LIST_LIMIT_MAX as usize {
            merged.extend(drafts);
            break;
        }
        mirror_offset += fetched as u64;
    }
    let from = offset.min(merged.len());
    let to = need.min(merged.len());
    Ok((merged[from..to].to_vec(), total))
}

/// A value as SQLite orders it: NULL < numbers < text.
#[derive(Debug, Clone, PartialEq)]
enum Sql {
    Null,
    Num(f64),
    Text(String),
}

impl Sql {
    fn of(value: Option<&Value>) -> Self {
        match value {
            None | Some(Value::Null) => Self::Null,
            Some(Value::Bool(b)) => Self::Num(if *b { 1.0 } else { 0.0 }),
            Some(Value::Number(n)) => n.as_f64().map_or(Self::Null, Self::Num),
            Some(Value::String(s)) => Self::Text(s.clone()),
            // json_extract returns containers as JSON text.
            Some(other) => Self::Text(other.to_string()),
        }
    }

    fn rank(&self) -> u8 {
        match self {
            Self::Null => 0,
            Self::Num(_) => 1,
            Self::Text(_) => 2,
        }
    }

    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (Self::Num(a), Self::Num(b)) => a.partial_cmp(b).unwrap_or(Ordering::Equal),
            (Self::Text(a), Self::Text(b)) => a.as_bytes().cmp(b.as_bytes()),
            (a, b) => a.rank().cmp(&b.rank()),
        }
    }

    fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }
}

fn field(row: &ResourceRow, path: &str) -> Sql {
    match path {
        "id" => return Sql::Text(row.id.to_string()),
        "version" => {
            return row.version.map_or(Sql::Null, |v| Sql::Num(v as f64));
        }
        _ => {}
    }
    let mut segments = path.split('.');
    let Some(first) = segments.next() else {
        return Sql::Null;
    };
    let mut node = row.fields.get(first);
    for segment in segments {
        node = node.and_then(|n| n.get(segment));
    }
    Sql::of(node)
}

fn matches_filter(row: &ResourceRow, filter: &Filter) -> bool {
    let left = field(row, &filter.field);
    let is = |value: &Value| {
        let right = Sql::of(Some(value));
        if left.is_null() || right.is_null() {
            left.is_null() && right.is_null()
        } else {
            left.rank() == right.rank() && left.cmp(&right) == Ordering::Equal
        }
    };
    let compare = |pred: fn(Ordering) -> bool| {
        let right = Sql::of(Some(&filter.value));
        !left.is_null() && !right.is_null() && pred(left.cmp(&right))
    };
    match filter.op {
        FilterOp::Eq => is(&filter.value),
        FilterOp::Ne => !is(&filter.value),
        FilterOp::Lt => compare(|o| o == Ordering::Less),
        FilterOp::Lte => compare(|o| o != Ordering::Greater),
        FilterOp::Gt => compare(|o| o == Ordering::Greater),
        FilterOp::Gte => compare(|o| o != Ordering::Less),
        FilterOp::In => match &filter.value {
            Value::Array(items) => {
                !left.is_null() && items.iter().any(|item| !item.is_null() && is(item))
            }
            _ => false,
        },
        FilterOp::IsNull => left.is_null(),
        FilterOp::NotNull => !left.is_null(),
    }
}

/// SQLite `ORDER BY` with the given keys (`DESC` reverses, so NULL last).
fn compare_rows(a: &ResourceRow, b: &ResourceRow, keys: &[SortKey]) -> Ordering {
    for key in keys {
        let order = field(a, &key.field).cmp(&field(b, &key.field));
        let order = if key.descending {
            order.reverse()
        } else {
            order
        };
        if order != Ordering::Equal {
            return order;
        }
    }
    Ordering::Equal
}

fn normalize(text: &str) -> String {
    fold(text)
        .chars()
        .filter_map(|c| match c {
            '\u{0300}'..='\u{036F}' => None,
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => Some('a'),
            'ç' => Some('c'),
            'è' | 'é' | 'ê' | 'ë' => Some('e'),
            'ì' | 'í' | 'î' | 'ï' => Some('i'),
            'ğ' => Some('g'),
            'ñ' => Some('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' => Some('o'),
            'ş' => Some('s'),
            'ù' | 'ú' | 'û' | 'ü' => Some('u'),
            other => Some(other),
        })
        .collect()
}

fn words(text: &str) -> Vec<String> {
    normalize(text)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect()
}

fn matches_search(row: &ResourceRow, fields: &[String], text: &str) -> bool {
    let wanted = words(text);
    if wanted.is_empty() {
        return true;
    }
    let mut parts: Vec<String> = Vec::new();
    for path in fields {
        let mut segments = path.split('.');
        let Some(first) = segments.next() else {
            continue;
        };
        let mut node = row.fields.get(first);
        for segment in segments {
            node = node.and_then(|n| n.get(segment));
        }
        let mut push = |v: &Value| match v {
            Value::String(s) => parts.push(s.clone()),
            Value::Number(n) => parts.push(n.to_string()),
            _ => {}
        };
        match node {
            Some(Value::Array(items)) => items.iter().for_each(&mut push),
            Some(v) => push(v),
            None => {}
        }
    }
    let have = words(&parts.join(" "));
    wanted
        .iter()
        .all(|w| have.iter().any(|h| h.starts_with(w.as_str())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(fields: Value) -> ResourceRow {
        ResourceRow {
            id: Uuid::nil(),
            version: Some(2),
            fields: fields.as_object().cloned().unwrap_or_default(),
        }
    }

    #[test]
    fn filters_follow_sqlite_semantics() {
        let r = row(json!({"n": 5, "s": "abc", "b": true, "z": null}));
        assert!(matches_filter(&r, &Filter::eq("n", 5)));
        assert!(matches_filter(&r, &Filter::eq("z", Value::Null)));
        assert!(matches_filter(&r, &Filter::eq("missing", Value::Null)));
        assert!(!matches_filter(&r, &Filter::eq("n", "5")));
        assert!(matches_filter(&r, &Filter::eq("b", 1)));
        assert!(matches_filter(&r, &Filter::new("n", FilterOp::Lt, "a")));
        assert!(!matches_filter(&r, &Filter::new("z", FilterOp::Lt, 1)));
        assert!(matches_filter(
            &r,
            &Filter::new("s", FilterOp::In, json!(["x", "abc"]))
        ));
        assert!(matches_filter(
            &r,
            &Filter::new("version", FilterOp::Gte, 2)
        ));
        assert!(matches_filter(
            &r,
            &Filter::new("z", FilterOp::IsNull, Value::Null)
        ));
    }

    #[test]
    fn sort_puts_null_first_ascending_and_last_descending() {
        let a = row(json!({"d": null}));
        let b = row(json!({"d": "2026-10-01"}));
        assert_eq!(compare_rows(&a, &b, &[SortKey::asc("d")]), Ordering::Less);
        assert_eq!(
            compare_rows(&a, &b, &[SortKey::desc("d")]),
            Ordering::Greater
        );
    }

    #[test]
    fn search_folds_turkish_text_as_prefixes() {
        let r = row(json!({"name": "İSTANBUL Şişli Çağ"}));
        let fields = vec!["name".to_owned()];
        assert!(matches_search(&r, &fields, "istan sis"));
        assert!(matches_search(&r, &fields, "cag"));
        assert!(!matches_search(&r, &fields, "ankara"));
    }
}
