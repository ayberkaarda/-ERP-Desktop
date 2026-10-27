//! Keystone desktop shell: a thin Tauri 2 host around `keystone-sync`.
//!
//! The webview reaches the outside world only through the commands
//! registered in [`run`]; tokens and the database key stay in Rust.
//!
//! Contracts other modules build on:
//! - [`state::AppState`]: the active profile slot, `client()` / `engine()`.
//! - [`commands::CommandError`]: `{code, message, retry_after?}` of every command.
//! - [`ENGINE_EVENT`]: the one Tauri event the engine bridge emits.

#![forbid(unsafe_code)]

pub mod bootstrap;
#[cfg(test)]
mod build_guard;
pub mod commands;
pub mod dto;
pub mod events;
pub mod logging;
pub mod profiles;
pub mod router;
pub mod runtime;
pub mod state;

use tauri::Manager;

/// Name of the single Tauri event that carries engine news to the webview,
/// in order. Payload: `{"type": "status", ...}` (a `SyncStatus` change) or
/// `{"type": "resources_changed", ...}` (resources the engine rewrote).
pub const ENGINE_EVENT: &str = "engine-event";

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
            commands::sync::conflicts_resolve
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
    fn capability_grants_only_the_skeleton_set() {
        let permissions = capability()["permissions"].as_array().unwrap().clone();
        let ids: Vec<String> = permissions
            .iter()
            .map(|p| match p {
                Value::String(id) => id.clone(),
                other => other["identifier"].as_str().unwrap().to_owned(),
            })
            .collect();
        assert_eq!(
            ids,
            [
                "core:default",
                "os:allow-platform",
                "process:allow-restart",
                "shell:allow-open"
            ]
        );
        for banned in [
            "fs:",
            "http:",
            "dialog:",
            "updater:",
            "deep-link:",
            "notification:",
        ] {
            assert!(
                !ids.iter().any(|id| id.starts_with(banned)),
                "{banned} granted"
            );
        }
    }

    #[test]
    fn shell_open_is_https_only() {
        let open = capability()["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["identifier"] == "shell:allow-open")
            .cloned()
            .unwrap();
        assert_eq!(open["allow"], serde_json::json!([{ "url": "https://*" }]));
        assert_eq!(tauri_conf()["plugins"]["shell"]["open"], "^https://");
    }
}
