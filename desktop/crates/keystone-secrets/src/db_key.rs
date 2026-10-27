use std::fmt;

use keystone_sync::store::DbKey;

use crate::error::Error;
use crate::hex;
use crate::keychain::{Keychain, validate_name};

/// The SQLCipher key of each profile: 32 bytes from the OS CSPRNG, kept as
/// 64 hex digits in its own keychain entry (`db-key:<profile id>`).
///
/// Nothing here replaces a missing or unreadable key behind the caller's
/// back: when the profile's database already exists the shell checks
/// [`DbKeyStore::get`] and asks the user before deleting anything; only a
/// profile without a database calls [`DbKeyStore::get_or_create`].
#[derive(Clone)]
pub struct DbKeyStore {
    keychain: Keychain,
}

impl DbKeyStore {
    pub fn new(keychain: &Keychain) -> Self {
        Self {
            keychain: keychain.clone(),
        }
    }

    /// The stored key; `None` when there is none.
    pub fn get(&self, profile: &str) -> Result<Option<DbKey>, Error> {
        let account = account(profile)?;
        let _state = self.keychain.inner.lock();
        self.read(&account)
    }

    /// The stored key, or a new one written to the keychain first (no key is
    /// returned that the keychain did not take). Under the service lock, so
    /// concurrent callers get the same key.
    pub fn get_or_create(&self, profile: &str) -> Result<DbKey, Error> {
        let account = account(profile)?;
        let inner = &self.keychain.inner;
        let _state = inner.lock();
        if let Some(key) = self.read(&account)? {
            return Ok(key);
        }
        let bytes = hex::random()?;
        inner.write(&account, hex::encode(&bytes).as_bytes())?;
        Ok(DbKey::from_bytes(*bytes))
    }

    /// Deletes the key; succeeds when there is none.
    pub fn remove(&self, profile: &str) -> Result<(), Error> {
        let account = account(profile)?;
        let inner = &self.keychain.inner;
        let _state = inner.lock();
        inner.delete(&account)
    }

    fn read(&self, account: &str) -> Result<Option<DbKey>, Error> {
        let Some(text) = self.keychain.inner.read(account)? else {
            return Ok(None);
        };
        let bytes = hex::decode(&text).ok_or(Error::Malformed("db key"))?;
        Ok(Some(DbKey::from_bytes(*bytes)))
    }
}

impl fmt::Debug for DbKeyStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DbKeyStore")
            .field("service", &self.keychain.inner.service())
            .finish_non_exhaustive()
    }
}

fn account(profile: &str) -> Result<String, Error> {
    validate_name(profile)?;
    Ok(format!("db-key:{profile}"))
}
