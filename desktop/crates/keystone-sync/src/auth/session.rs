//! One lock per (token store medium, profile) in the process.
//!
//! The key is the store's persistent identity ([`TokenStore::identity`])
//! plus the profile id, so every client of a profile shares the lock, even
//! when each holds its own store object. The session keeps no state of its
//! own: generation and deactivation live in the store's [`SessionRecord`],
//! so dropping and re-creating a session loses nothing.
//!
//! Besides the async lock that serializes token reads and writes, a session
//! has a synchronous sign-in gate: [`Session::sign_in`] (the only way a
//! sign-in may start a new generation) takes it exclusively, and
//! [`Session::hold`] keeps any sign-in from completing while a caller
//! checks the generation and acts on it (the sync engine's local reads and
//! commits).
//!
//! [`SessionRecord`]: super::SessionRecord

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, PoisonError, RwLock, RwLockReadGuard, Weak};

use super::{StoredTokens, TokenStore, TokenWrite};
use crate::error::Result;

type Registry = Mutex<HashMap<(String, String), Weak<Session>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

pub struct Session {
    identity: String,
    profile: String,
    gate: tokio::sync::Mutex<()>,
    sign_ins: RwLock<()>,
}

impl std::fmt::Debug for Session {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("store", &self.identity)
            .field("profile", &self.profile)
            .finish_non_exhaustive()
    }
}

impl Session {
    /// The process-wide session of `store`'s medium + `profile`.
    pub fn shared<T: TokenStore + ?Sized>(profile: &str, store: &T) -> Arc<Self> {
        let key = (store.identity(), profile.to_owned());
        let mut map = registry().lock().unwrap_or_else(PoisonError::into_inner);
        map.retain(|_, weak| weak.strong_count() > 0);
        if let Some(existing) = map.get(&key).and_then(Weak::upgrade) {
            return existing;
        }
        let session = Arc::new(Self {
            identity: key.0.clone(),
            profile: key.1.clone(),
            gate: tokio::sync::Mutex::new(()),
            sign_ins: RwLock::new(()),
        });
        map.insert(key, Arc::downgrade(&session));
        session
    }

    pub fn profile(&self) -> &str {
        &self.profile
    }

    /// Serializes every token read and write of the profile: snapshots,
    /// refreshes, sign-ins and deactivation.
    pub async fn lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.gate.lock().await
    }

    /// Successful sign-in of this profile, the only way to start a new
    /// generation: [`TokenStore::sign_in`] under the session lock (so a
    /// refresh or sign-out in flight finishes first and cannot write over
    /// it) and then the sign-in gate (so no guarded engine section is
    /// between its check and its work). Never call it while holding
    /// [`Session::hold`] or [`Session::lock`].
    pub async fn sign_in<T: TokenStore + ?Sized>(
        &self,
        store: &T,
        tokens: &StoredTokens,
    ) -> Result<u64> {
        let _tokens = self.gate.lock().await;
        let _gate = self
            .sign_ins
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        store.sign_in(&TokenWrite::new(), &self.profile, tokens)
    }

    /// While the guard lives, no [`Session::sign_in`] of this profile
    /// completes. Hold it only for short synchronous work.
    pub fn hold(&self) -> RwLockReadGuard<'_, ()> {
        self.sign_ins.read().unwrap_or_else(PoisonError::into_inner)
    }
}
