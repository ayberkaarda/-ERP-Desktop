use std::fmt;
use std::io;

use keystone_sync::auth::{Secret, SessionRecord, StoredTokens, TokenStore, TokenWrite};
use keystone_sync::wire::Timestamp;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::error::Error;
use crate::keychain::{Inner, Keychain, State, validate_name};

/// Upper bound of one stored session record in bytes: the credential blob
/// limit of the Windows Credential Manager (`CRED_MAX_CREDENTIAL_BLOB_SIZE`),
/// the smallest of the supported keychains. A longer record is refused
/// before anything is written.
pub const MAX_RECORD_BYTES: usize = 2560;

/// [`TokenStore`] over the OS keychain: one keychain entry per profile
/// (account = profile id) holding the whole [`SessionRecord`] as JSON.
///
/// - One lock for all handles: every handle of a service in the process
///   shares the service's state ([`Keychain`]), and every method runs as one
///   step under its lock, so `take`, `sign_in`, `deactivate` and `sign_out`
///   are atomic across handles. Not across processes: see the crate docs.
/// - Write-through cache: a profile's record is read from the keychain once,
///   then kept in memory. A write builds the new record, writes it to the
///   keychain and only then replaces the cached one; when the keychain write
///   fails the method returns the error and the cached record stays.
/// - The generation only grows: no `TokenStore` method deletes the entry or
///   resets the generation; `clear`, `take`, `sign_out` and `deactivate`
///   remove only the tokens. A malformed entry fails every method, `sign_in`
///   too (overwriting it would restart a generation it cannot read); the
///   way out is [`KeychainTokenStore::remove_profile`].
/// - [`TokenStore::identity`] is `keychain:<service>` for every handle.
/// - Writes need the `TokenWrite` permit of `keystone-sync`, like every
///   token store: outside that crate the only way in is `Session::sign_in`.
#[derive(Clone)]
pub struct KeychainTokenStore {
    keychain: Keychain,
}

impl KeychainTokenStore {
    pub fn new(keychain: &Keychain) -> Self {
        Self {
            keychain: keychain.clone(),
        }
    }

    /// Deletes the profile's session entry from the keychain, for removing
    /// a server profile. The process keeps the generation, so a sign-in of
    /// the same id in this process still gets a newer one.
    ///
    /// The entry is deleted without being decoded: a malformed or unreadable
    /// entry is removed too (it is the way out of [`Error::Malformed`]). The
    /// generation kept is the cached one, else the entry's `generation` field
    /// when that much can be read, else 0.
    ///
    /// Close the profile's engine and `Session` first: a later `save` or
    /// `deactivate` of a live session matches the kept generation and writes
    /// the entry again.
    pub fn remove_profile(&self, profile: &str) -> Result<(), Error> {
        validate_name(profile)?;
        let inner = &self.keychain.inner;
        let mut state = inner.lock();
        let generation = match state.records.get(profile) {
            Some(record) => record.generation,
            None => stored_generation(inner, profile),
        };
        inner.delete(profile)?;
        state.records.insert(
            profile.to_owned(),
            SessionRecord {
                generation,
                ..SessionRecord::default()
            },
        );
        Ok(())
    }

    fn read<R>(&self, profile: &str, f: impl FnOnce(&SessionRecord) -> R) -> Result<R, Error> {
        validate_name(profile)?;
        let inner = &self.keychain.inner;
        let mut state = inner.lock();
        Ok(f(cached(inner, &mut state, profile)?))
    }

    /// One atomic read-modify-write: `f` edits a copy; a changed copy goes to
    /// the keychain first and replaces the cached record only after that.
    fn update<R>(
        &self,
        profile: &str,
        f: impl FnOnce(&mut SessionRecord) -> Result<R, Error>,
    ) -> Result<R, Error> {
        validate_name(profile)?;
        let inner = &self.keychain.inner;
        let mut state = inner.lock();
        let current = cached(inner, &mut state, profile)?;
        let mut next = current.clone();
        let out = f(&mut next)?;
        if next != *current {
            inner.write(profile, &encode(&next)?)?;
            state.records.insert(profile.to_owned(), next);
        }
        Ok(out)
    }
}

impl fmt::Debug for KeychainTokenStore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("KeychainTokenStore")
            .field("service", &self.keychain.inner.service())
            .finish_non_exhaustive()
    }
}

/// The cached record, read from the keychain on first use.
fn cached<'s>(
    inner: &Inner,
    state: &'s mut State,
    profile: &str,
) -> Result<&'s SessionRecord, Error> {
    if !state.records.contains_key(profile) {
        let record = match inner.read(profile)? {
            Some(bytes) => decode(&bytes)?,
            None => SessionRecord::default(),
        };
        state.records.insert(profile.to_owned(), record);
    }
    Ok(&state.records[profile])
}

/// The `generation` field of the stored entry, ignoring every other field;
/// 0 when there is no entry or not even that can be read.
fn stored_generation(inner: &Inner, profile: &str) -> u64 {
    #[derive(Deserialize)]
    struct GenerationIn {
        generation: u64,
    }
    match inner.read(profile) {
        Ok(Some(bytes)) => serde_json::from_slice::<GenerationIn>(&bytes)
            .map(|r| r.generation)
            .unwrap_or(0),
        _ => 0,
    }
}

