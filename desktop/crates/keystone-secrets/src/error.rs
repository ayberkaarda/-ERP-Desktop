use keystone_sync::SyncError;

/// Errors of the keychain stores. Messages never carry secret material.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
    /// The credential store failed (unreachable, locked, denied, ...).
    #[error("keychain: {0}")]
    Keychain(String),
    /// A record exists but cannot be read back. It is left as it is: the
    /// caller decides what to do. Only an explicit removal deletes it
    /// (`KeychainTokenStore::remove_profile`, `DbKeyStore::remove`).
    #[error("the keychain record `{0}` is malformed")]
    Malformed(&'static str),
    /// The session record would not fit in a keychain entry.
    #[error("the session record is larger than {max} bytes", max = crate::MAX_RECORD_BYTES)]
    TooLarge,
    /// An empty name, or one with `:`, control characters or over 128 bytes.
    #[error("invalid keychain name {0:?}")]
    InvalidName(String),
    /// The service is already open in this process over another store.
    #[error("the keychain service `{0}` is already open over another credential store")]
    ServiceInUse(String),
    #[error("the generation counter is exhausted")]
    GenerationOverflow,
    #[error("no random bytes: {0}")]
    Random(String),
}

impl From<Error> for SyncError {
    fn from(error: Error) -> Self {
        SyncError::TokenStore(error.to_string())
    }
}

/// Keychain error text without the payloads that may hold stored data.
pub(crate) fn keyring(error: &keyring_core::Error) -> Error {
    use keyring_core::Error as E;
    let text = match error {
        E::PlatformFailure(e) => format!("platform failure: {e}"),
        E::NoStorageAccess(e) => format!("no access to the credential store: {e}"),
        E::NoEntry => "no entry".to_owned(),
        E::BadEncoding(_) | E::BadDataFormat(..) => "unreadable stored data".to_owned(),
        E::BadStoreFormat(e) => format!("bad store format: {e}"),
        E::TooLong(what, max) => format!("{what} is longer than {max}"),
        E::Invalid(what, why) => format!("invalid {what}: {why}"),
        E::Ambiguous(_) => "ambiguous entry".to_owned(),
        E::NoDefaultStore => "no credential store".to_owned(),
        E::NotSupportedByStore(e) => format!("not supported: {e}"),
        _ => "credential store error".to_owned(),
    };
    Error::Keychain(text)
}
