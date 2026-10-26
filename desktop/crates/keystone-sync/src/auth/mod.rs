//! Device tokens. Tokens live only in Rust: never in the webview, never in
//! the SQLite store. The OS keychain implementation of [`TokenStore`] comes
//! with the Tauri shell (D3); [`MemoryTokenStore`] serves tests.

use std::collections::HashMap;
use std::fmt;
use std::sync::{Mutex, PoisonError};

use zeroize::Zeroize;

use crate::error::Result;
use crate::wire::{DeviceToken, Timestamp};

mod session;

pub use session::Session;

/// A string that never shows up in `Debug` output. Zeroed on drop.
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

impl Drop for Secret {
    fn drop(&mut self) {
        self.0.zeroize();
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
    fn from(mut token: DeviceToken) -> Self {
        Self {
            access_token: Secret(std::mem::take(&mut token.token)),
            access_expires_at: token.expires_at.clone(),
            refresh_token: Secret(std::mem::take(&mut token.refresh_token)),
            refresh_expires_at: token.refresh_expires_at.clone(),
        }
    }
}

/// Permission to write a [`TokenStore`]. Only this crate makes one (the
/// client and the engine under the [`Session`] lock, and
/// [`Session::sign_in`]), so code outside the crate can implement the
/// write methods but cannot call them: there is no way into a profile
/// around the session.
#[derive(Debug)]
pub struct TokenWrite {
    _private: (),
}

impl TokenWrite {
    pub(crate) const fn new() -> Self {
        Self { _private: () }
    }
}

/// Everything persisted for one profile, read in one step.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SessionRecord {
    pub tokens: Option<StoredTokens>,
    /// Bumped by every successful sign-in, never by a refresh. A
    /// deactivation answered to a call made in an older generation is stale.
    pub generation: u64,
    /// Set by `USER_DEACTIVATED`; cleared only by [`TokenStore::sign_in`].
    pub deactivated: bool,
}

/// Persists the [`SessionRecord`] per server profile id.
///
/// Contract for every implementation (the OS keychain store of D3
/// included):
/// - **One persistent record per profile**: tokens, generation and the
///   deactivation flag live in one record that is read and written as a
///   whole. The generation only grows: no method (clear, take, sign-out,
///   deactivate) deletes or resets it, otherwise a compare-and-set could
///   match a generation of an earlier sign-in.
/// - **Atomic steps under one lock for all handles**: every method is one
///   atomic step on the medium, serialized by a lock that covers every
///   store object (keychain handle) over the same medium, also across
///   processes; no torn record is ever visible. `take` removes and returns
///   the tokens in one step; `sign_in` writes tokens, the new generation and
///   the cleared flag together; `deactivate` and `sign_out` are
///   compare-and-sets on the generation. The [`Session`] lock serializes the
///   calls of one process, but a store must not rely on it.
/// - [`TokenStore::identity`] is the same for every handle of the medium.
///
/// One way in: outside this crate a token store can be read, but not
/// written. Writes need a [`TokenWrite`], which only the crate makes: a
/// sign-in goes through [`Session::sign_in`] (session lock, then the
/// sign-in gate); every other write is done by the client and the engine
/// under the session lock.
///
/// ```compile_fail
/// use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore};
/// use keystone_sync::wire::Timestamp;
/// let t = StoredTokens {
///     access_token: Secret::new("a"),
///     access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
///     refresh_token: Secret::new("r"),
///     refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
/// };
/// let store = MemoryTokenStore::default();
/// store.sign_in("prod", &t).unwrap();
/// ```
///
/// ```compile_fail
/// use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore};
/// use keystone_sync::wire::Timestamp;
/// let t = StoredTokens {
///     access_token: Secret::new("a"),
///     access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
///     refresh_token: Secret::new("r"),
///     refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
/// };
/// let store = MemoryTokenStore::default();
/// store.save("prod", &t).unwrap();
/// ```
///
/// Nor can a write permission be made outside the crate:
///
/// ```compile_fail
/// use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore, TokenWrite};
/// use keystone_sync::wire::Timestamp;
/// let t = StoredTokens {
///     access_token: Secret::new("a"),
///     access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
///     refresh_token: Secret::new("r"),
///     refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
/// };
/// let store = MemoryTokenStore::default();
/// store.sign_in(&TokenWrite::new(), "prod", &t).unwrap();
/// ```
///
/// The way in (positive control of the blocks above):
///
/// ```no_run
/// use keystone_sync::auth::{MemoryTokenStore, Secret, Session, StoredTokens};
/// use keystone_sync::wire::Timestamp;
/// # async fn f() -> keystone_sync::error::Result<()> {
/// let t = StoredTokens {
///     access_token: Secret::new("a"),
///     access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
///     refresh_token: Secret::new("r"),
///     refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
/// };
/// let store = MemoryTokenStore::default();
/// Session::shared("prod", &store).sign_in(&store, &t).await?;
/// # Ok(())
/// # }
/// ```
pub trait TokenStore: Send + Sync {
    /// Stable identity of the persistent medium. Store objects over the
    /// same medium (e.g. two keychain handles of one service) return the same
    /// value, so their clients share one [`Session`].
    fn identity(&self) -> String;

