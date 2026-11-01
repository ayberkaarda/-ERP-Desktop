//! Build input checks, shared by `build.rs` (which acts on them) and the
//! crate's tests (which pin them). Std and `serde_json` only: this file is
//! compiled into the build script too.
//!
//! `tauri.conf.json` carries the locked Content-Security-Policy. A release
//! build stops when the effective policy is not locked: no policy, the
//! deny-all placeholder, a `connect-src` that reaches anything but the IPC,
//! a remote source in any other directive, an unsafe script source or a
//! report endpoint. The webview talks to the outside world through commands
//! only. A release build with the development HTTP switch set stops as well.
//!
//! The effective configuration is what `tauri-build` compiles in:
//! `tauri.conf.json`, then `tauri.<os>.conf.json`, then the `TAURI_CONFIG`
//! overlay of the CLI, each merged as a JSON merge patch.

use serde_json::Value;

/// Token of the deny-all placeholder policy.
pub const PLACEHOLDER_MARKER: &str = "keystone-placeholder-csp";

/// Development switch that lets a debug build talk to `http://localhost`.
pub const DEV_ALLOW_HTTP: &str = "KEYSTONE_DEV_ALLOW_HTTP";

/// All of `connect-src`, and all of it is needed: the IPC goes through
/// `http://ipc.localhost` on Windows and `ipc:` elsewhere. Without them it
/// does not fail, it falls back to the slower `postMessage`.
pub const CONNECT_SOURCES: [&str; 2] = ["ipc:", "http://ipc.localhost"];

/// Label of the one window (`MAIN_WINDOW` of the crate).
pub const MAIN_WINDOW_LABEL: &str = "main";

/// The build script's inputs as read from the environment and the disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gathered {
    pub release: bool,
    pub config: String,
    /// `tauri.<target os>.conf.json`, read when present.
    pub platform_file: String,
    pub platform: Option<String>,
    pub overlay: Option<String>,
    pub dev_allow_http: bool,
}

impl Gathered {
    pub fn inputs(&self) -> Inputs<'_> {
        Inputs {
            release: self.release,
            config: &self.config,
            platform: self.platform.as_deref(),
            overlay: self.overlay.as_deref(),
            dev_allow_http: self.dev_allow_http,
        }
    }
}

/// Reads the inputs through `var` (an environment variable, lossy UTF-8)
/// and `read` (a file next to `tauri.conf.json`). Cargo `PROFILE` is
/// `release` for release-like profiles, `debug` otherwise. The platform file
/// is the one tauri-build picks for the target OS.
pub fn gather(
    var: impl Fn(&str) -> Option<String>,
    read: impl Fn(&str) -> Option<String>,
) -> Result<Gathered, String> {
    let target_os = var("CARGO_CFG_TARGET_OS").ok_or("CARGO_CFG_TARGET_OS is not set")?;
    let platform_file = format!("tauri.{target_os}.conf.json");
    Ok(Gathered {
        release: var("PROFILE").as_deref() == Some("release"),
        config: read("tauri.conf.json").ok_or("cannot read tauri.conf.json")?,
        platform: read(&platform_file),
        platform_file,
        overlay: var("TAURI_CONFIG").filter(|value| !value.trim().is_empty()),
        dev_allow_http: var(DEV_ALLOW_HTTP).is_some_and(|value| !value.is_empty()),
    })
}

/// What the build script knows about the build.
#[derive(Debug, Clone, Copy)]
pub struct Inputs<'a> {
    /// Cargo `PROFILE` is `release`.
    pub release: bool,
    /// Contents of `tauri.conf.json`.
    pub config: &'a str,
    /// Contents of `tauri.<os>.conf.json`, when there is one.
    pub platform: Option<&'a str>,
    /// `TAURI_CONFIG`, when set and not blank.
    pub overlay: Option<&'a str>,
    /// `KEYSTONE_DEV_ALLOW_HTTP` is set and not blank.
    pub dev_allow_http: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Ok,
    /// Build goes on; the text is printed as a cargo warning.
    Warn(String),
}

