//! Crate error. Server failures carry the wire `ErrorCode` unchanged; local
//! failures get a `LocalCode`. `code()` gives the string the UI translates
//! as `desktop.errors.<code>`.

use std::collections::BTreeMap;
use std::time::Duration;

use crate::wire::{ApiError, ErrorCode};

pub type Result<T, E = SyncError> = std::result::Result<T, E>;

/// Codes for failures that never come from the server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LocalCode {
    /// Offline and the request has no local answer.
    OfflineUnavailable,
    /// Connection, TLS or timeout failure before an HTTP response.
    NetworkError,
    /// The database key is wrong or the file is not a SQLCipher database.
    StoreKeyInvalid,
    /// Any other SQLite failure.
    StoreError,
    /// Migration registry or ledger is inconsistent.
    StoreMigrationInvalid,
    /// A body could not be encoded or decoded.
    DecodeError,
    /// The token store (OS keychain) failed.
    TokenStoreError,
    /// Server profile URL or endpoint path rejected (not https, or not under `/api/v1/`).
    InvalidServerUrl,
    /// The scaffold has no implementation for this operation yet.
    NotImplemented,
}

impl LocalCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OfflineUnavailable => "OFFLINE_UNAVAILABLE",
            Self::NetworkError => "NETWORK_ERROR",
            Self::StoreKeyInvalid => "STORE_KEY_INVALID",
            Self::StoreError => "STORE_ERROR",
            Self::StoreMigrationInvalid => "STORE_MIGRATION_INVALID",
            Self::DecodeError => "DECODE_ERROR",
            Self::TokenStoreError => "TOKEN_STORE_ERROR",
            Self::InvalidServerUrl => "INVALID_SERVER_URL",
            Self::NotImplemented => "NOT_IMPLEMENTED",
        }
    }
}

/// Either side of `SyncError::kind`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Code {
    Server(ErrorCode),
    Local(LocalCode),
}

#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    /// Request-level error body from the server.
    /// For auth failures and unknown codes `message` and `fields` hold fixed
    /// text, never server-provided content (see [`SyncError::from_api`]).
    #[error("{}: {message}", code.ui_code())]
    Api {
        status: u16,
        code: ErrorCode,
        message: String,
        fields: BTreeMap<String, Vec<String>>,
        /// From `Retry-After`, when the server sent one.
        retry_after: Option<Duration>,
    },
    #[error("offline: {0}")]
    OfflineUnavailable(String),
    #[error("network: {0}")]
    Network(String),
    #[error("database key rejected")]
    StoreKeyInvalid,
    #[error("store: {0}")]
    Store(#[from] rusqlite::Error),
    #[error("migration: {0}")]
    Migration(String),
    #[error("decode: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("token store: {0}")]
    TokenStore(String),
    #[error("invalid server url: {0}")]
    InvalidServerUrl(String),
    #[error("not implemented: {0}")]
    NotImplemented(&'static str),
}

impl SyncError {
    /// Builds `Api` from an error body. Auth failures (401, sign-in and
    /// account codes) and unknown codes are redacted: the server text could
    /// echo a credential, so `message` becomes a fixed text and each field
    /// message becomes the code. Field names are kept when identifier-shaped.
    pub fn from_api(status: u16, error: ApiError, retry_after: Option<Duration>) -> Self {
        let fields = error.fields.unwrap_or_default();
        if !(status == 401 || is_auth_code(&error.code) || !error.code.is_known()) {
            return Self::Api {
                status,
                code: error.code,
                message: error.message,
                fields,
                retry_after,
            };
        }
        let ui = error.code.ui_code();
        let fields = fields
            .into_keys()
            .filter(|name| is_field_name(name))
            .map(|name| (name, vec![ui.to_owned()]))
            .collect();
        Self::Api {
            status,
            message: format!("{ui} (server message redacted)"),
            code: error.code,
            fields,
            retry_after,
        }
    }

    /// Server or local code of this error.
    pub fn kind(&self) -> Code {
        let local = match self {
            Self::Api { code, .. } => return Code::Server(code.clone()),
            Self::OfflineUnavailable(_) => LocalCode::OfflineUnavailable,
            Self::Network(_) => LocalCode::NetworkError,
            Self::StoreKeyInvalid => LocalCode::StoreKeyInvalid,
            Self::Store(_) => LocalCode::StoreError,
            Self::Migration(_) => LocalCode::StoreMigrationInvalid,
            Self::Decode(_) => LocalCode::DecodeError,
            Self::TokenStore(_) => LocalCode::TokenStoreError,
            Self::InvalidServerUrl(_) => LocalCode::InvalidServerUrl,
            Self::NotImplemented(_) => LocalCode::NotImplemented,
        };
        Code::Local(local)
    }

    /// Stable code string: the `ErrorCode` wire value or the `LocalCode`.
    /// An unknown server code gives `SERVER_ERROR`.
    pub fn code(&self) -> &'static str {
        match self.kind() {
            Code::Server(code) => code.ui_code(),
            Code::Local(code) => code.as_str(),
        }
    }

    pub fn retry_after(&self) -> Option<Duration> {
        match self {
            Self::Api { retry_after, .. } => *retry_after,
            _ => None,
        }
    }
}

/// Codes of sign-in and account failures, whose text is never kept.
fn is_auth_code(code: &ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::Unauthenticated
            | ErrorCode::TwoFactorRequired
            | ErrorCode::InvalidTwoFactorCode
            | ErrorCode::UserDeactivated
            | ErrorCode::PasswordChangeRequired
            | ErrorCode::CompanyForbidden
    )
}

fn is_field_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_codes_never_collide_with_server_codes() {
        let locals = [
            LocalCode::OfflineUnavailable,
            LocalCode::NetworkError,
            LocalCode::StoreKeyInvalid,
            LocalCode::StoreError,
            LocalCode::StoreMigrationInvalid,
            LocalCode::DecodeError,
            LocalCode::TokenStoreError,
            LocalCode::InvalidServerUrl,
            LocalCode::NotImplemented,
        ];
        for local in locals {
            assert!(
                ErrorCode::ALL.iter().all(|c| c.as_str() != local.as_str()),
                "{} is also a server code",
                local.as_str()
            );
        }
    }

    #[test]
    fn api_error_keeps_the_wire_code() {
        let error = SyncError::from_api(
            409,
            ApiError {
                message: "locked".into(),
                code: ErrorCode::DocumentLocked,
                fields: None,
            },
            None,
        );
        assert_eq!(error.code(), "DOCUMENT_LOCKED");
        assert_eq!(error.kind(), Code::Server(ErrorCode::DocumentLocked));
    }
}