    fn load_record(&self, profile: &str) -> Result<SessionRecord>;

    fn load(&self, profile: &str) -> Result<Option<StoredTokens>>;

    /// Replaces the token pair (a refresh rotates both); generation and the
    /// deactivation flag stay.
    fn save(&self, _write: &TokenWrite, profile: &str, tokens: &StoredTokens) -> Result<()>;

    /// Removes the tokens; succeeds when there are none.
    fn clear(&self, _write: &TokenWrite, profile: &str) -> Result<()>;

    /// Removes and returns the tokens in one atomic step.
    fn take(&self, _write: &TokenWrite, profile: &str) -> Result<Option<StoredTokens>>;

    /// Successful sign-in: stores `tokens`, bumps the generation and clears
    /// the deactivation flag, atomically. Returns the new generation.
    fn sign_in(&self, _write: &TokenWrite, profile: &str, tokens: &StoredTokens) -> Result<u64>;

    /// Compare-and-set: when the generation is `expected_generation`, sets
    /// the deactivation flag and removes the tokens, atomically, and returns
    /// `true`. Otherwise changes nothing and returns `false`.
    fn deactivate(
        &self,
        _write: &TokenWrite,
        profile: &str,
        expected_generation: u64,
    ) -> Result<bool>;

    /// Compare-and-set sign-out: when the generation is `expected_generation`,
    /// removes the tokens atomically and returns `true`; otherwise (a newer
    /// sign-in) changes nothing and returns `false`. The default fails
    /// without changing anything: a store must implement it to support a
    /// sign-out.
    fn sign_out(
        &self,
        _write: &TokenWrite,
        profile: &str,
        expected_generation: u64,
    ) -> Result<bool> {
        let _ = (profile, expected_generation);
        Err(crate::error::SyncError::TokenStore(
            "this token store does not support a generation-bound sign-out".to_owned(),
        ))
    }
}

#[derive(Debug)]
pub struct MemoryTokenStore {
    id: u64,
    records: Mutex<HashMap<String, SessionRecord>>,
}

impl Default for MemoryTokenStore {
    fn default() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        Self {
            id: NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            records: Mutex::default(),
        }
    }
}

impl MemoryTokenStore {
    /// A new medium already signed in to `profile` (generation 1), for
    /// tests and fixtures: nothing can observe it before it exists.
    pub fn signed_in(profile: &str, tokens: &StoredTokens) -> Self {
        let store = Self::default();
        store.with(profile, |record| {
            record.tokens = Some(tokens.clone());
            record.generation = 1;
        });
        store
    }

    fn with<R>(&self, profile: &str, f: impl FnOnce(&mut SessionRecord) -> R) -> R {
        let mut map = self.records.lock().unwrap_or_else(PoisonError::into_inner);
        f(map.entry(profile.to_owned()).or_default())
    }
}

impl TokenStore for MemoryTokenStore {
    fn identity(&self) -> String {
        format!("memory:{}", self.id)
    }

    fn load_record(&self, profile: &str) -> Result<SessionRecord> {
        Ok(self.with(profile, |record| record.clone()))
    }

    fn load(&self, profile: &str) -> Result<Option<StoredTokens>> {
        Ok(self.with(profile, |record| record.tokens.clone()))
    }