#[derive(Serialize)]
struct RecordOut<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    tokens: Option<TokensOut<'a>>,
    generation: u64,
    deactivated: bool,
}

#[derive(Serialize)]
struct TokensOut<'a> {
    access_token: &'a str,
    access_expires_at: &'a str,
    refresh_token: &'a str,
    refresh_expires_at: &'a str,
}

#[derive(Deserialize)]
struct RecordIn {
    #[serde(default)]
    tokens: Option<TokensIn>,
    generation: u64,
    deactivated: bool,
}

#[derive(Deserialize)]
struct TokensIn {
    access_token: String,
    access_expires_at: String,
    refresh_token: String,
    refresh_expires_at: String,
}

/// Fixed-capacity buffer: never reallocates (no unwiped copy) and refuses to
/// grow past [`MAX_RECORD_BYTES`].
struct Bounded(Zeroizing<Vec<u8>>);

impl io::Write for Bounded {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.0.len() + buf.len() > MAX_RECORD_BYTES {
            return Err(io::Error::other("record too large"));
        }
        self.0.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(crate) fn encode(record: &SessionRecord) -> Result<Zeroizing<Vec<u8>>, Error> {
    let out = RecordOut {
        tokens: record.tokens.as_ref().map(|t| TokensOut {
            access_token: t.access_token.expose(),
            access_expires_at: &t.access_expires_at.0,
            refresh_token: t.refresh_token.expose(),
            refresh_expires_at: &t.refresh_expires_at.0,
        }),
        generation: record.generation,
        deactivated: record.deactivated,
    };
    let mut buf = Bounded(Zeroizing::new(Vec::with_capacity(MAX_RECORD_BYTES)));
    serde_json::to_writer(&mut buf, &out).map_err(|_| Error::TooLarge)?;
    Ok(buf.0)
}

/// The serde error is dropped: its text may quote stored data.
pub(crate) fn decode(bytes: &[u8]) -> Result<SessionRecord, Error> {
    let record: RecordIn =
        serde_json::from_slice(bytes).map_err(|_| Error::Malformed("session record"))?;
    Ok(SessionRecord {
        tokens: record.tokens.map(|t| StoredTokens {
            access_token: Secret::new(t.access_token),
            access_expires_at: Timestamp(t.access_expires_at),
            refresh_token: Secret::new(t.refresh_token),
            refresh_expires_at: Timestamp(t.refresh_expires_at),
        }),
        generation: record.generation,
        deactivated: record.deactivated,
    })
}

impl TokenStore for KeychainTokenStore {
    fn identity(&self) -> String {
        format!("keychain:{}", self.keychain.inner.service())
    }

    fn load_record(&self, profile: &str) -> keystone_sync::Result<SessionRecord> {
        Ok(self.read(profile, SessionRecord::clone)?)
    }

    fn load(&self, profile: &str) -> keystone_sync::Result<Option<StoredTokens>> {
        Ok(self.read(profile, |record| record.tokens.clone())?)
    }

    fn save(
        &self,
        _write: &TokenWrite,
        profile: &str,
        tokens: &StoredTokens,
    ) -> keystone_sync::Result<()> {
        Ok(self.update(profile, |record| {
            record.tokens = Some(tokens.clone());
            Ok(())
        })?)
    }

    fn clear(&self, _write: &TokenWrite, profile: &str) -> keystone_sync::Result<()> {
        Ok(self.update(profile, |record| {
            record.tokens = None;
            Ok(())
        })?)
    }

    fn take(
        &self,
        _write: &TokenWrite,
        profile: &str,
    ) -> keystone_sync::Result<Option<StoredTokens>> {
        Ok(self.update(profile, |record| Ok(record.tokens.take()))?)
    }

    fn sign_in(
        &self,
        _write: &TokenWrite,
        profile: &str,
        tokens: &StoredTokens,
    ) -> keystone_sync::Result<u64> {
        Ok(self.update(profile, |record| {
            record.generation = record
                .generation
                .checked_add(1)
                .ok_or(Error::GenerationOverflow)?;
            record.tokens = Some(tokens.clone());
            record.deactivated = false;
            Ok(record.generation)
        })?)
    }

    fn deactivate(
        &self,
        _write: &TokenWrite,
        profile: &str,
        expected_generation: u64,
    ) -> keystone_sync::Result<bool> {
        Ok(self.update(profile, |record| {
            if record.generation != expected_generation {
                return Ok(false);
            }
            record.deactivated = true;
            record.tokens = None;
            Ok(true)
        })?)
    }

    fn sign_out(
        &self,
        _write: &TokenWrite,
        profile: &str,
        expected_generation: u64,
    ) -> keystone_sync::Result<bool> {
        Ok(self.update(profile, |record| {
            if record.generation != expected_generation {
                return Ok(false);
            }
            record.tokens = None;
            Ok(true)
        })?)
    }
}
