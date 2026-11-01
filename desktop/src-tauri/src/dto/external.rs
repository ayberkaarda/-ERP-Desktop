//! Pages of the web app the desktop sends the user to (`open_external`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A fixed page of the active profile's web app. The webview names the
/// page, never an address: the shell builds the URL from the profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(rename_all = "snake_case")]
pub enum ExternalTarget {
    /// Password change (the desktop has no form of its own).
    PasswordChange,
    /// Two-factor set-up and web sessions.
    Security,
    /// The start page.
    Home,
}

impl ExternalTarget {
    /// Path of the page on the web app's origin.
    pub fn path(self) -> &'static str {
        match self {
            Self::PasswordChange => "/password/change",
            Self::Security => "/profile/security",
            Self::Home => "/",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn targets_are_names_with_fixed_paths() {
        for (name, target, path) in [
            (
                "password_change",
                ExternalTarget::PasswordChange,
                "/password/change",
            ),
            ("security", ExternalTarget::Security, "/profile/security"),
            ("home", ExternalTarget::Home, "/"),
        ] {
            assert_eq!(
                serde_json::from_value::<ExternalTarget>(json!(name)).unwrap(),
                target
            );
            assert_eq!(target.path(), path);
        }
    }

    #[test]
    fn an_address_is_not_a_target() {
        for value in [
            json!("https://evil.example/"),
            json!("/password/change"),
            json!("PASSWORD_CHANGE"),
            json!({"url": "https://evil.example/"}),
            json!(""),
        ] {
            assert!(
                serde_json::from_value::<ExternalTarget>(value.clone()).is_err(),
                "{value}"
            );
        }
    }
}
