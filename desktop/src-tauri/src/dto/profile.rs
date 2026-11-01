//! Server profiles as the webview sees them (`profile_*` commands).

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::commands::CommandError;
use crate::profiles::Profile;

/// One server profile. No secret: tokens and keys stay in the keychain.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct ProfilesDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_id: Option<String>,
    pub profiles: Vec<ProfileDto>,
}

/// Where the active profile is in its life cycle (`profile_state`, and the
/// `profile-state` event on every change).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(rename_all = "snake_case")]
pub enum ProfilePhase {
    /// No profile is selected (first start, or the active one was removed).
    None,
    /// A profile is being opened (start-up restore, switch, reset, company).
    Starting,
    /// Active with its local store and engine.
    Ready,
    /// Active without a local store: online requests work, offline ones and
    /// sync do not. `error` says why (`STORE_KEY_INVALID`, ...).
    Engineless,
    /// Opening failed and no profile is active (`profile_id`: the one that
    /// failed, if known). `error` says why (`PROFILE_RECORD_MALFORMED`,
    /// `PROFILES_FILE_INVALID`, `INVALID_SERVER_URL`, ...).
    Failed,
}

/// The profile state the UI starts from (the start-up restore runs in the
/// background; its outcome is only here and in the event).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct ProfileStateDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub profile_id: Option<String>,
    pub phase: ProfilePhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub error: Option<CommandError>,
}

impl ProfileStateDto {
    pub fn new(phase: ProfilePhase, profile_id: Option<&str>, error: Option<CommandError>) -> Self {
        Self {
            profile_id: profile_id.map(str::to_owned),
            phase,
            error,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_state_names_its_phase_profile_and_error() {
        let failed = ProfileStateDto::new(
            ProfilePhase::Failed,
            Some("p1"),
            Some(CommandError::new("PROFILE_RECORD_MALFORMED", "reset it")),
        );
        assert_eq!(
            serde_json::to_value(&failed).unwrap(),
            serde_json::json!({
                "profile_id": "p1", "phase": "failed",
                "error": {"code": "PROFILE_RECORD_MALFORMED", "message": "reset it"}
            })
        );
        let none = ProfileStateDto::new(ProfilePhase::None, None, None);
        assert_eq!(
            serde_json::to_value(&none).unwrap(),
            serde_json::json!({"phase": "none"})
        );
        for (phase, name) in [
            (ProfilePhase::Starting, "starting"),
            (ProfilePhase::Ready, "ready"),
            (ProfilePhase::Engineless, "engineless"),
        ] {
            assert_eq!(serde_json::to_value(phase).unwrap(), name);
        }
    }
}
