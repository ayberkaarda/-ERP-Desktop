//! `open_external`: a fixed page of the active profile's web app in the
//! system browser.
//!
//! The webview names a page ([`ExternalTarget`]); the address is built here
//! from the active profile's origin and the page's fixed path, checked like
//! a profile URL (`https`, or a loopback `http` server in a debug build with
//! `KEYSTONE_DEV_ALLOW_HTTP=1`). The browser is started from Rust
//! (`tauri-plugin-opener`'s Rust API): the webview has no open permission
//! of its own, so it cannot send the user, or data in a URL, anywhere else.

use keystone_sync::client::ServerUrl;
use tauri::State;

use crate::bootstrap::Desktop;
use crate::commands::{CommandError, CommandResult, codes};
use crate::dto::external::ExternalTarget;
use crate::state::AppState;

/// Starts the system browser (a test double records instead).
pub trait Opener: Send + Sync {
    fn open(&self, url: &str) -> Result<(), String>;
}

/// The system browser, through `tauri-plugin-opener`.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemOpener;

impl Opener for SystemOpener {
    fn open(&self, url: &str) -> Result<(), String> {
        tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
    }
}

/// The address of `target` on the web app of `base_url`: its origin and the
/// page's fixed path. `allow_http`: see [`crate::bootstrap::allow_http`].
pub fn external_url(
    base_url: &str,
    target: ExternalTarget,
    allow_http: bool,
) -> CommandResult<String> {
    let server = ServerUrl::parse(base_url, allow_http)?;
    Ok(format!("{}{}", server.origin(), target.path()))
}

/// Opens `target` of the active profile with `opener`.
pub async fn open_with(
    desktop: &Desktop,
    state: &AppState,
    target: ExternalTarget,
    opener: &dyn Opener,
) -> CommandResult<()> {
    let id = state.active_profile_id().ok_or_else(|| {
        CommandError::new(codes::NO_ACTIVE_PROFILE, "no server profile is selected")
    })?;
    let profile = desktop.profile_of(&id).await?;
    let url = external_url(&profile.base_url, target, desktop.allows_plain_http())?;
    opener.open(&url).map_err(|error| {
        log::warn!("browser not started: {error}");
        CommandError::new(
            codes::EXTERNAL_OPEN_FAILED,
            "the browser could not be started",
        )
    })
}

/// Opens a page of the active profile's web app in the system browser.
/// Takes a page name, never an address. `NO_ACTIVE_PROFILE` without a profile.
#[tauri::command]
pub async fn open_external(
    desktop: State<'_, Desktop>,
    state: State<'_, AppState>,
    target: ExternalTarget,
) -> CommandResult<()> {
    open_with(&desktop, &state, target, &SystemOpener).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_target_is_a_page_of_the_profile_origin() {
        let base = "https://erp.example.test";
        for (target, url) in [
            (
                ExternalTarget::PasswordChange,
                "https://erp.example.test/password/change",
            ),
            (
                ExternalTarget::Security,
                "https://erp.example.test/profile/security",
            ),
            (ExternalTarget::Home, "https://erp.example.test/"),
        ] {
            assert_eq!(external_url(base, target, false).unwrap(), url);
        }
        assert_eq!(
            external_url(
                "https://erp.example.test:8443/",
                ExternalTarget::Home,
                false
            )
            .unwrap(),
            "https://erp.example.test:8443/"
        );
    }

    #[test]
    fn no_other_origin_or_scheme_is_built() {
        for base in [
            "https://erp.example.test/evil",
            "https://erp.example.test/?next=https://evil.example",
            "https://erp.example.test#https://evil.example",
            "https://user:pass@erp.example.test",
            "https://evil.example@erp.example.test",
            "javascript:alert(1)",
            "file:///C:/Windows/System32/calc.exe",
            "ftp://erp.example.test",
            "erp.example.test",
            "",
        ] {
            let error = external_url(base, ExternalTarget::Home, true).unwrap_err();
            assert_eq!(error.code, "INVALID_SERVER_URL", "{base}");
        }
    }

    #[test]
    fn plain_http_only_to_a_loopback_server_when_allowed() {
        for base in [
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://[::1]:8000",
        ] {
            assert!(
                external_url(base, ExternalTarget::Security, true)
                    .unwrap()
                    .ends_with(":8000/profile/security"),
                "{base}"
            );
            assert_eq!(
                external_url(base, ExternalTarget::Security, false)
                    .unwrap_err()
                    .code,
                "INVALID_SERVER_URL",
                "{base}"
            );
        }
        for base in [
            "http://erp.example.test",
            "http://10.0.0.5:8000",
            "http://localhost.evil.example",
        ] {
            assert_eq!(
                external_url(base, ExternalTarget::Home, true)
                    .unwrap_err()
                    .code,
                "INVALID_SERVER_URL",
                "{base}"
            );
        }
    }
}
