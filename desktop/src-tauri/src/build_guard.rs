//! Build input checks, shared by `build.rs` (which acts on them) and the
//! crate's tests (which pin them). Std and `serde_json` only: this file is
//! compiled into the build script too.
//!
//! `tauri.conf.json` ships a placeholder Content-Security-Policy that denies
//! every source. The real policy is passed as a CLI config overlay
//! (`tauri build --config ...`), which the CLI hands to the build script as
//! `TAURI_CONFIG`. A release build whose effective policy is still the
//! placeholder would package a window that loads nothing, so it is refused;
//! so is a release build with the development HTTP switch set.

use serde_json::Value;

/// Token carried by the placeholder policy and by nothing else.
pub const PLACEHOLDER_MARKER: &str = "keystone-placeholder-csp";

/// Development switch that lets a debug build talk to `http://localhost`.
pub const DEV_ALLOW_HTTP: &str = "KEYSTONE_DEV_ALLOW_HTTP";

/// What the build script knows about the build.
#[derive(Debug, Clone, Copy)]
pub struct Inputs<'a> {
    /// Cargo `PROFILE` is `release`.
    pub release: bool,
    /// Contents of `tauri.conf.json`.
    pub config: &'a str,
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
    let csp = effective_csp(inputs.config, inputs.overlay)?;
    let placeholder = csp
        .as_deref()
        .is_none_or(|csp| csp.contains(PLACEHOLDER_MARKER));

    if inputs.release {
        if inputs.dev_allow_http {
            return Err(format!(
                "release build refused: {DEV_ALLOW_HTTP} is set; plain http is a debug-only \
                 development switch"
            ));
        }
        return match csp {
            None => Err("release build refused: no app.security.csp is configured".into()),
            Some(_) if placeholder => Err(format!(
                "release build refused: the Content-Security-Policy is still the \
                 placeholder in tauri.conf.json ({PLACEHOLDER_MARKER}); pass the real policy \
                 with `tauri build --config`"
            )),
            Some(_) => Ok(Verdict::Ok),
        };
    }

    if placeholder {
        return Ok(Verdict::Warn(
            "the bundled frontend runs under the placeholder Content-Security-Policy \
             (it denies every source); `tauri dev` uses app.security.devCsp"
                .into(),
        ));
    }
    Ok(Verdict::Ok)
}

/// `app.security.csp` of the overlay when it names one, else of the base
/// config. `None` when neither sets a policy.
pub fn effective_csp(config: &str, overlay: Option<&str>) -> Result<Option<String>, String> {
    if let Some(overlay) = overlay {
        let overlay: Value =
            serde_json::from_str(overlay).map_err(|e| format!("TAURI_CONFIG is not JSON: {e}"))?;
        if let Some(csp) = csp_field(&overlay) {
            return Ok(csp_text(csp));
        }
    }
    let config: Value =
        serde_json::from_str(config).map_err(|e| format!("tauri.conf.json is not JSON: {e}"))?;
    Ok(csp_field(&config).and_then(csp_text))
}

fn csp_field(config: &Value) -> Option<&Value> {
    config.get("app")?.get("security")?.get("csp")
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
    const REAL: &str = r#"{"app":{"security":{"csp":"default-src 'self'; connect-src ipc: http://ipc.localhost"}}}"#;

    fn inputs(release: bool, overlay: Option<&'static str>) -> Inputs<'static> {
        Inputs {
            release,
            config: SHIPPED,
            overlay,
            dev_allow_http: false,
        }
    }

    #[test]
    fn shipped_config_carries_a_deny_all_placeholder() {
        let csp = effective_csp(SHIPPED, None).unwrap().expect("csp is set");
        assert!(csp.contains(PLACEHOLDER_MARKER), "{csp}");
        for directive in csp.split(';').map(str::trim).filter(|d| !d.is_empty()) {
            let (name, sources) = directive.split_once(' ').unwrap_or((directive, ""));
            if name == PLACEHOLDER_MARKER {
                continue;
            }
            assert_eq!(sources.trim(), "'none'", "{name} allows {sources}");
        }
        for name in [
            "default-src",
            "script-src",
            "connect-src",
            "frame-ancestors",
        ] {
            assert!(
                csp.contains(&format!("{name} 'none'")),
                "{name} missing: {csp}"
            );
        }
    }

    #[test]
    fn release_with_the_placeholder_is_refused() {
        let error = check(&inputs(true, None)).unwrap_err();
        assert!(error.contains("placeholder"), "{error}");
    }

    #[test]
    fn release_with_an_overlay_that_keeps_the_placeholder_is_refused() {
        let error = check(&inputs(true, Some(r#"{"productName":"Keystone"}"#))).unwrap_err();
        assert!(error.contains("placeholder"), "{error}");
    }

    #[test]
    fn release_with_a_real_policy_overlay_passes() {
        assert_eq!(check(&inputs(true, Some(REAL))), Ok(Verdict::Ok));
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
    fn release_with_dev_http_switch_is_refused() {
        let error = check(&Inputs {
            dev_allow_http: true,
            ..inputs(true, Some(REAL))
        })
        .unwrap_err();
        assert!(error.contains(DEV_ALLOW_HTTP), "{error}");
    }

    #[test]
    fn debug_with_the_placeholder_only_warns() {
        assert!(matches!(check(&inputs(false, None)), Ok(Verdict::Warn(_))));
        let dev_http = Inputs {
            dev_allow_http: true,
            ..inputs(false, Some(REAL))
        };
        assert_eq!(check(&dev_http), Ok(Verdict::Ok));
    }

    #[test]
    fn unreadable_overlay_stops_the_build() {
        assert!(
            check(&inputs(true, Some("not json")))
                .unwrap_err()
                .contains("TAURI_CONFIG")
        );
    }

    #[test]
    fn directive_map_policies_are_read() {
        let overlay = r#"{"app":{"security":{"csp":{"default-src":"'self'","connect-src":["ipc:","http://ipc.localhost"]}}}}"#;
        let csp = effective_csp(SHIPPED, Some(overlay)).unwrap().unwrap();
        assert!(
            csp.contains("connect-src ipc: http://ipc.localhost"),
            "{csp}"
        );
        assert_eq!(check(&inputs(true, Some(overlay))), Ok(Verdict::Ok));
    }
}
