//! Build input checks, shared by `build.rs` (which acts on them) and the
//! crate's tests (which pin them). Std and `serde_json` only: this file is
//! compiled into the build script too.
//!
//! `tauri.conf.json` carries the locked Content-Security-Policy. A release
//! build stops when the effective policy is not locked: no policy, the
//! deny-all placeholder, or a `connect-src` that reaches anything but the
//! IPC. The webview talks to the outside world through commands only. A
//! release build with the development HTTP switch set stops as well.
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
    let problem = policy_problem(&config);

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
    connect_problem(&csp)
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
