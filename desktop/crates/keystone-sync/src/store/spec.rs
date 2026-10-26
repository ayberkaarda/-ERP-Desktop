//! Per-resource mirror layout: which fields get generated columns, which feed
//! full-text search, and which date field bounds a document window.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Result, SyncError};
use crate::wire::{ReadMode, ResourceName, Source};

/// Fields indexed for search when the offline manifest gives none.
/// Missing fields simply add nothing to the search text.
pub const DEFAULT_SEARCH_FIELDS: &[&str] = &[
    "code",
    "name",
    "title",
    "document_number",
    "party_name",
    "tax_number",
    "description",
];

/// Window of a document resource (`window_days` / `window_field`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Window {
    /// Date or timestamp field; its first 10 characters are compared as
    /// `YYYY-MM-DD`.
    pub field: String,
    /// `None`: [`super::RetentionPolicy::window_days`].
    pub days: Option<u32>,
}

/// How one resource is kept locally. Stored with the resource so a later
/// [`super::Store::register`] can add or drop columns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceSpec {
    pub resource: ResourceName,
    pub read: ReadMode,
    pub source: Source,
    /// Field paths (`a` or `a.b`) that become `GENERATED ALWAYS AS
    /// (json_extract(data, '$.a.b')) VIRTUAL` columns, each with an index.
    pub indexed: Vec<String>,
    /// Field paths whose values feed the FTS5 table. Empty: no search.
    pub search: Vec<String>,
    /// Set for documents: retention only ever removes rows of these.
    pub window: Option<Window>,
}

impl ResourceSpec {
    /// Master data defaults: `local-first`, `pull`, no columns, no search.
    pub fn new(resource: ResourceName) -> Self {
        Self {
            resource,
            read: ReadMode::LocalFirst,
            source: Source::Pull,
            indexed: Vec::new(),
            search: Vec::new(),
            window: None,
        }
    }

    pub fn read(mut self, read: ReadMode) -> Self {
        self.read = read;
        self
    }

    pub fn indexed<I: Into<String>>(mut self, fields: impl IntoIterator<Item = I>) -> Self {
        self.indexed = fields.into_iter().map(Into::into).collect();
        self
    }

    pub fn search<I: Into<String>>(mut self, fields: impl IntoIterator<Item = I>) -> Self {
        self.search = fields.into_iter().map(Into::into).collect();
        self
    }

    /// Marks the resource as a document windowed on `field`; the field is
    /// also indexed.
    pub fn window(mut self, field: impl Into<String>, days: Option<u32>) -> Self {
        self.window = Some(Window {
            field: field.into(),
            days,
        });
        self
    }

    pub fn is_document(&self) -> bool {
        self.window.is_some()
    }

    /// `indexed` plus the window field, without duplicates, in order.
    pub fn index_fields(&self) -> Vec<&str> {
        let mut out: Vec<&str> = Vec::new();
        let window = self.window.as_ref().map(|w| w.field.as_str());
        for field in self.indexed.iter().map(String::as_str).chain(window) {
            if !out.contains(&field) {
                out.push(field);
            }
        }
        out
    }

    pub(crate) fn validate(&self) -> Result<()> {
        validate_resource(&self.resource)?;
        for field in self
            .index_fields()
            .into_iter()
            .chain(self.search.iter().map(String::as_str))
        {
            validate_field(field)?;
        }
        Ok(())
    }
}

/// Reads `contracts/offline-manifest.json` into specs. Children inherit the
/// parent's read mode; `snapshot` resources are kept as snapshots, not rows.
pub fn specs_from_offline_manifest(json: &str) -> Result<Vec<ResourceSpec>> {
    let root: Value = serde_json::from_str(json)?;
    let default_days = root
        .pointer("/defaults/recent_window_days")
        .and_then(Value::as_u64)
        .and_then(|d| u32::try_from(d).ok());
    let Some(resources) = root.get("resources").and_then(Value::as_array) else {
        return Err(invalid("offline manifest has no resources array"));
    };
    let mut specs = Vec::new();
    for entry in resources {
        let resource = name_of(entry)?;
        let read: ReadMode = serde_json::from_value(
            entry
                .get("read")
                .cloned()
                .ok_or_else(|| invalid(format!("{resource}: read missing")))?,
        )?;
        let source: Source = serde_json::from_value(
            entry
                .get("source")
                .cloned()
                .ok_or_else(|| invalid(format!("{resource}: source missing")))?,
        )?;
        let mut spec = ResourceSpec::new(resource).read(read);
        spec.source = source;
        if source == Source::Pull {
            spec.search = DEFAULT_SEARCH_FIELDS
                .iter()
                .map(|s| (*s).to_owned())
                .collect();
        }
        if let Some(field) = entry.get("window_field").and_then(Value::as_str) {
            let days = entry
                .get("window_days")
                .and_then(Value::as_u64)
                .and_then(|d| u32::try_from(d).ok())
                .or(default_days);
            spec = spec.window(field, days);
        }
        spec.validate()?;
        let children = entry.get("children").and_then(Value::as_array);
        specs.push(spec.clone());
        for child in children.into_iter().flatten() {
            let mut child_spec = ResourceSpec::new(name_of(child)?).read(spec.read);
            child_spec.search = spec.search.clone();
            child_spec.validate()?;
            specs.push(child_spec);
        }
    }
    Ok(specs)
}

