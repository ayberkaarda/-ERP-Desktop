//! Debug-only hook for the Windows e2e suite (desktop/e2e, `desktop-e2e.yml`).
//!
//! msedgedriver starts the app with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
//! --remote-debugging-port=<n>`, but wry passes its own additional browser
//! arguments to WebView2 through the API and the variable never reaches the
//! browser process, so no session can be created. In a debug build on Windows
//! the variable's value is appended to the arguments wry would have used.
//!
//! The whole module (the variable name included) is compiled only with
//! `debug_assertions` on Windows: a release build neither reads the variable
//! nor contains its name (the bundle workflow greps the binary for it).

/// What msedgedriver sets.
pub const ENV: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

/// The arguments wry uses when none are given (wry 0.5x, `webview2/mod.rs`,
/// with `autoplay` on, the default), so that setting extra ones loses nothing.
const WRY_DEFAULTS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection \
                            --autoplay-policy=no-user-gesture-required";

/// The wry defaults plus `extra`; `None` when there is nothing to add.
pub fn compose(extra: Option<&str>) -> Option<String> {
    let extra = extra?.trim();
    if extra.is_empty() {
        return None;
    }
    Some(format!("{WRY_DEFAULTS} {extra}"))
}

/// The arguments for the main window, from the environment.
pub fn browser_args() -> Option<String> {
    compose(std::env::var(ENV).ok().as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_set_changes_nothing() {
        assert_eq!(compose(None), None);
        assert_eq!(compose(Some("  ")), None);
    }

    #[test]
    fn the_value_is_appended_to_the_wry_defaults() {
        let args = compose(Some("--remote-debugging-port=9515")).unwrap();
        assert!(args.starts_with("--disable-features=msWebOOUI"));
        assert!(args.contains("--autoplay-policy=no-user-gesture-required"));
        assert!(args.ends_with(" --remote-debugging-port=9515"));
    }
}
