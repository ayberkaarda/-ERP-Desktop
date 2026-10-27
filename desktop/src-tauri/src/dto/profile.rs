//! Server profiles as the webview sees them (`profile_*` commands).

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::profiles::Profile;

/// One server profile. No secret: tokens and keys stay in the keychain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileDto {
    pub id: String,
    pub name: String,
    pub base_url: String,
    /// Server product name and version from `/api/v1/meta`.
    pub server_name: String,
    pub server_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company_id: Option<Uuid>,
    pub created_at: String,
    /// The realtime server is configured (`meta.reverb.key` and `host`).
    pub realtime: bool,
}

impl From<&Profile> for ProfileDto {
    fn from(profile: &Profile) -> Self {
        let meta = &profile.meta_snapshot;
        Self {
            id: profile.id.clone(),
            name: profile.name.clone(),
            base_url: profile.base_url.clone(),
            server_name: meta.name.clone(),
            server_version: meta.version.clone(),
            company_id: profile.company_id,
            created_at: profile.created_at.clone(),
            realtime: meta.reverb.key.is_some() && meta.reverb.host.is_some(),
        }
    }
}

/// Every profile and the active one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfilesDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_id: Option<String>,
    pub profiles: Vec<ProfileDto>,
}
