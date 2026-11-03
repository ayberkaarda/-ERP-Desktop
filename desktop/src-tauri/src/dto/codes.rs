//! Every error code the shell itself can put in a [`CommandError`]:
//! [`crate::commands::codes`], [`crate::bootstrap::codes`] and the local
//! codes of `keystone-sync` ([`LocalCode`]). Server codes are not here; they
//! come from `contracts/sync/error-codes.schema.json`. The UI translation
//! check takes the two lists together.
//!
//! [`CommandError`]: crate::commands::CommandError

use keystone_sync::error::LocalCode;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A code of the shell (`desktop.errors.<code>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShellErrorCode {
    // commands::codes
    NoActiveProfile,
    EngineUnavailable,
    ExternalOpenFailed,
    // bootstrap::codes
    ProfileNotFound,
    ProfilesFileInvalid,
    DesktopUpdateRequired,
    SyncSchemaMismatch,
    ProfileRecordMalformed,
    ProfileHasPendingWork,
    ProfileBusy,
    CompanyNotAvailable,
    TaskFailed,
    /// An error answer of the server that is not in its error envelope.
    ServerError,
    // keystone-sync LocalCode
    OfflineUnavailable,
    NetworkError,
    StoreKeyInvalid,
    StoreError,
    StoreMigrationInvalid,
    DecodeError,
    TokenStoreError,
    InvalidServerUrl,
    NotImplemented,
    InvalidRequest,
    PayloadTooLarge,
    TlsCertificateInvalid,
}

impl ShellErrorCode {
    pub const ALL: [Self; 25] = [
        Self::NoActiveProfile,
        Self::EngineUnavailable,
        Self::ExternalOpenFailed,
        Self::ProfileNotFound,
        Self::ProfilesFileInvalid,
        Self::DesktopUpdateRequired,
        Self::SyncSchemaMismatch,
        Self::ProfileRecordMalformed,
        Self::ProfileHasPendingWork,
        Self::ProfileBusy,
        Self::CompanyNotAvailable,
        Self::TaskFailed,
        Self::ServerError,
        Self::OfflineUnavailable,
        Self::NetworkError,
        Self::StoreKeyInvalid,
        Self::StoreError,
        Self::StoreMigrationInvalid,
        Self::DecodeError,
        Self::TokenStoreError,
        Self::InvalidServerUrl,
        Self::NotImplemented,
        Self::InvalidRequest,
        Self::PayloadTooLarge,
        Self::TlsCertificateInvalid,
    ];

    /// The code as `CommandError::code` carries it.
    pub fn as_str(self) -> String {
        crate::dto::status::wire_name(&self)
    }

    /// The shell code of a crate local code. Without a catch-all arm: a new
    /// `LocalCode` does not compile until it is listed here.
    pub fn from_local(code: LocalCode) -> Self {
        match code {
            LocalCode::OfflineUnavailable => Self::OfflineUnavailable,
            LocalCode::NetworkError => Self::NetworkError,
            LocalCode::StoreKeyInvalid => Self::StoreKeyInvalid,
            LocalCode::StoreError => Self::StoreError,
            LocalCode::StoreMigrationInvalid => Self::StoreMigrationInvalid,
            LocalCode::DecodeError => Self::DecodeError,
            LocalCode::TokenStoreError => Self::TokenStoreError,
            LocalCode::InvalidServerUrl => Self::InvalidServerUrl,
            LocalCode::NotImplemented => Self::NotImplemented,
            LocalCode::InvalidRequest => Self::InvalidRequest,
            LocalCode::PayloadTooLarge => Self::PayloadTooLarge,
            LocalCode::TlsCertificateInvalid => Self::TlsCertificateInvalid,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{BTreeMap, BTreeSet};
    use std::path::Path;

    use super::*;

    const LOCAL: [LocalCode; 12] = [
        LocalCode::OfflineUnavailable,
        LocalCode::NetworkError,
        LocalCode::StoreKeyInvalid,
        LocalCode::StoreError,
        LocalCode::StoreMigrationInvalid,
        LocalCode::DecodeError,
        LocalCode::TokenStoreError,
        LocalCode::InvalidServerUrl,
        LocalCode::NotImplemented,
        LocalCode::InvalidRequest,
        LocalCode::PayloadTooLarge,
        LocalCode::TlsCertificateInvalid,
    ];

    fn names() -> BTreeSet<String> {
        ShellErrorCode::ALL.iter().map(|c| c.as_str()).collect()
    }

    #[test]
    fn codes_are_spelled_as_commands_return_them() {
        assert_eq!(
            ShellErrorCode::NoActiveProfile.as_str(),
            "NO_ACTIVE_PROFILE"
        );
        assert_eq!(
            ShellErrorCode::ProfileHasPendingWork.as_str(),
            "PROFILE_HAS_PENDING_WORK"
        );
        assert_eq!(
            names().len(),
            ShellErrorCode::ALL.len(),
            "a code is listed twice"
        );
        for code in LOCAL {
            assert_eq!(ShellErrorCode::from_local(code).as_str(), code.as_str());
        }
    }

    /// `ALL` is written by hand: every code of the type (what the TS union
    /// says) must be in it, or the UI translation check never sees it.
    #[test]
    fn all_lists_every_code_of_the_type() {
        let union = <ShellErrorCode as TS>::inline(&ts_rs::Config::default());
        let quoted = regex::Regex::new(r#""([A-Z][A-Z0-9_]*)""#).unwrap();
        let in_type: BTreeSet<String> = quoted
            .captures_iter(&union)
            .map(|found| found[1].to_owned())
            .collect();
        assert!(in_type.contains("NO_ACTIVE_PROFILE"), "{union}");
        assert_eq!(in_type, names(), "{union}");
    }

    /// Shell sources without their test modules.
    fn sources() -> Vec<(String, String)> {
        fn walk(dir: &Path, out: &mut Vec<(String, String)>) {
            for entry in std::fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                let name = path.to_string_lossy().replace('\\', "/");
                if path.is_dir() {
                    if !name.ends_with("/tests") {
                        walk(&path, out);
                    }
                } else if name.ends_with(".rs") && !name.ends_with("/tests.rs") {
                    let text = std::fs::read_to_string(&path)
                        .unwrap()
                        .replace("\r\n", "\n");
                    let code = text
                        .split("#[cfg(test)]\nmod ")
                        .next()
                        .unwrap_or_default()
                        .to_owned();
                    out.push((name, code));
                }
            }
        }
        let mut out = Vec::new();
        walk(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut out);
        out
    }

    /// Every code a shell source puts in a `CommandError` (a literal, a
    /// `codes::` constant or a constant of the file), and every code constant.
    fn used_codes() -> BTreeMap<String, String> {
        let sources = sources();
        let constant =
            regex::Regex::new(r#"const ([A-Z][A-Z0-9_]+): &str = "([A-Z][A-Z0-9_]+)""#).unwrap();
        let mut constants = BTreeMap::new();
        let mut used = BTreeMap::new();
        for (file, text) in &sources {
            for found in constant.captures_iter(text) {
                constants.insert(found[1].to_owned(), found[2].to_owned());
            }
            // Every constant of a `codes` module is a code.
            if let Some(start) = text.find("pub mod codes {") {
                let block = &text[start..];
                let block = &block[..block.find("\n}").unwrap_or(block.len())];
                for found in constant.captures_iter(block) {
                    used.insert(found[2].to_owned(), file.clone());
                }
            }
        }
        let new = regex::Regex::new(
            r#"CommandError::new\(\s*(?:"([A-Z][A-Z0-9_]+)"|(?:[a-z_]+::)*([A-Z][A-Z0-9_]+)\s*,)"#,
        )
        .unwrap();
        for (file, text) in &sources {
            for found in new.captures_iter(text) {
                let code = match (found.get(1), found.get(2)) {
                    (Some(literal), _) => literal.as_str().to_owned(),
                    (None, Some(name)) => constants
                        .get(name.as_str())
                        .unwrap_or_else(|| panic!("{file}: constant {} unknown", name.as_str()))
                        .clone(),
                    _ => unreachable!(),
                };
                used.insert(code, file.clone());
            }
        }
        used
    }

    #[test]
    fn every_code_of_the_shell_is_listed() {
        let used = used_codes();
        // The scan finds codes of both modules and of plain literals.
        for sample in [
            "NO_ACTIVE_PROFILE",
            "PROFILE_BUSY",
            "SERVER_ERROR",
            "TASK_FAILED",
        ] {
            assert!(used.contains_key(sample), "scan missed {sample}: {used:?}");
        }
        let names = names();
        for (code, file) in &used {
            assert!(
                names.contains(code),
                "{code} ({file}) is not a ShellErrorCode"
            );
        }
    }

    #[test]
    fn every_listed_code_is_in_use() {
        let used = used_codes();
        let local: BTreeSet<String> = LOCAL.iter().map(|c| c.as_str().to_owned()).collect();
        for name in names() {
            assert!(
                used.contains_key(&name) || local.contains(&name),
                "{name} is neither a shell code nor a local code"
            );
        }
    }
}
