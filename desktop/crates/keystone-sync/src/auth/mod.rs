//! Device tokens. Tokens live only in Rust: never in the webview, never in
//! the SQLite store. The OS keychain implementation of [`TokenStore`] comes
//! with the Tauri shell (D3); [`MemoryTokenStore`] serves tests.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Mutex, PoisonError};

use crate::error::Result;
use crate::wire::{DeviceToken, Timestamp};

/// A string that never shows up in `Debug` output.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredTokens {
    pub access_token: Secret,
    pub access_expires_at: Timestamp,
    pub refresh_token: Secret,
    pub refresh_expires_at: Timestamp,
}

impl From<DeviceToken> for StoredTokens {
    fn from(token: DeviceToken) -> Self {
        Self {
            access_token: Secret(token.token),
            access_expires_at: token.expires_at,
            refresh_token: Secret(token.refresh_token),
            refresh_expires_at: token.refresh_expires_at,
        }
    }
}

/// Persists tokens per server profile id. Saving replaces the previous pair
/// atomically (a refresh rotates both tokens).
pub trait TokenStore: Send + Sync {
    fn load(&self, profile: &str) -> Result<Option<StoredTokens>>;

    fn save(&self, profile: &str, tokens: &StoredTokens) -> Result<()>;

    /// Removes the tokens; succeeds when there are none.
    fn clear(&self, profile: &str) -> Result<()>;
}

#[derive(Debug, Default)]
pub struct MemoryTokenStore {
    tokens: Mutex<HashMap<String, StoredTokens>>,
}

impl TokenStore for MemoryTokenStore {
    fn load(&self, profile: &str) -> Result<Option<StoredTokens>> {
        let tokens = self.tokens.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(tokens.get(profile).cloned())
    }

    fn save(&self, profile: &str, tokens: &StoredTokens) -> Result<()> {
        let mut map = self.tokens.lock().unwrap_or_else(PoisonError::into_inner);
        map.insert(profile.to_owned(), tokens.clone());
        Ok(())
    }

    fn clear(&self, profile: &str) -> Result<()> {
        let mut map = self.tokens.lock().unwrap_or_else(PoisonError::into_inner);
        map.remove(profile);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokens(n: u8) -> StoredTokens {
        StoredTokens {
            access_token: Secret::new(format!("access-{n}")),
            access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
            refresh_token: Secret::new(format!("refresh-{n}")),
            refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
        }
    }

    #[test]
    fn memory_store_saves_replaces_and_clears() {
        let store = MemoryTokenStore::default();
        assert_eq!(store.load("prod").unwrap(), None);
        store.save("prod", &tokens(1)).unwrap();
        store.save("prod", &tokens(2)).unwrap();
        assert_eq!(store.load("prod").unwrap(), Some(tokens(2)));
        assert_eq!(store.load("test").unwrap(), None);
        store.clear("prod").unwrap();
        store.clear("prod").unwrap();
        assert_eq!(store.load("prod").unwrap(), None);
    }

    #[test]
    fn secrets_stay_out_of_debug() {
        let text = format!("{:?}", tokens(7));
        assert!(!text.contains("access-7") && !text.contains("refresh-7"));
    }
}
