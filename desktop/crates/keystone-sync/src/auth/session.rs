//! One shared session per (token store instance, profile) in the process.
//!
//! Every client of the same profile and store gets the same [`Session`], so
//! they share one refresh lock and one deactivation flag. Use one store
//! instance (one `Arc`) per profile; two separate store instances of the
//! same keychain entry would not share the lock.

use std::any::Any;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError, Weak};

use super::TokenStore;

type Registry = Mutex<HashMap<(usize, String), Weak<dyn Any + Send + Sync>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

pub struct Session<T> {
    profile: String,
    store: Arc<T>,
    gate: tokio::sync::Mutex<()>,
    /// Bumped by every sign-in; a deactivation seen by a request of an
    /// older generation is stale.
    generation: AtomicU64,
    /// Set by `USER_DEACTIVATED`; cleared only by a successful sign-in.
    deactivated: AtomicBool,
}

impl<T> std::fmt::Debug for Session<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Session")
            .field("profile", &self.profile)
            .field("deactivated", &self.is_deactivated())
            .finish_non_exhaustive()
    }
}

impl<T: TokenStore + 'static> Session<T> {
    /// The process-wide session of `store` + `profile`.
    pub fn shared(profile: &str, store: &Arc<T>) -> Arc<Self> {
        let key = (Arc::as_ptr(store) as *const () as usize, profile.to_owned());
        let mut map = registry().lock().unwrap_or_else(PoisonError::into_inner);
        map.retain(|_, weak| weak.strong_count() > 0);
        if let Some(existing) = map
            .get(&key)
            .and_then(Weak::upgrade)
            .and_then(|any| any.downcast::<Self>().ok())
        {
            return existing;
        }
        let session = Arc::new(Self {
            profile: profile.to_owned(),
            store: Arc::clone(store),
            gate: tokio::sync::Mutex::new(()),
            generation: AtomicU64::new(0),
            deactivated: AtomicBool::new(false),
        });
        let any: Arc<dyn Any + Send + Sync> = session.clone();
        map.insert(key, Arc::downgrade(&any));
        session
    }
}

impl<T> Session<T> {
    pub fn profile(&self) -> &str {
        &self.profile
    }

    pub fn store(&self) -> &T {
        &self.store
    }

    /// Serializes token reads, refreshes, sign-ins and cleanups.
    pub async fn lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.gate.lock().await
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    pub fn is_deactivated(&self) -> bool {
        self.deactivated.load(Ordering::SeqCst)
    }

    /// Marks the session deactivated unless a sign-in happened after
    /// `generation`. Returns whether the mark applies.
    pub fn mark_deactivated(&self, generation: u64) -> bool {
        if self.generation() != generation {
            return false;
        }
        self.deactivated.store(true, Ordering::SeqCst);
        true
    }

    /// After a successful sign-in (call with the lock held).
    pub fn signed_in(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.deactivated.store(false, Ordering::SeqCst);
    }
}