/// `Err` means the build must stop, with that text.
pub fn check(inputs: &Inputs<'_>) -> Result<Verdict, String> {
    let config = effective_config(inputs)?;
    let problem = policy_problem(&config).or_else(|| window_problem(&config));

    if inputs.release {
        if inputs.dev_allow_http {
            return Err(format!(
                "release build refused: {DEV_ALLOW_HTTP} is set; plain http is a debug-only \
                 development switch"
            ));
        }
        return match problem {
            Some(problem) => Err(format!("release build refused: {problem}")),
            None => Ok(Verdict::Ok),
        };
    }

    Ok(match problem {
        Some(problem) => Verdict::Warn(format!(
            "this bundled debug build is not locked ({problem}); do not distribute it"
        )),
        None => Verdict::Ok,
    })
}

/// The configuration `tauri-build` ends up with.
pub fn effective_config(inputs: &Inputs<'_>) -> Result<Value, String> {
    let mut config: Value = serde_json::from_str(inputs.config)
        .map_err(|e| format!("tauri.conf.json is not JSON: {e}"))?;
    if let Some(platform) = inputs.platform {
        let platform: Value = serde_json::from_str(platform)
            .map_err(|e| format!("the platform config is not JSON: {e}"))?;
        merge(&mut config, &platform);
    }
    if let Some(overlay) = inputs.overlay {
        let overlay: Value =
            serde_json::from_str(overlay).map_err(|e| format!("TAURI_CONFIG is not JSON: {e}"))?;
        merge(&mut config, &overlay);
    }
    Ok(config)
}

/// JSON merge patch (RFC 7386), what `json_patch::merge` does in `tauri-build`.
fn merge(target: &mut Value, patch: &Value) {
    let Value::Object(fields) = patch else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = Value::Object(serde_json::Map::new());
    }
    let Value::Object(object) = target else {
        return;
    };
    for (name, value) in fields {
        if value.is_null() {
            object.remove(name);
        } else {
            merge(object.entry(name.clone()).or_insert(Value::Null), value);
        }
    }
}

fn policy_problem(config: &Value) -> Option<String> {
    let Some(csp) = csp_of(config) else {
        return Some("no app.security.csp is configured".into());
    };
    if csp.contains(PLACEHOLDER_MARKER) {
        return Some(format!(
            "the Content-Security-Policy is the placeholder ({PLACEHOLDER_MARKER})"
        ));
    }
    let rewrite = config
        .pointer("/app/security/dangerousDisableAssetCspModification")
        .unwrap_or(&Value::Bool(false));
    if rewrite != &Value::Bool(false) {
        return Some(
            "dangerousDisableAssetCspModification is set; the bundled scripts need the hashes \
             Tauri adds to the policy"
                .into(),
        );
    }
    connect_problem(&csp).or_else(|| source_problem(&csp))
}

/// The navigation lock sits on the main window only, which the app builds
/// itself (`create: false`). So `app.windows` holds that window and nothing
/// else, and it loads an app path, not a URL.
fn window_problem(config: &Value) -> Option<String> {
    let windows = config
        .pointer("/app/windows")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    if windows.is_empty() {
        return Some("app.windows has no main window".into());
    }
    for window in windows {
        // Tauri's default label is `main`.
        let label = window
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or(MAIN_WINDOW_LABEL);
        if label != MAIN_WINDOW_LABEL {
            return Some(format!(
                "app.windows has a window `{label}`; only the main window carries the \
                 navigation lock"
            ));
        }
        if window.get("create") != Some(&Value::Bool(false)) {
            return Some(
                "the main window needs `create: false`; the app builds it with the navigation \
                 lock"
                    .into(),
            );
        }
        if let Some(url) = window.get("url").and_then(Value::as_str)
            && url.contains(':')
        {
            return Some(format!(
                "the main window loads {url}; only an app path is allowed"
            ));
        }
    }
    if windows.len() > 1 {
        return Some("app.windows holds the main window more than once".into());
    }
    None
}

