//! Sign-in, session state and devices as the webview sees them
//! (`auth_*` commands). Never a token.

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use super::profile::ProfileDto;

/// Answer of `auth_login` and `profile_select_company`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct LoginDto {
    pub profile: ProfileDto,
    /// Sign-in generation of the profile after this sign-in.
    #[ts(type = "number")]
    pub generation: u64,
    pub user: UserDto,
    /// Companies the user may work in.
    pub companies: Vec<CompanyDto>,
    /// More than one company and none chosen yet: call
    /// `profile_select_company`.
    pub company_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct UserDto {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    /// The server asks for a password change before most work.
    #[serde(default)]
    pub must_change_password: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct CompanyDto {
    pub id: Uuid,
    pub name: String,
}

/// Answer of `auth_restore`: the stored sign-in of the active profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct AuthStateDto {
    pub profile_id: String,
    /// Tokens are stored (the server may still refuse them).
    pub signed_in: bool,
    /// The server deactivated the account of the last sign-in.
    pub deactivated: bool,
    #[ts(type = "number")]
    pub generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company_id: Option<Uuid>,
}

/// Answer of `auth_sign_out`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SignOutDto {
    /// Tokens and local data of the profile are gone.
    Done,
    /// Nothing changed: unsent work exists; call again with `force`.
    PendingWork {
        #[ts(type = "number")]
        outbox: usize,
        #[ts(type = "number")]
        conflicts: usize,
    },
}

/// One device sign-in of the user (`GET /api/v1/me/devices`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct DeviceDto {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub ip_address: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    #[serde(default)]
    pub last_used_at: Option<String>,
    pub expires_at: String,
    #[serde(default)]
    pub created_at: Option<String>,
    /// The sign-in of this desktop (the token the request was made with).
    /// False when the server does not send it, or sends null.
    #[serde(default, deserialize_with = "null_as_false")]
    pub is_current: bool,
}

/// `null` reads as `false`, so one odd device does not fail the whole list.
fn null_as_false<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    Ok(Option::<bool>::deserialize(deserializer)?.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::DeviceDto;
    use serde_json::json;

    fn answer(extra: serde_json::Value) -> serde_json::Value {
        let mut device = json!({
            "id": "0192f5a0-0000-7000-8000-0000000000d3",
            "name": "LAPTOP",
            "expires_at": "2026-11-26T09:15:00+03:00"
        });
        let fields = device.as_object_mut().unwrap();
        fields.extend(extra.as_object().unwrap().clone());
        device
    }

    #[test]
    fn the_webview_receives_is_current_under_its_own_name() {
        let device: DeviceDto =
            serde_json::from_value(answer(json!({"is_current": true}))).unwrap();
        let sent = serde_json::to_value(&device).unwrap();
        assert_eq!(sent["is_current"], json!(true));
        assert!(sent.get("isCurrent").is_none());
    }

    #[test]
    fn a_missing_or_null_is_current_is_not_this_device() {
        for extra in [json!({}), json!({"is_current": null})] {
            let device: DeviceDto = serde_json::from_value(answer(extra.clone())).unwrap();
            assert!(!device.is_current, "{extra}");
        }
        let device: DeviceDto =
            serde_json::from_value(answer(json!({"is_current": false}))).unwrap();
        assert!(!device.is_current);
    }
}
