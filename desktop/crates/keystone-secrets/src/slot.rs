use std::fmt;

use zeroize::Zeroizing;

use crate::error::Error;
use crate::hex;
use crate::keychain::{Keychain, validate_name};

/// One installation-wide secret: 32 random bytes kept as 64 lowercase hex
/// digits in the keychain entry `slot:<name>`, made on first use.
#[derive(Clone)]
pub struct SecretSlot {
    keychain: Keychain,
    account: String,
}

impl SecretSlot {
    /// The slot of the device fingerprint sent with a device sign-in.
    pub const DEVICE_FINGERPRINT: &'static str = "device-fingerprint";

    pub fn new(keychain: &Keychain, name: &str) -> Result<Self, Error> {
        validate_name(name)?;
        Ok(Self {
            keychain: keychain.clone(),
            account: format!("slot:{name}"),
        })
    }

    pub fn device_fingerprint(keychain: &Keychain) -> Self {
        Self {
            keychain: keychain.clone(),
            account: format!("slot:{}", Self::DEVICE_FINGERPRINT),
        }
    }

    /// The stored value; `None` when there is none.
    pub fn get(&self) -> Result<Option<Zeroizing<String>>, Error> {
        let _state = self.keychain.inner.lock();
        self.read()
    }

    /// The stored value, or a new one written to the keychain first. Under
    /// the service lock, so concurrent callers get the same value.
    pub fn get_or_create(&self) -> Result<Zeroizing<String>, Error> {
        let inner = &self.keychain.inner;
        let _state = inner.lock();
        if let Some(value) = self.read()? {
            return Ok(value);
        }
        let bytes = hex::random()?;
        let value = hex::encode(&bytes);
        inner.write(&self.account, value.as_bytes())?;
        Ok(value)
    }

    /// Deletes the value; succeeds when there is none.
    pub fn remove(&self) -> Result<(), Error> {
        let inner = &self.keychain.inner;
        let _state = inner.lock();
        inner.delete(&self.account)
    }

    fn read(&self) -> Result<Option<Zeroizing<String>>, Error> {
        let Some(bytes) = self.keychain.inner.read(&self.account)? else {
            return Ok(None);
        };
        let bytes = hex::decode(&bytes).ok_or(Error::Malformed("secret slot"))?;
        Ok(Some(hex::encode(&bytes)))
    }
}

impl fmt::Debug for SecretSlot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SecretSlot")
            .field("service", &self.keychain.inner.service())
            .field("account", &self.account)
            .finish_non_exhaustive()
    }
}
