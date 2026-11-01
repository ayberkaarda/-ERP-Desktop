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

/// Whether the main window may show `url`: the app's own origin only
/// (`http://tauri.localhost` on Windows, `tauri://localhost` elsewhere), or
/// the origin of `dev_url` (`tauri dev`). URLs carrying credentials never.
///
/// The CSP does not cover navigation; without this a script in the page
/// could leave with data in the URL (`location = "https://…/?d=…"`).
pub fn app_url_allowed(url: &tauri::Url, dev_url: Option<&tauri::Url>) -> bool {
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let own = matches!(
        (url.scheme(), url.host_str(), url.port()),
        ("tauri", Some("localhost"), None) | ("http", Some("tauri.localhost"), None)
    );
    own || dev_url.is_some_and(|dev| {
        url.scheme() == dev.scheme()
            && url.host_str() == dev.host_str()
            && url.port_or_known_default() == dev.port_or_known_default()
    })
}

/// The `on_navigation` hook of the main window: [`app_url_allowed`], and a
/// log line naming only the scheme of a blocked URL (the rest may carry data).
pub fn navigation_hook(
    dev_url: Option<tauri::Url>,
) -> impl Fn(&tauri::Url) -> bool + Send + 'static {
    move |url| {
        let allowed = app_url_allowed(url, dev_url.as_ref());
        if !allowed {
            log::warn!("navigation to a {}: URL blocked", url.scheme());
        }
        allowed
    }
}

/// Whether `window.open` / `target=_blank` may open `url`: never. An
/// allowed popup would be a WebView2 window Tauri does not manage, outside
/// the capability and the navigation lock.
pub fn new_window_allowed(url: &tauri::Url) -> bool {
    log::warn!("new window for a {}: URL blocked", url.scheme());
    false
}

/// The config entry the main window is built from: the one labelled
/// [`MAIN_WINDOW`], with `create: false` so Tauri does not build it first
/// without the hooks.
pub fn main_window_config(
    windows: &[tauri::utils::config::WindowConfig],
) -> Result<tauri::utils::config::WindowConfig, String> {
    let main = windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .ok_or("tauri.conf.json has no main window")?;
    if main.create {
        return Err("the main window must have `create: false`; it is built with its hooks".into());
    }
    Ok(main.clone())
}

/// The dev server origin the window may show: `build.devUrl` in a dev build
/// (`tauri dev`, no `custom-protocol`), never in a bundled one.
pub fn allowed_dev_url(dev_build: bool, dev_url: Option<&tauri::Url>) -> Option<tauri::Url> {
    if dev_build { dev_url.cloned() } else { None }
}

/// Builds the main window from its config entry (`create: false` there) with
/// the navigation lock and no new windows: `window.open` and `target=_blank`
/// open nothing. Links out go through `shell` open (`https` only).
fn create_main_window<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    let config = main_window_config(&app.config().app.windows)?;
    let dev_url = allowed_dev_url(tauri::is_dev(), app.config().build.dev_url.as_ref());
    tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?
        .on_navigation(navigation_hook(dev_url))
        .on_new_window(|url, _features| {
            if new_window_allowed(&url) {
                tauri::webview::NewWindowResponse::Allow
            } else {
                tauri::webview::NewWindowResponse::Deny
            }
        })
        .build()?;
    Ok(())
}

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
        .setup(|app| {
            create_main_window(app)?;
            bootstrap::setup(app)
        })
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
mod navigation_tests {
    use super::app_url_allowed;

    fn allowed(url: &str, dev: Option<&str>) -> bool {
        let url = tauri::Url::parse(url).unwrap();
        let dev = dev.map(|d| tauri::Url::parse(d).unwrap());
        app_url_allowed(&url, dev.as_ref())
    }

    #[test]
    fn the_app_origin_is_allowed() {
        for url in [
            "http://tauri.localhost/",
            "http://tauri.localhost/index.html?x=1#top",
            "tauri://localhost/",
            "tauri://localhost/index.html",
        ] {
            assert!(allowed(url, None), "{url}");
        }
    }

