use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError, Weak};

use keyring_core::{CredentialStore, Entry};
use keystone_sync::auth::SessionRecord;
use zeroize::Zeroizing;

use crate::error::{Error, keyring};

type Modifiers = &'static [(&'static str, &'static str)];

/// A keychain service name over a credential store. Cheap to clone; every
/// `Keychain` of the same service name in the process is the same object
/// (one lock, one cache).
#[derive(Clone)]
pub struct Keychain {
    pub(crate) inner: Arc<Inner>,
}

pub(crate) struct Inner {
    service: String,
    store: Arc<CredentialStore>,
    modifiers: Modifiers,
    state: Mutex<State>,
}

/// Guarded by the one lock of the service.
#[derive(Default)]
pub(crate) struct State {
    /// Session records read or written so far, by profile id.
    pub(crate) records: HashMap<String, SessionRecord>,
}

type Registry = Mutex<HashMap<String, Weak<Inner>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(Registry::default)
}

impl Keychain {
    /// The platform keychain: Windows Credential Manager (local-machine
    /// persistence, not roaming), the macOS keychain, or the Secret Service
    /// elsewhere. A service already open in the process is reused as it is.
    pub fn native(service: &str) -> Result<Self, Error> {
        Self::open(service, None)
    }

    /// `service` over `store` (e.g. `keyring_core::mock::Store::new()` in
    /// tests). A service already open in the process over the same store is
    /// reused; over another store it fails with [`Error::ServiceInUse`].
    pub fn with_store(service: &str, store: Arc<CredentialStore>) -> Result<Self, Error> {
        Self::open(service, Some(store))
    }

    fn open(service: &str, store: Option<Arc<CredentialStore>>) -> Result<Self, Error> {
        validate_name(service)?;
        let mut map = registry().lock().unwrap_or_else(PoisonError::into_inner);
        map.retain(|_, weak| weak.strong_count() > 0);
        if let Some(inner) = map.get(service).and_then(Weak::upgrade) {
            if let Some(store) = &store
                && !same_store(store, &inner.store)
            {
                return Err(Error::ServiceInUse(service.to_owned()));
            }
            return Ok(Self { inner });
        }
        let (store, modifiers) = match store {
            Some(store) => (store, &[][..]),
            None => native_store()?,
        };
        let inner = Arc::new(Inner {
            service: service.to_owned(),
            store,
            modifiers,
            state: Mutex::default(),
        });
        map.insert(service.to_owned(), Arc::downgrade(&inner));
        Ok(Self { inner })
    }

    pub fn service(&self) -> &str {
        &self.inner.service
    }
}

impl fmt::Debug for Keychain {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Keychain")
            .field("service", &self.inner.service)
            .finish_non_exhaustive()
    }
}

fn same_store(a: &Arc<CredentialStore>, b: &Arc<CredentialStore>) -> bool {
    std::ptr::addr_eq(Arc::as_ptr(a), Arc::as_ptr(b))
}

impl Inner {
    pub(crate) fn service(&self) -> &str {
        &self.service
    }

    /// The one lock of the service: every read-modify-write of every handle
    /// runs under it.
    pub(crate) fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn entry(&self, account: &str) -> Result<Entry, Error> {
        let modifiers: HashMap<&str, &str> = self.modifiers.iter().copied().collect();
        let modifiers = (!modifiers.is_empty()).then_some(&modifiers);
        self.store
            .build(&self.service, account, modifiers)
            .map_err(|e| keyring(&e))
    }

    /// The stored bytes, `None` when there is no entry.
    pub(crate) fn read(&self, account: &str) -> Result<Option<Zeroizing<Vec<u8>>>, Error> {
        match self.entry(account)?.get_secret() {
            Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(e) => Err(keyring(&e)),
        }
    }

    pub(crate) fn write(&self, account: &str, bytes: &[u8]) -> Result<(), Error> {
        self.entry(account)?
            .set_secret(bytes)
            .map_err(|e| keyring(&e))
    }

    /// Deletes the entry; succeeds when there is none.
    pub(crate) fn delete(&self, account: &str) -> Result<(), Error> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(e) => Err(keyring(&e)),
        }
    }
}

/// Profile ids, slot and service names: non-empty, at most 128 bytes, no
/// `:` (the account prefix separator) and no control characters.
pub(crate) fn validate_name(name: &str) -> Result<(), Error> {
    let ok =
        !name.is_empty() && name.len() <= 128 && !name.chars().any(|c| c == ':' || c.is_control());
    if ok {
        Ok(())
    } else {
        Err(Error::InvalidName(name.to_owned()))
    }
}

#[cfg(windows)]
fn native_store() -> Result<(Arc<CredentialStore>, Modifiers), Error> {
    let store: Arc<CredentialStore> =
        windows_native_keyring_store::Store::new().map_err(|e| keyring(&e))?;
    Ok((store, &[("persistence", "Local")]))
}

#[cfg(target_os = "macos")]
fn native_store() -> Result<(Arc<CredentialStore>, Modifiers), Error> {
    let store: Arc<CredentialStore> =
        apple_native_keyring_store::keychain::Store::new().map_err(|e| keyring(&e))?;
    Ok((store, &[]))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn native_store() -> Result<(Arc<CredentialStore>, Modifiers), Error> {
    let store: Arc<CredentialStore> =
        zbus_secret_service_keyring_store::Store::new().map_err(|e| keyring(&e))?;
    Ok((store, &[]))
}

#[cfg(not(any(windows, unix)))]
fn native_store() -> Result<(Arc<CredentialStore>, Modifiers), Error> {
    Err(Error::Keychain(
        "no native credential store on this platform".to_owned(),
    ))
}