/// Directives scripts can come from: no inline, eval, `data:` or `blob:`
/// there. `default-src` is the fallback of the others.
const SCRIPT_DIRECTIVES: [&str; 5] = [
    "default-src",
    "script-src",
    "script-src-elem",
    "script-src-attr",
    "worker-src",
];

/// Directives whose values are tokens, not sources.
const TOKEN_DIRECTIVES: [&str; 2] = ["sandbox", "trusted-types"];

/// Outside `connect-src` (see [`connect_problem`]) a source is `'self'`,
/// `'none'`, a hash, a nonce, `data:`, `blob:` or another keyword: nothing
/// that names a scheme or a host, so no directive loads from the network.
/// Report endpoints would send violation reports off the device.
fn source_problem(csp: &str) -> Option<String> {
    for directive in csp.split(';') {
        let mut words = directive.split_whitespace();
        let Some(name) = words.next() else {
            continue;
        };
        let name = name.to_ascii_lowercase();
        if name == "connect-src" || TOKEN_DIRECTIVES.contains(&name.as_str()) {
            continue;
        }
        if name == "report-uri" || name == "report-to" {
            return Some(format!("{name} sends violation reports off the device"));
        }
        let script = SCRIPT_DIRECTIVES.contains(&name.as_str());
        for source in words.map(str::to_ascii_lowercase) {
            let local = match source.as_str() {
                "'self'" | "'none'" => true,
                "data:" | "blob:" => !script,
                hash if ["'sha256-", "'sha384-", "'sha512-", "'nonce-"]
                    .iter()
                    .any(|prefix| hash.starts_with(prefix)) =>
                {
                    true
                }
                keyword if keyword.starts_with('\'') => !script,
                _ => false,
            };
            if !local {
                return Some(format!(
                    "{name} allows {source}; the webview loads nothing from the network and \
                     runs no inline or generated script"
                ));
            }
        }
    }
    None
}

/// Every `connect-src` directive counts, in any case: the browser would use
/// the first, a later one is a mistake to surface as well.
fn connect_problem(csp: &str) -> Option<String> {
    let sources: Vec<String> = csp
        .split(';')
        .filter_map(|directive| {
            let mut words = directive.split_whitespace();
            let name = words.next()?;
            name.eq_ignore_ascii_case("connect-src")
                .then(|| words.map(str::to_ascii_lowercase))
        })
        .flatten()
        .collect();
    if let Some(extra) = sources
        .iter()
        .find(|source| !CONNECT_SOURCES.contains(&source.as_str()))
    {
        return Some(format!(
            "connect-src allows {extra}; the webview reaches the network only through commands"
        ));
    }
    CONNECT_SOURCES
        .iter()
        .find(|source| !sources.iter().any(|have| have == *source))
        .map(|missing| format!("connect-src lacks {missing}; the IPC needs it"))
}

/// `app.security.csp` as one policy text.
pub fn csp_of(config: &Value) -> Option<String> {
    config.pointer("/app/security/csp").and_then(csp_text)
}