    #[test]
    fn everything_else_is_refused() {
        for url in [
            "https://evil.example/?d=secret",
            "http://evil.example/",
            "https://tauri.localhost/",
            "http://tauri.localhost:8080/",
            "http://tauri.localhost.evil.com/",
            "http://tauri.localhost@evil.com/",
            "http://user:pass@tauri.localhost/",
            "http://user@tauri.localhost/",
            "tauri://user@localhost/",
            "tauri://localhost.evil.com/",
            "tauri://evil/",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "file:///C:/Windows/win.ini",
            "about:blank",
            "blob:http://tauri.localhost/0b6c",
            "ipc://localhost/app_info",
            "http://ipc.localhost/app_info",
            "http://localhost:1420/",
        ] {
            assert!(!allowed(url, None), "{url}");
        }
    }

    /// Exact host match: no suffix, prefix or subdomain of the app host.
    #[test]
    fn lookalike_hosts_are_refused() {
        for url in [
            "http://evil.tauri.localhost/",
            "http://xtauri.localhost/",
            "http://eviltauri.localhost/",
            "http://tauri.localhost.evil.com/",
            "tauri://evil.localhost/",
            "tauri://xlocalhost/",
        ] {
            assert!(!allowed(url, None), "{url}");
        }
        let dev = Some("http://localhost:1420");
        for url in [
            "http://evillocalhost:1420/",
            "http://a.localhost:1420/",
            "http://localhost.evil.com:1420/",
        ] {
            assert!(!allowed(url, dev), "{url}");
        }
    }

    fn url(text: &str) -> tauri::Url {
        tauri::Url::parse(text).unwrap()
    }

    /// The hook the main window is built with, not only the rule it uses.
    #[test]
    fn the_navigation_hook_applies_the_rule() {
        let hook = super::navigation_hook(None);
        assert!(hook(&url("http://tauri.localhost/index.html")));
        assert!(hook(&url("tauri://localhost/")));
        for refused in [
            "https://example.com/?d=secret",
            "http://tauri.localhost@example.com/",
            "data:text/html,x",
            "http://localhost:1420/",
        ] {
            assert!(!hook(&url(refused)), "{refused}");
        }
        let dev = super::navigation_hook(Some(url("http://localhost:1420")));
        assert!(dev(&url("http://localhost:1420/src/main.ts")));
        assert!(!dev(&url("https://example.com/")));
    }

    #[test]
    fn new_windows_are_never_allowed() {
        for target in [
            "https://example.com/?d=secret",
            "http://tauri.localhost/",
            "tauri://localhost/",
            "about:blank",
        ] {
            assert!(!super::new_window_allowed(&url(target)), "{target}");
        }
    }

    fn windows(json: serde_json::Value) -> Vec<tauri::utils::config::WindowConfig> {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn the_main_window_is_built_from_its_config_entry() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let shipped = windows(conf["app"]["windows"].clone());
        let main = super::main_window_config(&shipped).unwrap();
        assert_eq!(main.label, super::MAIN_WINDOW);
        assert!(!main.create);
        assert_eq!((main.width, main.height), (1280.0, 800.0));
        assert!(!main.drag_drop_enabled);

        let picked = super::main_window_config(&windows(serde_json::json!([
            { "label": "other", "create": false },
            { "label": "main", "create": false, "title": "Keystone" }
        ])))
        .unwrap();
        assert_eq!(picked.label, "main");
        assert_eq!(picked.title, "Keystone");
    }

    #[test]
    fn a_config_without_a_lockable_main_window_is_an_error() {
        for json in [
            serde_json::json!([]),
            serde_json::json!([{ "label": "other", "create": false }]),
            // Tauri would build this one itself, without the hooks.
            serde_json::json!([{ "label": "main" }]),
        ] {
            assert!(
                super::main_window_config(&windows(json.clone())).is_err(),
                "{json}"
            );
        }
    }