fn name_of(entry: &Value) -> Result<ResourceName> {
    entry
        .get("resource")
        .and_then(Value::as_str)
        .map(|s| ResourceName(s.to_owned()))
        .ok_or_else(|| invalid("manifest entry without resource".to_owned()))
}

/// `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$` (wire `resourceName`). Resource
/// names come from the server and end up in identifiers, so this is strict.
pub(crate) fn validate_resource(resource: &ResourceName) -> Result<()> {
    let ok = resource.as_str().split('.').all(|seg| {
        let mut bytes = seg.bytes();
        bytes.next().is_some_and(|b| b.is_ascii_lowercase())
            && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
    });
    if ok {
        Ok(())
    } else {
        Err(invalid(format!(
            "invalid resource name {:?}",
            resource.as_str()
        )))
    }
}

/// `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` without `__`. Field paths are
/// inlined into SQL, so nothing else is accepted.
pub(crate) fn validate_field(field: &str) -> Result<()> {
    let ok = !field.contains("__")
        && field.split('.').all(|seg| {
            let mut bytes = seg.bytes();
            bytes.next().is_some_and(|b| b.is_ascii_lowercase())
                && bytes.all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        });
    if ok {
        Ok(())
    } else {
        Err(invalid(format!("invalid field path {field:?}")))
    }
}

/// Mirror table of a resource: `m_` + name with `-` → `_2d` and `.` → `_2e`.
/// Resource names never contain `_`, so every `_` after the prefix starts a
/// fixed-length escape and the mapping is one-to-one (`a--b` → `m_a_2d_2db`,
/// `a.b` → `m_a_2eb`).
pub(crate) fn table_name(resource: &ResourceName) -> String {
    format!("m_{}", ident_part(resource.as_str()))
}

/// FTS5 table paired with a mirror table: `<table>#fts`. Mirror tables and
/// columns only use `[a-z0-9_]`, so a name with one `#` maps back to exactly
/// one table, and FTS5 shadow tables (`<fts>_data`, ...) cannot meet another
/// resource's names. Always used quoted.
pub(crate) fn fts_name(table: &str) -> String {
    format!("{table}#fts")
}

/// Generated column of a field path.
pub(crate) fn column_name(field: &str) -> String {
    format!("f_{}", field.replace('.', "__"))
}

/// Index of a generated column: `<table>#<column>` (columns start with `f_`,
/// so this never equals [`fts_name`]).
pub(crate) fn index_name(table: &str, column: &str) -> String {
    format!("{table}#{column}")
}

/// `$.a.b` for a validated field path.
pub(crate) fn json_path(field: &str) -> String {
    format!("$.{field}")
}

fn ident_part(name: &str) -> String {
    name.replace('-', "_2d").replace('.', "_2e")
}

pub(crate) fn invalid(message: impl std::fmt::Display) -> SyncError {
    SyncError::Decode(<serde_json::Error as serde::de::Error>::custom(message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unsafe_names() {
        assert!(validate_resource(&ResourceName("items.variants".into())).is_ok());
        assert!(validate_resource(&ResourceName("x\"; DROP".into())).is_err());
        assert!(validate_resource(&ResourceName("".into())).is_err());
        assert!(validate_field("party.name").is_ok());
        assert!(validate_field("a__b").is_err());
        assert!(validate_field("a') OR 1").is_err());
        assert_eq!(
            table_name(&ResourceName("price-lists.lines".into())),
            "m_price_2dlists_2elines"
        );
    }
}
