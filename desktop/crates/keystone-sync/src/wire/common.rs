//! `contracts/sync/common.schema.json` and `error.response.schema.json`.

use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Map, Value};
use uuid::Uuid;

use super::ErrorCode;
use super::serde_util::{decimal_u64, parse_decimal_u64};

/// `meta` of a success response. Sync endpoints leave it empty for now.
pub type Meta = Map<String, Value>;

/// `schemaVersion`.
pub type SchemaVersion = u32;

/// `visibilityGeneration`.
pub type VisibilityGeneration = u64;

/// PostgreSQL `xid8`, carried as a decimal string on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Xid8(pub u64);

impl Serialize for Xid8 {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        decimal_u64(&self.0, serializer)
    }
}

impl<'de> Deserialize<'de> for Xid8 {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        parse_decimal_u64(deserializer).map(Self)
    }
}

impl fmt::Display for Xid8 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

/// ISO 8601 timestamp with offset, kept verbatim so it round-trips unchanged.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Timestamp(pub String);

/// `resourceName`, e.g. `parties`, `items.variants`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ResourceName(pub String);

impl ResourceName {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ResourceName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Permission name, e.g. `sales.quotes.create`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Permission(pub String);

/// Per-resource keyset position.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cursor {
    pub txid: Xid8,
    pub after_id: Option<Uuid>,
    #[serde(rename = "gen")]
    pub generation: VisibilityGeneration,
}

/// Company scope of a resource.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    Company,
    CompanyOrGlobal,
    GlobalWithCompanyActivation,
}

/// Required permissions.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requires {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub any_of: Option<Vec<Permission>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub all_of: Option<Vec<Permission>>,
}

/// The `errors` object of an error body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApiError {
    pub message: String,
    pub code: ErrorCode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<BTreeMap<String, Vec<String>>>,
}

/// `error.response.schema.json`: `{errors: {...}}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorResponse {
    pub errors: ApiError,
}

/// A row exactly as the REST API Resource returns it. Only `id` (and
/// `version`, when present) is typed; every other field is kept as-is.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResourceRow {
    pub id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
    #[serde(flatten)]
    pub fields: Map<String, Value>,
}

/// Root object of `common.schema.json`: one optional sample per definition.
/// Only fixtures use it; it keeps every shared definition under test.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommonSamples {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uuid: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uuidv7: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xid8: Option<Xid8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<Cursor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visibility_generation: Option<VisibilityGeneration>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<Scope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resource_name: Option<ResourceName>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<Timestamp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema_version: Option<SchemaVersion>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<Permission>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires: Option<Requires>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_error: Option<ApiError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Meta>,
}