    /// A bundled build (`custom-protocol`, release or `--debug`) never lets
    /// the window go to the dev server, whatever `build.devUrl` says.
    #[test]
    fn the_dev_origin_is_allowed_only_in_a_dev_build() {
        let dev = url("http://localhost:1420");
        assert_eq!(super::allowed_dev_url(false, Some(&dev)), None);
        assert_eq!(super::allowed_dev_url(false, None), None);
        assert_eq!(super::allowed_dev_url(true, Some(&dev)), Some(dev.clone()));
        assert_eq!(super::allowed_dev_url(true, None), None);

        let bundled = super::navigation_hook(super::allowed_dev_url(false, Some(&dev)));
        assert!(!bundled(&url("http://localhost:1420/")));
        assert!(bundled(&url("http://tauri.localhost/")));
        let dev_build = super::navigation_hook(super::allowed_dev_url(true, Some(&dev)));
        assert!(dev_build(&url("http://localhost:1420/")));
    }

    #[test]
    fn the_dev_server_only_in_dev() {
        let dev = Some("http://localhost:1420");
        assert!(allowed("http://localhost:1420/", dev));
        assert!(allowed("http://localhost:1420/src/main.ts", dev));
        for url in [
            "http://localhost:1421/",
            "https://localhost:1420/",
            "http://127.0.0.1:1420/",
            "http://user@localhost:1420/",
            "http://localhost:1420@evil.com/",
            "http://localhost.evil.com:1420/",
            "https://evil.example/",
        ] {
            assert!(!allowed(url, dev), "{url}");
        }
        assert!(allowed("http://tauri.localhost/", dev));
    }
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

    /// The `desktop-shell` CI job, between its header and the next job.
    fn shell_job() -> String {
        let workflow =
            include_str!("../../../.github/workflows/desktop-rust.yml").replace("\r\n", "\n");
        let start = workflow
            .find("\n  desktop-shell:\n")
            .expect("desktop-shell job")
            + 1;
        let body = &workflow[start..];
        // The next line indented by exactly two spaces starts the next job.
        let end = body
            .match_indices("\n  ")
            .map(|(i, _)| i)
            .find(|&i| body[i + 3..].chars().next().is_some_and(|c| c != ' '))
            .unwrap_or(body.len());
        body[..end].to_owned()
    }

    /// The release gate steps run unconditionally and fail the job.
    #[test]
    fn ci_runs_the_release_gate_without_escape_hatches() {
        let workflow = include_str!("../../../.github/workflows/desktop-rust.yml");
        assert!(
            !workflow.contains("continue-on-error"),
            "continue-on-error in the workflow"
        );
        let job = shell_job();
        assert!(
            !job.contains("\n        if:"),
            "a conditional step in desktop-shell:\n{job}"
        );
        assert!(
            !job.contains("\n    if:"),
            "desktop-shell itself is conditional:\n{job}"
        );
        assert!(
            job.contains("\n      - run: cargo check --release -p keystone-desktop --locked\n"),
            "{job}"
        );
        assert!(
            job.contains("\n      - run: cargo test -p keystone-desktop --locked\n"),
            "{job}"
        );
        assert!(job.contains("run: sh scripts/check-ts-types.sh"), "{job}");
    }

    /// The negative step wants the build script's panic (cargo exit 101)
    /// and the guard's own message, not just any failure.
    #[test]
    fn ci_expects_the_refused_release_build_to_exit_101() {
        let job = shell_job();
        let step = job
            .split("\n      - ")
            .find(|step| step.contains("TAURI_CONFIG="))
            .expect("negative release step");
        assert!(
            step.contains("connect-src ipc: http://ipc.localhost https:"),
            "{step}"
        );
        assert!(step.contains("set +e"), "{step}");
        assert!(step.contains(r#"[ "$status" -ne 101 ]"#), "{step}");
        assert!(step.contains("exit 1"), "{step}");
        let grep = step
            .lines()
            .find(|line| line.contains("grep -F"))
            .expect("grep line");
        assert_eq!(
            grep.trim(),
            "grep -F 'release build refused: connect-src allows https:' refused.log",
            "the grep must decide the step (no `|| true`)"
        );
        assert!(!step.contains("|| true"), "{step}");
    }

    /// The main window is built in code, where its navigation and new-window
    /// handlers are set; a window Tauri created from the config would have neither.
    #[test]
    fn the_config_creates_no_window_itself() {
        let conf = tauri_conf();
        let windows = conf["app"]["windows"].as_array().unwrap();
        assert_eq!(windows.len(), 1);
        assert_eq!(windows[0]["create"], Value::Bool(false));
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
