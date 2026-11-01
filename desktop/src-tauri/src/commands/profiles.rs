//! `profile_*` commands: server profiles (add, list, select, reset,
//! remove) and the company of the active profile. The work is in
//! [`Desktop`].

use tauri::State;
use uuid::Uuid;

use crate::bootstrap::Desktop;
use crate::commands::CommandResult;
use crate::dto::auth::LoginDto;
use crate::dto::profile::{ProfileDto, ProfileStateDto, ProfilesDto};
use crate::state::AppState;

/// Reads `{url}/api/v1/meta` and stores a new profile (not selected).
/// `DESKTOP_UPDATE_REQUIRED` / `SYNC_SCHEMA_MISMATCH` when the server needs
/// a newer app.
#[tauri::command]
pub async fn profile_add(
    desktop: State<'_, Desktop>,
    url: String,
    name: Option<String>,
) -> CommandResult<ProfileDto> {
    desktop.add_profile(&url, name.as_deref()).await
}

#[tauri::command]
pub async fn profile_list(desktop: State<'_, Desktop>) -> CommandResult<ProfilesDto> {
    desktop.list_profiles().await
}

/// Makes `id` the active profile.
#[tauri::command]
pub async fn profile_select(
    desktop: State<'_, Desktop>,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<ProfileDto> {
    desktop.select(&state, &id).await
}

/// Deletes the profile's sign-in, database key and local data; keeps the
/// profile. The way out of `PROFILE_RECORD_MALFORMED` and
/// `STORE_KEY_INVALID`.
#[tauri::command]
pub async fn profile_reset(
    desktop: State<'_, Desktop>,
    state: State<'_, AppState>,
    id: String,
    force: Option<bool>,
) -> CommandResult<ProfileDto> {
    desktop.reset(&state, &id, force.unwrap_or(false)).await
}

/// Deletes the profile with its sign-in, database key and local data.
#[tauri::command]
pub async fn profile_remove(
    desktop: State<'_, Desktop>,
    state: State<'_, AppState>,
    id: String,
    force: Option<bool>,
) -> CommandResult<()> {
    desktop.remove(&state, &id, force.unwrap_or(false)).await
}

/// Chooses the company of the active profile (after a sign-in that
/// answered `company_required`, or a switch). A different company with
/// unsent work: `PROFILE_HAS_PENDING_WORK` unless `force` (the work is lost).
#[tauri::command]
pub async fn profile_select_company(
    desktop: State<'_, Desktop>,
    state: State<'_, AppState>,
    company: Uuid,
    force: Option<bool>,
) -> CommandResult<LoginDto> {
    desktop
        .select_company(&state, company, force.unwrap_or(false))
        .await
}

/// The state of the active profile (start-up restore included); changes
/// come as the `profile-state` event.
#[tauri::command]
pub fn profile_state(desktop: State<'_, Desktop>) -> ProfileStateDto {
    desktop.profile_state()
}

/// Reads the server's `/api/v1/meta` again (same checks as `profile_add`).
#[tauri::command]
pub async fn profile_refresh_meta(
    desktop: State<'_, Desktop>,
    state: State<'_, AppState>,
    id: String,
) -> CommandResult<ProfileDto> {
    desktop.refresh_meta(&state, &id).await
}
