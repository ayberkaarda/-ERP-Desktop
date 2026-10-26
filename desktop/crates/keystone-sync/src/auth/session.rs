//! One session per (token store medium, profile) in the process: the store
//! handle and the locks of the profile in one object.
//!
//! The registry key is the store's persistent identity
//! ([`TokenStore::identity`]) plus the profile id, so every client of a
//! profile shares the session, even when each was made from its own store
//! object. The session keeps the handle it was made from and is the only
//! way to sign in: [`Session::sign_in`] writes to that handle and takes no
//! store, so a session cannot sign in to a store other than its own. The
//! session keeps no state besides the handle: generation and deactivation
//! live in the store's [`SessionRecord`], so dropping and re-creating a
//! session loses nothing.
//!
//! Besides the async lock that serializes token reads and writes, a session
//! has a synchronous sign-in gate: [`Session::sign_in`] takes it
//! exclusively, and [`Session::hold`] keeps any sign-in from completing
//! while a caller checks the generation and acts on it (the sync engine's
//! local reads and commits).
//!
//! A session of one store cannot sign in to another:
//!
//! ```compile_fail
//! use std::sync::Arc;
//! use keystone_sync::auth::{MemoryTokenStore, Secret, Session, StoredTokens};
//! use keystone_sync::wire::Timestamp;
//! # async fn f() -> keystone_sync::error::Result<()> {
//! let t = StoredTokens {
//!     access_token: Secret::new("a"),
//!     access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
//!     refresh_token: Secret::new("r"),
//!     refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
//! };
//! let dummy = Arc::new(MemoryTokenStore::default());
//! let real = Arc::new(MemoryTokenStore::default());
//! Session::shared("prod", dummy).sign_in(real.as_ref(), &t).await?;
//! # Ok(())
//! # }
//! ```
//!
//! ```compile_fail
//! use std::sync::Arc;
//! use keystone_sync::auth::{MemoryTokenStore, Secret, Session, StoredTokens};
//! use keystone_sync::wire::Timestamp;
//! # async fn f() -> keystone_sync::error::Result<()> {
//! let t = StoredTokens {
//!     access_token: Secret::new("a"),
//!     access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
//!     refresh_token: Secret::new("r"),
//!     refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
//! };
//! let dummy = Arc::new(MemoryTokenStore::default());
//! let real = Arc::new(MemoryTokenStore::default());
//! Session::shared("prod", dummy).sign_in(&real, &t).await?;
//! # Ok(())
//! # }
//! ```
//!
//! The way in (positive control of the blocks above):
//!
//! ```no_run
//! use std::sync::Arc;
//! use keystone_sync::auth::{MemoryTokenStore, Secret, Session, StoredTokens};
//! use keystone_sync::wire::Timestamp;
//! # async fn f() -> keystone_sync::error::Result<()> {
//! let t = StoredTokens {
//!     access_token: Secret::new("a"),
//!     access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
//!     refresh_token: Secret::new("r"),
//!     refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
//! };
//! let store = Arc::new(MemoryTokenStore::default());
//! Session::shared("prod", store).sign_in(&t).await?;
//! # Ok(())
//! # }
//! ```
//!
//! [`SessionRecord`]: super::SessionRecord

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock, PoisonError, RwLock, RwLockReadGuard, Weak};

use super::{SessionRecord, StoredTokens, TokenStore, TokenWrite};
use crate::error::Result;

type Registry = Mutex<HashMap<(String, String), Weak<Session>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

pub struct Session {
    store: Arc<dyn TokenStore>,
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
    /// The process-wide session of `store`'s medium + `profile`. The first
    /// caller's handle is the one the session writes through; a later
    /// caller with another handle of the same medium gets the same session.
    pub fn shared(profile: &str, store: Arc<dyn TokenStore>) -> Arc<Self> {
        let key = (store.identity(), profile.to_owned());
        let mut map = registry().lock().unwrap_or_else(PoisonError::into_inner);
        map.retain(|_, weak| weak.strong_count() > 0);
        if let Some(existing) = map.get(&key).and_then(Weak::upgrade) {
            return existing;
        }
        let session = Arc::new(Self {
            store,
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

    /// The store handle of the session (reads; writes need the crate).
    pub fn store(&self) -> &dyn TokenStore {
        self.store.as_ref()
    }

    /// The profile's record from the session's store.
    pub fn record(&self) -> Result<SessionRecord> {
        self.store.load_record(&self.profile)
    }

    /// Serializes every token read and write of the profile: snapshots,
    /// refreshes, sign-ins and deactivation.
    pub async fn lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.gate.lock().await
    }

    /// Successful sign-in of this profile, the only way to start a new
    /// generation, and always into the session's own store:
    /// [`TokenStore::sign_in`] under the session lock (so a refresh or
    /// sign-out in flight finishes first and cannot write over it) and then
    /// the sign-in gate (so no guarded engine section is between its check
    /// and its work). Never call it while holding [`Session::hold`] or
    /// [`Session::lock`].
    pub async fn sign_in(&self, tokens: &StoredTokens) -> Result<u64> {
        let _tokens = self.gate.lock().await;
        let _gate = self
            .sign_ins
            .write()
            .unwrap_or_else(PoisonError::into_inner);
        self.store
            .sign_in(&TokenWrite::new(), &self.profile, tokens)
    }

    /// While the guard lives, no [`Session::sign_in`] of this profile
    /// completes. Hold it only for short synchronous work.
    pub fn hold(&self) -> RwLockReadGuard<'_, ()> {
        self.sign_ins.read().unwrap_or_else(PoisonError::into_inner)
    }
}
