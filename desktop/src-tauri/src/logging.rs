//! Log plugin setup: level per build and a format that masks personal data
//! and credentials before any target (stdout, log file) sees a line.
//!
//! The plugin's own default is `Trace` with the message passed through as
//! is. Here release logs `Info` and up, debug `Debug` and up, and every
//! record goes through [`masking_format`]: the one place masking happens, so
//! no call site (or dependency) can forget it.

use std::fmt::Arguments;
use std::sync::LazyLock;

use log::{LevelFilter, Record};
use regex::Regex;
use time::OffsetDateTime;
use time::macros::format_description;

/// `Debug` in a debug build, `Info` in a release build.
pub fn level_for_build() -> LevelFilter {
    if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    }
}

/// The log plugin as the shell registers it.
pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .level(level_for_build())
        .format(masking_format)
        .build()
}

static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}").expect("email regex")
});

/// E.164 with a mandatory `+`: bare digit runs (counts, cursors, ids) stay.
static PHONE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\+[1-9]\d{7,14}").expect("phone regex"));

/// `Authorization: Bearer <token>` and any `bearer <token>` text.
static BEARER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bbearer\s+[A-Za-z0-9._~+/|=-]+").expect("bearer regex"));

/// Secret fields of a JSON body or a debug dump: `"access_token": "..."`,
/// `password: "..."`.
static SECRET_FIELD: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)("?(?:access_token|refresh_token|token|password|two_factor_code|secret)"?\s*[:=]\s*)"[^"]*""#,
    )
    .expect("secret field regex")
});

const TIME_FORMAT: &[time::format_description::FormatItem<'_>] =
    format_description!("[[[year]-[month]-[day]][[[hour]:[minute]:[second]]");

/// Fixed placeholders, so the length of the original value is not kept.
pub fn mask(text: &str) -> String {
    let text = SECRET_FIELD.replace_all(text, r#"$1"[redacted]""#);
    let text = BEARER.replace_all(&text, "Bearer [token]");
    let text = EMAIL.replace_all(&text, "[email]");
    PHONE.replace_all(&text, "[phone]").into_owned()
}

/// `Builder::format` callback: timestamp, target, level, masked message.
pub fn masking_format(out: fern::FormatCallback<'_>, message: &Arguments<'_>, record: &Record<'_>) {
    let masked = mask(&message.to_string());
    let timestamp = OffsetDateTime::now_utc()
        .format(TIME_FORMAT)
        .unwrap_or_default();
    out.finish(format_args!(
        "{timestamp}[{}][{}] {masked}",
        record.target(),
        record.level()
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::{Arc, Mutex};

    #[test]
    fn masks_email_phone_bearer_and_secret_fields() {
        let line = r#"login ayse@example.com.tr +905551234567 Authorization: Bearer 12|abcDEF.ghi body {"access_token":"tok-1","refresh_token": "tok-2","password":"hunter2"}"#;
        let masked = mask(line);
        for secret in [
            "ayse@example.com.tr",
            "+905551234567",
            "abcDEF",
            "tok-1",
            "tok-2",
            "hunter2",
        ] {
            assert!(!masked.contains(secret), "{secret} leaked: {masked}");
        }
        for placeholder in [
            "[email]",
            "[phone]",
            "Bearer [token]",
            r#""access_token":"[redacted]""#,
        ] {
            assert!(
                masked.contains(placeholder),
                "{placeholder} missing: {masked}"
            );
        }
    }

    #[test]
    fn plain_numbers_and_codes_stay() {
        let line = "pull parties cursor 20261027093000 outbox 3/50 code SYNC_CURSOR_EXPIRED";
        assert_eq!(mask(line), line);
    }

    #[derive(Clone, Default)]
    struct Sink(Arc<Mutex<Vec<u8>>>);

    impl Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_record_is_masked_on_the_way_to_the_sink() {
        let sink = Sink::default();
        let (_, logger) = fern::Dispatch::new()
            .format(masking_format)
            .chain(fern::Output::writer(Box::new(sink.clone()), "\n"))
            .into_log();
        logger.log(
            &Record::builder()
                .args(format_args!("device linked for mehmet@example.com"))
                .level(log::Level::Info)
                .target("keystone_desktop_lib")
                .build(),
        );
        let out = String::from_utf8(sink.0.lock().unwrap().clone()).unwrap();
        assert!(!out.contains("mehmet@example.com"), "{out}");
        assert!(
            out.contains("[keystone_desktop_lib][INFO] device linked for [email]"),
            "{out}"
        );
    }

    #[test]
    fn level_follows_the_build_profile() {
        let expected = if cfg!(debug_assertions) {
            LevelFilter::Debug
        } else {
            LevelFilter::Info
        };
        assert_eq!(level_for_build(), expected);
    }
}