    fn save(&self, _write: &TokenWrite, profile: &str, tokens: &StoredTokens) -> Result<()> {
        self.with(profile, |record| record.tokens = Some(tokens.clone()));
        Ok(())
    }

    fn clear(&self, _write: &TokenWrite, profile: &str) -> Result<()> {
        self.with(profile, |record| record.tokens = None);
        Ok(())
    }

    fn take(&self, _write: &TokenWrite, profile: &str) -> Result<Option<StoredTokens>> {
        Ok(self.with(profile, |record| record.tokens.take()))
    }

    fn sign_in(&self, _write: &TokenWrite, profile: &str, tokens: &StoredTokens) -> Result<u64> {
        Ok(self.with(profile, |record| {
            record.tokens = Some(tokens.clone());
            record.generation += 1;
            record.deactivated = false;
            record.generation
        }))
    }

    fn deactivate(
        &self,
        _write: &TokenWrite,
        profile: &str,
        expected_generation: u64,
    ) -> Result<bool> {
        Ok(self.with(profile, |record| {
            if record.generation != expected_generation {
                return false;
            }
            record.deactivated = true;
            record.tokens = None;
            true
        }))
    }

    fn sign_out(
        &self,
        _write: &TokenWrite,
        profile: &str,
        expected_generation: u64,
    ) -> Result<bool> {
        Ok(self.with(profile, |record| {
            if record.generation != expected_generation {
                return false;
            }
            record.tokens = None;
            true
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: TokenWrite = TokenWrite::new();

    fn tokens(n: u8) -> StoredTokens {
        StoredTokens {
            access_token: Secret::new(format!("access-{n}")),
            access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
            refresh_token: Secret::new(format!("refresh-{n}")),
            refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
        }
    }

    #[test]
    fn deactivate_is_a_compare_and_set_on_the_generation() {
        let store = MemoryTokenStore::default();
        let generation = store.sign_in(&W, "prod", &tokens(1)).unwrap();
        assert!(!store.deactivate(&W, "prod", generation - 1).unwrap());
        assert_eq!(store.load("prod").unwrap(), Some(tokens(1)));
        assert!(store.deactivate(&W, "prod", generation).unwrap());
        let record = store.load_record("prod").unwrap();
        assert!(record.deactivated && record.tokens.is_none());
        // Only a sign-in clears the mark; a refresh save keeps it.
        store.save(&W, "prod", &tokens(2)).unwrap();
        assert!(store.load_record("prod").unwrap().deactivated);
        store.sign_in(&W, "prod", &tokens(3)).unwrap();
        assert!(!store.load_record("prod").unwrap().deactivated);
        assert_eq!(store.take(&W, "prod").unwrap(), Some(tokens(3)));
        assert_eq!(store.take(&W, "prod").unwrap(), None);
    }

    #[test]
    fn sign_out_is_a_compare_and_set_on_the_generation() {
        let store = MemoryTokenStore::default();
        let first = store.sign_in(&W, "prod", &tokens(1)).unwrap();
        store.sign_in(&W, "prod", &tokens(2)).unwrap();
        assert!(!store.sign_out(&W, "prod", first).unwrap());
        assert_eq!(store.load("prod").unwrap(), Some(tokens(2)));
        assert!(store.sign_out(&W, "prod", first + 1).unwrap());
        assert_eq!(store.load("prod").unwrap(), None);
    }

    #[test]
    fn memory_store_saves_replaces_and_clears() {
        let store = MemoryTokenStore::default();
        assert_eq!(store.load("prod").unwrap(), None);
        store.save(&W, "prod", &tokens(1)).unwrap();
        store.save(&W, "prod", &tokens(2)).unwrap();
        assert_eq!(store.load("prod").unwrap(), Some(tokens(2)));
        assert_eq!(store.load("test").unwrap(), None);
        store.clear(&W, "prod").unwrap();
        store.clear(&W, "prod").unwrap();
        assert_eq!(store.load("prod").unwrap(), None);
    }

    #[test]
    fn secrets_stay_out_of_debug() {
        let text = format!("{:?}", tokens(7));
        assert!(!text.contains("access-7") && !text.contains("refresh-7"));
    }
}
