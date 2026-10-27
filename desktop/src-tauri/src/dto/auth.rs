//! Sign-in, session state and devices as the webview sees them
//! (`auth_*` commands). Never a token.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::profile::ProfileDto;

/// Answer of `auth_login` and `profile_select_company`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoginDto {
    pub profile: ProfileDto,
    /// Sign-in generation of the profile after this sign-in.
    pub generation: u64,
    pub user: UserDto,
    /// Companies the user may work in.
    pub companies: Vec<CompanyDto>,
    /// More than one company and none chosen yet: call
    /// `profile_select_company`.
    pub company_required: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserDto {
    pub id: Uuid,
    pub name: String,
    pub email: String,
    /// The server asks for a password change before most work.
    #[serde(default)]
    pub must_change_password: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompanyDto {
    pub id: Uuid,
    pub name: String,
}

/// Answer of `auth_restore`: the stored sign-in of the active profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthStateDto {
    pub profile_id: String,
    /// Tokens are stored (the server may still refuse them).
    pub signed_in: bool,
    /// The server deactivated the account of the last sign-in.
    pub deactivated: bool,
    pub generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub company_id: Option<Uuid>,
}

/// Answer of `auth_sign_out`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SignOutDto {
    /// Tokens and local data of the profile are gone.
    Done,
    /// Nothing changed: unsent work exists; call again with `force`.
    PendingWork { outbox: usize, conflicts: usize },
}

/// One device sign-in of the user (`GET /api/v1/me/devices`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
}
