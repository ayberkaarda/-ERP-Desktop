// Release-build guard (see src/build_guard.rs), then the usual Tauri build.
#[path = "src/build_guard.rs"]
mod build_guard;

use std::env;

fn main() {
    println!("cargo:rerun-if-changed=src/build_guard.rs");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    println!("cargo:rerun-if-env-changed=TAURI_CONFIG");
    println!("cargo:rerun-if-env-changed={}", build_guard::DEV_ALLOW_HTTP);

    let gathered = build_guard::gather(
        |name| env::var_os(name).map(|value| value.to_string_lossy().into_owned()),
        |path| std::fs::read_to_string(path).ok(),
    )
    .unwrap_or_else(|text| panic!("\n\n{text}\n"));
    // A path that does not exist would rerun this script on every build, so
    // only a present platform file is watched.
    if gathered.platform.is_some() {
        println!("cargo:rerun-if-changed={}", gathered.platform_file);
    }

    match build_guard::check(&gathered.inputs()) {
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
