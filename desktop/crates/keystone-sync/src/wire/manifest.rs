//! `GET /api/v1/sync/manifest` (`manifest.response.schema.json`).

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use super::{
    Meta, Permission, ResourceName, SchemaVersion, Scope, Timestamp, VisibilityGeneration,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestResponse {
    pub data: Manifest,
    pub meta: Meta,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: SchemaVersion,
    pub min_schema_version: SchemaVersion,
    pub offline_manifest_version: u32,
    pub server_time: Timestamp,
    pub company_id: Uuid,
    pub user_id: Uuid,
    /// `None` for a browser session.
    pub device_id: Option<Uuid>,
    pub permissions: Vec<Permission>,
    pub resources: Vec<ManifestResource>,
    /// `online_only[].action` keys the user may run, but only online.
    pub online_only: Vec<String>,
    pub limits: Limits,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestResource {
    pub resource: ResourceName,
    pub scope: Scope,
    pub visibility_generation: VisibilityGeneration,
    pub read: ReadMode,
    pub source: Source,
    pub window_days: Option<u32>,
    /// Empty: read-only.
    pub writable: Vec<WriteCapability>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReadMode {
    LocalFirst,
    OnlineFirst,
    OfflineFallback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// Incremental via `/sync/pull`.
    Pull,
    /// Whole snapshot from the REST endpoint.
    Snapshot,
}

/// One `writable` entry: `create`, `update`, `delete` or `action:<name>`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum WriteCapability {
    Create,
    Update,
    Delete,
    Action(String),
}

impl fmt::Display for WriteCapability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Create => f.write_str("create"),
            Self::Update => f.write_str("update"),
            Self::Delete => f.write_str("delete"),
            Self::Action(name) => write!(f, "action:{name}"),
        }
    }
}

impl Serialize for WriteCapability {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for WriteCapability {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        match text.as_str() {
            "create" => Ok(Self::Create),
            "update" => Ok(Self::Update),
            "delete" => Ok(Self::Delete),
            other => match other.strip_prefix("action:") {
                Some(name) if is_action_name(name) => Ok(Self::Action(name.to_owned())),
                _ => Err(serde::de::Error::custom(format!(
                    "invalid writable entry {other:?}"
                ))),
            },
        }
    }
}

/// `^[a-z][a-z-]*$`.
fn is_action_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    bytes.next().is_some_and(|b| b.is_ascii_lowercase())
        && bytes.all(|b| b.is_ascii_lowercase() || b == b'-')
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Limits {
    pub pull_resources_max: u32,
    pub pull_page_default: u32,
    pub pull_page_max: u32,
    pub push_batch_max: u32,
    pub tombstone_retention_days: u32,
    pub idempotency_retention_days: u32,
}