/// A policy is a string, or a map of directive to sources (string or list).
fn csp_text(csp: &Value) -> Option<String> {
    match csp {
        Value::String(text) => Some(text.clone()),
        Value::Object(directives) => Some(
            directives
                .iter()
                .map(|(name, sources)| match sources {
                    Value::Array(list) => {
                        let list: Vec<&str> = list.iter().filter_map(Value::as_str).collect();
                        format!("{name} {}", list.join(" "))
                    }
                    Value::String(text) => format!("{name} {text}"),
                    _ => name.clone(),
                })
                .collect::<Vec<_>>()
                .join("; "),
        ),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHIPPED: &str = include_str!("../tauri.conf.json");
    const LOCKED: &str = r#"{"app":{"security":{"csp":"default-src 'self'; connect-src ipc: http://ipc.localhost"}}}"#;
    const PLACEHOLDER: &str =
        r#"{"app":{"security":{"csp":"default-src 'none'; keystone-placeholder-csp 'none'"}}}"#;

    fn inputs(release: bool, overlay: Option<&'static str>) -> Inputs<'static> {
        Inputs {
            release,
            config: SHIPPED,
            platform: None,
            overlay,
            dev_allow_http: false,
        }
    }

    /// A release build with `sources` as its `connect-src`.
    fn release_with_connect(sources: &str) -> Result<Verdict, String> {
        let csp = format!("default-src 'self'; connect-src {sources}");
        let overlay = serde_json::json!({ "app": { "security": { "csp": csp } } }).to_string();
        check(&Inputs {
            overlay: Some(&overlay),
            ..inputs(true, None)
        })
    }

    fn directives(csp: &str) -> Vec<(String, Vec<String>)> {
        csp.split(';')
            .filter_map(|directive| {
                let mut words = directive.split_whitespace();
                let name = words.next()?.to_owned();
                Some((name, words.map(str::to_owned).collect()))
            })
            .collect()
    }

    #[test]
    fn shipped_config_is_the_locked_policy() {
        let config = effective_config(&inputs(true, None)).unwrap();
        let csp = csp_of(&config).expect("csp is set");
        assert!(!csp.contains(PLACEHOLDER_MARKER), "{csp}");
        let expected: Vec<(String, Vec<String>)> = [
            ("default-src", vec!["'self'"]),
            ("connect-src", vec!["ipc:", "http://ipc.localhost"]),
            ("img-src", vec!["'self'", "data:", "blob:"]),
            ("font-src", vec!["'self'", "data:"]),
            ("style-src", vec!["'self'"]),
            ("script-src", vec!["'self'"]),
            ("object-src", vec!["'none'"]),
            ("frame-ancestors", vec!["'none'"]),
            ("form-action", vec!["'none'"]),
            ("base-uri", vec!["'self'"]),
        ]
        .into_iter()
        .map(|(name, sources)| {
            (
                name.to_owned(),
                sources.into_iter().map(str::to_owned).collect(),
            )
        })
        .collect();
        assert_eq!(directives(&csp), expected);
    }

    /// A release build whose overlay adds `directive` to the locked policy.
    fn release_with(directive: &str) -> Result<Verdict, String> {
        let csp = format!("default-src 'self'; connect-src ipc: http://ipc.localhost; {directive}");
        let overlay = serde_json::json!({ "app": { "security": { "csp": csp } } }).to_string();
        check(&Inputs {
            overlay: Some(&overlay),
            ..inputs(true, None)
        })
    }

    #[test]
    fn release_with_remote_sources_anywhere_is_refused() {
        for (directive, source) in [
            ("default-src 'self' https:", "https:"),
            ("img-src 'self' https:", "https:"),
            (
                "img-src https://images.example.com",
                "https://images.example.com",
            ),
            ("media-src *", "*"),
            ("frame-src https://example.com", "https://example.com"),
            ("object-src example.com", "example.com"),
            (
                "style-src 'self' https://fonts.example.com",
                "https://fonts.example.com",
            ),
            ("font-src http:", "http:"),
            ("worker-src wss:", "wss:"),
            ("Img-Src HTTPS:", "https:"),
            ("form-action https://evil.example", "https://evil.example"),
            ("base-uri https://evil.example", "https://evil.example"),
            ("img-src ipc:", "ipc:"),
            ("img-src http://ipc.localhost", "http://ipc.localhost"),
        ] {
            let error = release_with(directive).expect_err(directive);
            assert!(error.contains(source), "{directive}: {error}");
        }
    }

    #[test]
    fn release_with_unsafe_script_sources_is_refused() {
        for (directive, source) in [
            ("script-src 'self' 'unsafe-inline'", "'unsafe-inline'"),
            ("script-src 'self' 'unsafe-eval'", "'unsafe-eval'"),
            ("script-src 'self' 'unsafe-hashes'", "'unsafe-hashes'"),
            ("script-src 'self' 'wasm-unsafe-eval'", "'wasm-unsafe-eval'"),
            ("script-src 'self' data:", "data:"),
            ("script-src 'self' blob:", "blob:"),
            (
                "script-src https://cdn.example.com",
                "https://cdn.example.com",
            ),
            ("script-src *", "*"),
            ("script-src-elem 'unsafe-inline'", "'unsafe-inline'"),
            ("script-src-attr 'unsafe-inline'", "'unsafe-inline'"),
            ("worker-src blob:", "blob:"),
            ("default-src 'unsafe-eval'", "'unsafe-eval'"),
        ] {
            let error = release_with(directive).expect_err(directive);
            assert!(error.contains(source), "{directive}: {error}");
        }
    }

    #[test]
    fn release_with_a_report_endpoint_is_refused() {
        for directive in [
            "report-uri https://csp.example.com",
            "report-to csp-endpoint",
        ] {
            let error = release_with(directive).expect_err(directive);
            assert!(error.contains("violation reports"), "{directive}: {error}");
        }
    }

    #[test]
    fn local_sources_stay_allowed() {
        for directive in [
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "media-src 'self' blob:",
            "style-src 'self'",
            "style-src-attr 'unsafe-inline'",
            "script-src 'self' 'sha256-tA8NLZ7sfk4Jr/izBVduKXeZBybtCT1klC9bh3Zu2Fo='",
            "script-src 'self' 'nonce-abc123'",
            "base-uri 'self'",
            "object-src 'none'",
            "frame-ancestors 'none'",
            "upgrade-insecure-requests",
        ] {
            assert_eq!(release_with(directive), Ok(Verdict::Ok), "{directive}");
        }
    }

    /// `gather` over a fake environment and file system.
    fn gathered(env: &[(&str, &str)], files: &[(&str, &str)]) -> Result<Gathered, String> {
        let env: Vec<(String, String)> = env
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        let files: Vec<(String, String)> = files
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        gather(
            |name| env.iter().find(|(k, _)| k == name).map(|(_, v)| v.clone()),
            |path| {
                files
                    .iter()
                    .find(|(k, _)| k == path)
                    .map(|(_, v)| v.clone())
            },
        )
    }

    const LOOSE: &str =
        r#"{"app":{"security":{"csp":"connect-src ipc: http://ipc.localhost https:"}}}"#;

    #[test]
    fn the_dev_http_switch_reaches_the_check() {
        let release = [("PROFILE", "release"), ("CARGO_CFG_TARGET_OS", "windows")];
        for value in ["1", "0", "yes"] {
            let env = [release[0], release[1], (DEV_ALLOW_HTTP, value)];
            let g = gathered(&env, &[("tauri.conf.json", SHIPPED)]).unwrap();
            assert!(g.dev_allow_http, "{value}");
            assert!(check(&g.inputs()).unwrap_err().contains(DEV_ALLOW_HTTP));
        }
        let unset = gathered(&release, &[("tauri.conf.json", SHIPPED)]).unwrap();
        assert!(!unset.dev_allow_http);
        assert_eq!(check(&unset.inputs()), Ok(Verdict::Ok));
        let empty = [release[0], release[1], (DEV_ALLOW_HTTP, "")];
        assert!(
            !gathered(&empty, &[("tauri.conf.json", SHIPPED)])
                .unwrap()
                .dev_allow_http
        );
    }

    #[test]
    fn the_platform_file_of_the_target_reaches_the_check() {
        let files = [
            ("tauri.conf.json", SHIPPED),
            ("tauri.windows.conf.json", LOOSE),
        ];
        let windows = gathered(
            &[("PROFILE", "release"), ("CARGO_CFG_TARGET_OS", "windows")],
            &files,
        )
        .unwrap();
        assert_eq!(windows.platform_file, "tauri.windows.conf.json");
        assert_eq!(windows.platform.as_deref(), Some(LOOSE));
        assert!(check(&windows.inputs()).unwrap_err().contains("https:"));

        let linux = gathered(
            &[("PROFILE", "release"), ("CARGO_CFG_TARGET_OS", "linux")],
            &files,
        )
        .unwrap();
        assert_eq!(linux.platform_file, "tauri.linux.conf.json");
        assert_eq!(linux.platform, None);
        assert_eq!(check(&linux.inputs()), Ok(Verdict::Ok));
    }

    #[test]
    fn profile_and_overlay_are_read() {
        let files = [("tauri.conf.json", SHIPPED)];
        let debug = gathered(
            &[("PROFILE", "debug"), ("CARGO_CFG_TARGET_OS", "linux")],
            &files,
        )
        .unwrap();
        assert!(!debug.release);
        let release = gathered(
            &[
                ("PROFILE", "release"),
                ("CARGO_CFG_TARGET_OS", "linux"),
                ("TAURI_CONFIG", LOOSE),
            ],
            &files,
        )
        .unwrap();
        assert!(release.release);
        assert!(check(&release.inputs()).unwrap_err().contains("https:"));
        let blank = gathered(
            &[("CARGO_CFG_TARGET_OS", "linux"), ("TAURI_CONFIG", "  ")],
            &files,
        )
        .unwrap();
        assert_eq!(blank.overlay, None);
        assert!(gathered(&[("CARGO_CFG_TARGET_OS", "linux")], &[]).is_err());
    }

    #[test]
    fn the_window_label_is_the_crate_one() {
        assert_eq!(MAIN_WINDOW_LABEL, crate::MAIN_WINDOW);
    }

    /// A release build whose overlay sets `app.windows` (an array: merge
    /// patch replaces it whole).
    fn release_with_windows(windows: &str) -> Result<Verdict, String> {
        let overlay = format!(r#"{{"app":{{"windows":{windows}}}}}"#);
        check(&Inputs {
            overlay: Some(&overlay),
            ..inputs(true, None)
        })
    }

    #[test]
    fn release_with_a_window_outside_the_lock_is_refused() {
        for (windows, expected) in [
            (
                r#"[{"label":"main","create":false},{"label":"popup","url":"https://evil.example"}]"#,
                "popup",
            ),
            (r#"[{"label":"other","create":false}]"#, "other"),
            // No label is Tauri's `main`, built by Tauri itself without `create`.
            (r#"[{}]"#, "create"),
            (r#"[{"label":"main"}]"#, "create"),
            (r#"[{"label":"main","create":true}]"#, "create"),
            (
                r#"[{"label":"main","create":false,"url":"https://evil.example"}]"#,
                "https://evil.example",
            ),
            (
                r#"[{"label":"main","create":false,"url":"data:text/html,x"}]"#,
                "data:text/html,x",
            ),
            (r#"[]"#, "main window"),
            (
                r#"[{"label":"main","create":false},{"label":"main","create":false}]"#,
                "more than once",
            ),
        ] {
            let error = release_with_windows(windows).expect_err(windows);
            assert!(error.contains(expected), "{windows}: {error}");
        }
        let no_windows = check(&Inputs {
            config: r#"{"app":{"security":{"csp":"default-src 'self'; connect-src ipc: http://ipc.localhost"}}}"#,
            ..inputs(true, None)
        });
        assert!(no_windows.unwrap_err().contains("main window"));
    }

    #[test]
    fn the_main_window_with_an_app_path_passes() {
        assert_eq!(
            release_with_windows(r#"[{"label":"main","create":false,"url":"index.html"}]"#),
            Ok(Verdict::Ok)
        );
        assert_eq!(
            release_with_windows(r#"[{"label":"main","create":false,"title":"Keystone"}]"#),
            Ok(Verdict::Ok)
        );
    }

    #[test]
    fn release_of_the_shipped_config_passes() {
        assert_eq!(check(&inputs(true, None)), Ok(Verdict::Ok));
    }

    #[test]
    fn release_with_the_placeholder_is_refused() {
        let error = check(&inputs(true, Some(PLACEHOLDER))).unwrap_err();
        assert!(error.contains("placeholder"), "{error}");
        let base = Inputs {
            config: PLACEHOLDER,
            ..inputs(true, None)
        };
        assert!(check(&base).unwrap_err().contains("placeholder"));
    }

    #[test]
    fn release_with_an_overlay_that_keeps_a_base_placeholder_is_refused() {
        let error = check(&Inputs {
            config: PLACEHOLDER,
            ..inputs(true, Some(r#"{"productName":"Keystone"}"#))
        })
        .unwrap_err();
        assert!(error.contains("placeholder"), "{error}");
    }

    #[test]
    fn release_with_a_locked_policy_overlay_passes() {
        assert_eq!(check(&inputs(true, Some(LOCKED))), Ok(Verdict::Ok));
    }

    #[test]
    fn release_without_any_policy_is_refused() {
        let blank = Inputs {
            config: r#"{"app":{"security":{}}}"#,
            ..inputs(true, None)
        };
        assert!(check(&blank).unwrap_err().contains("no app.security.csp"));
        let nulled = inputs(true, Some(r#"{"app":{"security":{"csp":null}}}"#));
        assert!(check(&nulled).unwrap_err().contains("no app.security.csp"));
    }

    #[test]
    fn release_with_network_sources_in_connect_src_is_refused() {
        for source in [
            "http:",
            "https:",
            "ws:",
            "wss:",
            "HTTPS:",
            "https://example.com",
            "http://example.com",
            "ws://localhost:1420",
            "wss://reverb.example.com",
            "http://ipc.localhost.example.com",
            "*",
            "example.com",
            "'self'",
        ] {
            let error = release_with_connect(&format!("ipc: http://ipc.localhost {source}"))
                .expect_err(source);
            assert!(error.contains("connect-src"), "{source}: {error}");
            assert!(
                error
                    .to_ascii_lowercase()
                    .contains(&source.to_ascii_lowercase()),
                "{source}: {error}"
            );
        }
    }

    #[test]
    fn release_needs_both_ipc_sources() {
        for sources in ["ipc:", "http://ipc.localhost", "'none'", ""] {
            let error = release_with_connect(sources).expect_err(sources);
            assert!(error.contains("connect-src"), "{sources}: {error}");
        }
        let error = check(&inputs(
            true,
            Some(r#"{"app":{"security":{"csp":"default-src 'self'"}}}"#),
        ))
        .unwrap_err();
        assert!(error.contains("connect-src"), "{error}");
    }

    #[test]
    fn every_spelling_of_connect_src_counts() {
        let upper = inputs(
            true,
            Some(r#"{"app":{"security":{"csp":"CONNECT-SRC ipc: http://ipc.localhost https:"}}}"#),
        );
        assert!(check(&upper).unwrap_err().contains("https:"));
        // Scheme and host are not case sensitive in a policy.
        let shouted = inputs(
            true,
            Some(r#"{"app":{"security":{"csp":"CONNECT-SRC IPC: HTTP://IPC.LOCALHOST"}}}"#),
        );
        assert_eq!(check(&shouted), Ok(Verdict::Ok));
        let twice = inputs(
            true,
            Some(
                r#"{"app":{"security":{"csp":"connect-src ipc: http://ipc.localhost; connect-src wss:"}}}"#,
            ),
        );
        assert!(check(&twice).unwrap_err().contains("wss:"));
        let map = inputs(
            true,
            Some(
                r#"{"app":{"security":{"csp":{"connect-src":["ipc:","http://ipc.localhost","ws:"]}}}}"#,
            ),
        );
        assert!(check(&map).unwrap_err().contains("ws:"));
    }

    #[test]
    fn a_platform_file_counts_and_an_overlay_wins_over_it() {
        let loose =
            r#"{"app":{"security":{"csp":"connect-src ipc: http://ipc.localhost https:"}}}"#;
        let platform = Inputs {
            platform: Some(loose),
            ..inputs(true, None)
        };
        assert!(check(&platform).unwrap_err().contains("https:"));
        assert_eq!(
            check(&Inputs {
                overlay: Some(LOCKED),
                ..platform
            }),
            Ok(Verdict::Ok)
        );
    }

    #[test]
    fn config_files_merge_as_tauri_build_merges_them() {
        let base = r#"{"app":{"security":{"csp":{"default-src":"'self'","connect-src":["ipc:","http://ipc.localhost"]}}}}"#;
        let adds = r#"{"app":{"security":{"csp":{"img-src":"https:"}}}}"#;
        let merged = effective_config(&Inputs {
            config: base,
            platform: Some(adds),
            overlay: Some(r#"{"app":{"security":{"csp":{"default-src":null}}}}"#),
            ..inputs(true, None)
        })
        .unwrap();
        let csp = csp_of(&merged).unwrap();
        assert!(csp.contains("connect-src ipc:"), "{csp}");
        assert!(csp.contains("img-src https:"), "{csp}");
        assert!(!csp.contains("default-src"), "{csp}");
    }

    #[test]
    fn release_that_turns_off_the_asset_csp_rewrite_is_refused() {
        for value in ["true", r#"["script-src"]"#] {
            let overlay = format!(
                r#"{{"app":{{"security":{{"dangerousDisableAssetCspModification":{value}}}}}}}"#
            );
            let error = check(&Inputs {
                overlay: Some(&overlay),
                ..inputs(true, None)
            })
            .unwrap_err();
            assert!(
                error.contains("dangerousDisableAssetCspModification"),
                "{error}"
            );
        }
    }

    #[test]
    fn release_with_dev_http_switch_is_refused() {
        let error = check(&Inputs {
            dev_allow_http: true,
            ..inputs(true, Some(LOCKED))
        })
        .unwrap_err();
        assert!(error.contains(DEV_ALLOW_HTTP), "{error}");
    }

    #[test]
    fn debug_builds_only_warn() {
        assert_eq!(check(&inputs(false, None)), Ok(Verdict::Ok));
        assert!(matches!(
            check(&inputs(false, Some(PLACEHOLDER))),
            Ok(Verdict::Warn(_))
        ));
        let open = inputs(
            false,
            Some(r#"{"app":{"security":{"csp":"connect-src https:"}}}"#),
        );
        assert!(matches!(check(&open), Ok(Verdict::Warn(_))));
        let dev_http = Inputs {
            dev_allow_http: true,
            ..inputs(false, Some(LOCKED))
        };
        assert_eq!(check(&dev_http), Ok(Verdict::Ok));
    }

    #[test]
    fn unreadable_config_stops_the_build() {
        assert!(
            check(&inputs(true, Some("not json")))
                .unwrap_err()
                .contains("TAURI_CONFIG")
        );
        let platform = Inputs {
            platform: Some("not json"),
            ..inputs(false, None)
        };
        assert!(check(&platform).unwrap_err().contains("platform config"));
    }

    #[test]
    fn directive_map_policies_are_read() {
        let overlay = r#"{"app":{"security":{"csp":{"default-src":"'self'","connect-src":["ipc:","http://ipc.localhost"]}}}}"#;
        let csp = csp_of(&effective_config(&inputs(true, Some(overlay))).unwrap()).unwrap();
        assert!(
            csp.contains("connect-src ipc: http://ipc.localhost"),
            "{csp}"
        );
        assert_eq!(check(&inputs(true, Some(overlay))), Ok(Verdict::Ok));
    }
}
