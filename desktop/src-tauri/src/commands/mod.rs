//! Tauri commands of the shell and the error shape every one of them returns.
//!
//! A command returns `Result<T, CommandError>`; Tauri serializes the error as
//! `{code, message, retry_after?}`. `code` is the stable key the UI looks up
//! as `desktop.errors.<code>`: for an engine error it is
//! [`SyncError::code`] verbatim (the server `ErrorCode` wire value, or the
//! crate `LocalCode`), for a shell error one of [`codes`].

pub mod api;
pub mod auth;
pub mod profiles;
pub mod sync;

use std::time::Duration;

use keystone_sync::SyncError;
use serde::Serialize;
use ts_rs::TS;

/// Error codes produced by the shell itself (not by `keystone-sync`).
pub mod codes {
    /// No server profile is selected.
    pub const NO_ACTIVE_PROFILE: &str = "NO_ACTIVE_PROFILE";
    /// The active profile has no sync engine (its local store is not open).
    pub const ENGINE_UNAVAILABLE: &str = "ENGINE_UNAVAILABLE";
}

/// Error of a Tauri command, as the webview receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    /// Whole seconds to wait before retrying (from the server `Retry-After`),
    /// rounded up. Absent when the server sent none.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number", optional)]
    pub retry_after: Option<u64>,
}

pub type CommandResult<T> = Result<T, CommandError>;

impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retry_after: None,
        }
    }

    pub fn with_retry_after(mut self, wait: Duration) -> Self {
        self.retry_after = Some(whole_seconds(wait));
        self
    }
}

fn whole_seconds(wait: Duration) -> u64 {
    let secs = wait.as_secs();
    if wait.subsec_nanos() > 0 {
        secs.saturating_add(1)
    } else {
        secs
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CommandError {}

/// The code is kept as is; the message is the crate's own text, which is
/// already redacted for sign-in, account and unknown server codes.
impl From<SyncError> for CommandError {
    fn from(error: SyncError) -> Self {
        let retry_after = error.retry_after().map(whole_seconds);
        Self {
            code: error.code().to_owned(),
            message: error.to_string(),
            retry_after,
        }
    }
}

/// Build facts of the running shell, for the smoke page and diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub identifier: String,
    /// `keystone-sync` wire schema version (`contracts/sync`).
    pub sync_schema_version: u32,
    pub os: &'static str,
    pub debug: bool,
}

impl AppInfo {
    pub fn new(name: &str, version: &str, identifier: &str) -> Self {
        Self {
            name: name.to_owned(),
            version: version.to_owned(),
            identifier: identifier.to_owned(),
            sync_schema_version: keystone_sync::wire::SCHEMA_VERSION,
            os: std::env::consts::OS,
            debug: cfg!(debug_assertions),
        }
    }
}

#[tauri::command]
pub fn app_info<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> CommandResult<AppInfo> {
    let package = app.package_info();
    Ok(AppInfo::new(
        &package.name,
        &package.version.to_string(),
        &app.config().identifier,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use keystone_sync::wire::{ApiError, ErrorCode};
    use serde_json::json;

    fn api_error(code: ErrorCode, message: &str) -> ApiError {
        serde_json::from_value(json!({ "code": code.as_str(), "message": message }))
            .expect("api error body")
    }

    #[test]
    fn serializes_as_code_message_and_optional_retry_after() {
        let plain = CommandError::new("NO_ACTIVE_PROFILE", "no profile");
        assert_eq!(
            serde_json::to_value(&plain).unwrap(),
            json!({ "code": "NO_ACTIVE_PROFILE", "message": "no profile" })
        );

        let throttled = plain.with_retry_after(Duration::from_secs(30));
        assert_eq!(
            serde_json::to_value(&throttled).unwrap(),
            json!({ "code": "NO_ACTIVE_PROFILE", "message": "no profile", "retry_after": 30 })
        );
    }

    #[test]
    fn retry_after_rounds_up_to_whole_seconds() {
        let error = CommandError::new("X", "x").with_retry_after(Duration::from_millis(1200));
        assert_eq!(error.retry_after, Some(2));
        let error = CommandError::new("X", "x").with_retry_after(Duration::ZERO);
        assert_eq!(error.retry_after, Some(0));
    }

    #[test]
    fn sync_error_code_is_kept_verbatim() {
        let local: CommandError = SyncError::OfflineUnavailable("parties".into()).into();
        assert_eq!(local.code, "OFFLINE_UNAVAILABLE");
        assert_eq!(local.retry_after, None);

        let server = SyncError::from_api(
            429,
            api_error(ErrorCode::TooManyAttempts, "slow down"),
            Some(Duration::from_secs(7)),
        );
        let expected_code = server.code();
        let error: CommandError = server.into();
        assert_eq!(error.code, expected_code);
        assert_eq!(error.code, "TOO_MANY_ATTEMPTS");
        assert_eq!(error.retry_after, Some(7));
    }

    #[test]
    fn redacted_sync_error_text_stays_redacted() {
        let secret = "password hunter2 rejected";
        let error: CommandError =
            SyncError::from_api(401, api_error(ErrorCode::Unauthenticated, secret), None).into();
        assert_eq!(error.code, "UNAUTHENTICATED");
        assert!(!error.message.contains("hunter2"), "{}", error.message);
    }

    #[test]
    fn app_info_carries_build_facts() {
        let info = AppInfo::new("Keystone", "0.1.0", "com.keystone.desktop");
        assert_eq!(info.identifier, "com.keystone.desktop");
        assert_eq!(
            info.sync_schema_version,
            keystone_sync::wire::SCHEMA_VERSION
        );
        assert_eq!(info.os, std::env::consts::OS);
        assert_eq!(info.debug, cfg!(debug_assertions));
    }
}
