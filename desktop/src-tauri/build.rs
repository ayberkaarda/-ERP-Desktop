// Release-build guard (see src/build_guard.rs), then the usual Tauri build.
#[path = "src/build_guard.rs"]
mod build_guard;

use std::env;

fn main() {
    println!("cargo:rerun-if-changed=src/build_guard.rs");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rerun-if-env-changed={}", build_guard::DEV_ALLOW_HTTP);

    let config = std::fs::read_to_string("tauri.conf.json").expect("read tauri.conf.json");
    let overlay = env::var("TAURI_CONFIG")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let dev_allow_http =
        env::var_os(build_guard::DEV_ALLOW_HTTP).is_some_and(|value| !value.is_empty());
    let inputs = build_guard::Inputs {
        // `PROFILE` is `release` for release-like profiles, `debug` otherwise.
        release: env::var("PROFILE").as_deref() == Ok("release"),
        config: &config,
        overlay: overlay.as_deref(),
        dev_allow_http,
    };

    match build_guard::check(&inputs) {
        Ok(build_guard::Verdict::Ok) => {}
        // Only bundled builds load the policy; plain cargo check/test stay quiet.
        Ok(build_guard::Verdict::Warn(text)) => {
            if env::var_os("CARGO_FEATURE_CUSTOM_PROTOCOL").is_some() {
                println!("cargo:warning={text}");
            }
        }
        Err(text) => panic!("\n\n{text}\n"),
    }

    tauri_build::build();
}
