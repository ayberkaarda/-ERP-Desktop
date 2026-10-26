//! `GET /api/v1/meta`: public server metadata read when a server profile is
//! added (no contract schema yet; shape of the server `MetaController`).
//! Unknown fields are ignored.

use serde::{Deserialize, Serialize};

use super::{Meta, SchemaVersion};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerMetaResponse {
    pub data: ServerMeta,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<Meta>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerMeta {
    pub name: String,
    pub version: String,
    pub api_version: String,
    pub reverb: ReverbMeta,
    pub desktop: DesktopMeta,
    pub sync: SyncMeta,
}

/// Public Reverb connection data (the key is public; the secret is never sent).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReverbMeta {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub scheme: Option<String>,
    pub key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopMeta {
    pub min_version: Option<String>,
    pub update_channel: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncMeta {
    pub schema_version: SchemaVersion,
    pub min_schema_version: SchemaVersion,
}
