//! Keystone desktop shell: a thin Tauri 2 host around `keystone-sync`.
//!
//! The webview reaches the outside world only through the commands
//! registered in [`run`]; tokens and the database key stay in Rust.
//!
//! Contracts other modules build on:
//! - [`state::AppState`]: the active profile slot, `client()` / `engine()`.
//! - [`commands::CommandError`]: `{code, message, retry_after?}` of every command.
//! - [`ENGINE_EVENT`]: the one Tauri event the engine bridge emits.
//! - [`REALTIME_EVENT`]: the one Tauri event the realtime bridge emits.

#![forbid(unsafe_code)]

pub mod bootstrap;
#[cfg(test)]
mod build_guard;
pub mod commands;
pub mod dto;
pub mod events;
pub mod logging;
pub mod profiles;
pub mod realtime;
pub mod router;
pub mod runtime;
pub mod state;

use tauri::Manager;

/// Name of the single Tauri event that carries engine news to the webview,
/// in order. Payload: `{"type": "status", ...}` (a `SyncStatus` change) or
/// `{"type": "resources_changed", ...}` (resources the engine rewrote).
pub const ENGINE_EVENT: &str = "engine-event";

/// Name of the single Tauri event that carries realtime news to the webview,
/// in order; the payload is [`dto::realtime::RealtimeEventDto`].
pub const REALTIME_EVENT: &str = "realtime-event";

/// Label of the main window (`tauri.conf.json`, `capabilities/default.json`).
pub const MAIN_WINDOW: &str = "main";

pub fn run() {
    let builder = tauri::Builder::default();

    // Must be the first plugin: a second launch hands over and exits before
    // anything else starts (one process per data directory and keychain).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(logging::plugin())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .manage(state::AppState::default())
        .manage(router::Connectivity::default())
        .setup(bootstrap::setup)
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::api::api_request,
            commands::profiles::profile_add,
            commands::profiles::profile_list,
            commands::profiles::profile_select,
            commands::profiles::profile_reset,
            commands::profiles::profile_remove,
            commands::profiles::profile_select_company,
            commands::auth::auth_login,
            commands::auth::auth_restore,
            commands::auth::auth_sign_out,
            commands::auth::auth_devices_list,
            commands::auth::auth_devices_revoke,
            commands::sync::sync_now,
            commands::sync::sync_status,
            commands::sync::outbox_list,
            commands::sync::outbox_retry,
            commands::sync::outbox_discard,
            commands::sync::conflicts_list,
            commands::sync::conflicts_resolve,
            realtime::realtime_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running the Keystone desktop shell");
}

#[cfg(test)]
mod config_tests {
    use serde_json::Value;

    fn json(text: &str) -> Value {
        serde_json::from_str(text).expect("valid JSON")
    }

    fn tauri_conf() -> Value {
        json(include_str!("../tauri.conf.json"))
    }

    fn capability() -> Value {
        json(include_str!("../capabilities/default.json"))
    }

    #[test]
    fn global_tauri_is_off_and_devtools_are_not_forced_on() {
        let conf = tauri_conf();
        assert_eq!(conf["app"]["withGlobalTauri"], Value::Bool(false));
        for window in conf["app"]["windows"].as_array().unwrap() {
            assert_ne!(window["devtools"], Value::Bool(true), "{window}");
        }
        let manifest = include_str!("../Cargo.toml");
        assert!(
            !manifest.contains("\"devtools\""),
            "tauri devtools feature enabled"
        );
    }

    #[test]
    fn names_are_the_product_names() {
        let conf = tauri_conf();
        assert_eq!(conf["productName"], "Keystone");
        assert_eq!(conf["identifier"], "com.keystone.desktop");
        assert_eq!(conf["app"]["windows"][0]["label"], super::MAIN_WINDOW);
        assert_eq!(
            capability()["windows"],
            serde_json::json!([super::MAIN_WINDOW])
        );
    }

    #[test]
    fn capability_grants_only_the_listed_permissions() {
        let granted = capability()["permissions"].as_array().unwrap().clone();
        assert_eq!(
            granted,
            [
                "core:event:allow-listen",
                "core:event:allow-unlisten",
                "core:event:allow-emit",
                "core:window:allow-show",
                "core:window:allow-hide",
                "core:window:allow-set-focus",
                "core:window:allow-minimize",
                "core:window:allow-close",
                "os:allow-platform",
                "process:allow-restart",
                "shell:allow-open",
            ]
        );
    }

    #[test]
    fn it_is_the_only_capability() {
        let names: Vec<String> =
            std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities"))
                .unwrap()
                .map(|entry| entry.unwrap().file_name().into_string().unwrap())
                .collect();
        assert_eq!(names, ["default.json"]);
    }

    /// The plugin takes the URLs `open` accepts from `plugins.shell.open`
    /// alone: its capability scope has no URL entry, so one here would only
    /// look like a limit. It compiles the pattern as `^{pattern}$`.
    #[test]
    fn shell_open_is_limited_by_the_config_pattern() {
        let conf = tauri_conf();
        let pattern = conf["plugins"]["shell"]["open"].as_str().unwrap();
        let open = regex::Regex::new(&format!("^{pattern}$")).unwrap();
        assert!(open.is_match("https://example.com/report?id=1"));
        for refused in [
            "https://",
            "https://example.com/a b",
            "https://example.com\ncalc.exe",
            "http://example.com",
            "HTTP://example.com",
            "file:///C:/Windows/System32/calc.exe",
            "mailto:someone@example.com",
            "tel:+905550000000",
            "javascript:alert(1)",
            "C:\\Windows\\System32\\calc.exe",
            " https://example.com",
            "keystone://open",
        ] {
            assert!(!open.is_match(refused), "{refused}");
        }
    }

    /// Everything but `connect-src` matches the shipped policy; what `tauri
    /// dev` adds is the Vite hot-reload socket.
    #[test]
    fn dev_policy_adds_only_the_vite_socket() {
        let conf = tauri_conf();
        let security = &conf["app"]["security"];
        let csp = security["csp"].as_str().unwrap();
        assert_eq!(
            security["devCsp"].as_str().unwrap(),
            csp.replace(
                "connect-src ipc: http://ipc.localhost",
                "connect-src ipc: http://ipc.localhost ws://localhost:1420"
            )
        );
    }

    #[test]
    fn the_asset_rewrite_stays_on_and_the_asset_protocol_off() {
        let conf = tauri_conf();
        let security = conf["app"]["security"].as_object().unwrap();
        let mut keys: Vec<&str> = security.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["csp", "devCsp"]);
    }
}
