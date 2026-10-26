//! One lock per (token store medium, profile) in the process.
//!
//! The key is the store's persistent identity ([`TokenStore::identity`])
//! plus the profile id, so every client of a profile shares the lock, even
//! when each holds its own store object. The session keeps no state of its
//! own: generation and deactivation live in the store's [`SessionRecord`],
//! so dropping and re-creating a session loses nothing.
//!
//! [`SessionRecord`]: super::SessionRecord

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, PoisonError, Weak};

use super::TokenStore;

type Registry = Mutex<HashMap<(String, String), Weak<Session>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

pub struct Session {
    identity: String,
    profile: String,
    gate: tokio::sync::Mutex<()>,
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
}
