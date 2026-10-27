//! `auth_*` commands: device sign-in, the stored sign-in, sign-out and
//! the user's devices. Tokens never leave Rust.
//!
//! `/api/v1/auth/**` is closed to `api_request`; what the UI needs from it
//! comes through these commands (`auth/device` via `auth_login`,
//! `auth/me` inside `auth_login` / `profile_select_company`). A password
//! change (`auth/password/change`) answers a desktop client with a new
//! token pair that only the sync crate may store, so it waits for a crate
//! method and is not offered here.

use tauri::State;
use uuid::Uuid;

use crate::bootstrap::{Desktop, proxy_json};
use crate::commands::{CommandError, CommandResult};
use crate::dto::auth::{AuthStateDto, DeviceDto, LoginDto, SignOutDto};
use crate::state::AppState;
use keystone_sync::client::ProxyMethod;

/// Device sign-in to the active profile. `TWO_FACTOR_REQUIRED`: ask for
/// the code and call again with `two_factor_code`.
#[tauri::command]
pub async fn auth_login(
    desktop: State<'_, Desktop>,
    state: State<'_, AppState>,
    email: String,
    password: String,
    two_factor_code: Option<String>,
) -> CommandResult<LoginDto> {
    let device_name = device_name(&tauri_plugin_os::hostname());
    desktop
        .login(&state, email, password, two_factor_code, device_name)
        .await
}

/// The stored sign-in of the active profile, without the network.
#[tauri::command]
pub async fn auth_restore(
    desktop: State<'_, Desktop>,
    state: State<'_, AppState>,
) -> CommandResult<AuthStateDto> {
    desktop.auth_state(&state).await
}

/// Signs out of the active profile and deletes its local data. With
/// unsent work the answer is `pending_work` and nothing changes, unless
/// `force`.
#[tauri::command]
pub async fn auth_sign_out(
    desktop: State<'_, Desktop>,
    state: State<'_, AppState>,
    force: Option<bool>,
) -> CommandResult<SignOutDto> {
    desktop.sign_out(&state, force.unwrap_or(false)).await
}

/// Device sign-ins of the user (`GET /api/v1/me/devices`).
#[tauri::command]
pub async fn auth_devices_list(state: State<'_, AppState>) -> CommandResult<Vec<DeviceDto>> {
    devices_list(&state).await
}

/// Ends a device sign-in (`DELETE /api/v1/me/devices/{id}`).
#[tauri::command]
pub async fn auth_devices_revoke(state: State<'_, AppState>, id: Uuid) -> CommandResult<()> {
    devices_revoke(&state, id).await
}

pub async fn devices_list(state: &AppState) -> CommandResult<Vec<DeviceDto>> {
    let client = state.client()?;
    let body = proxy_json(&client, ProxyMethod::Get, "/api/v1/me/devices").await?;
    serde_json::from_value(body["data"].clone())
        .map_err(|_| CommandError::new("DECODE_ERROR", "unexpected device list answer"))
}

pub async fn devices_revoke(state: &AppState, id: Uuid) -> CommandResult<()> {
    let client = state.client()?;
    let path = format!("/api/v1/me/devices/{}", id.hyphenated());
    proxy_json(&client, ProxyMethod::Delete, &path)
        .await
        .map(drop)
}

/// The device name sent with a sign-in: the host name, or a fixed name
/// when there is none.
pub fn device_name(hostname: &str) -> String {
    let name: String = hostname
        .trim()
        .chars()
        .filter(|c| !c.is_control())
        .take(100)
        .collect();
    if name.is_empty() {
        "Keystone desktop".to_owned()
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_name_is_the_host_name_or_a_default() {
        assert_eq!(device_name(" OFFICE-PC \n"), "OFFICE-PC");
        assert_eq!(device_name(""), "Keystone desktop");
        assert_eq!(device_name(&"x".repeat(300)).len(), 100);
    }
}
