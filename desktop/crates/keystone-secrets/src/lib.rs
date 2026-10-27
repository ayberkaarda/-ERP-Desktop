//! OS keychain storage for the desktop shell: the [`TokenStore`] of
//! `keystone-sync` ([`KeychainTokenStore`]), the SQLCipher database key of
//! each server profile ([`DbKeyStore`]) and installation-wide secrets such as
//! the device fingerprint ([`SecretSlot`]).
//!
//! Everything goes through one [`Keychain`]: a keychain service name over a
//! credential store (the platform one from [`Keychain::native`], or any
//! `keyring-core` store, e.g. its in-memory `mock`, from
//! [`Keychain::with_store`]). The process keeps one shared state per service
//! name, so every handle of a service (token store, key store, slot) shares
//! one lock and one cache.
//!
//! Keychain records of a service (the account names):
//! - `<profile id>`: the profile's session record, JSON
//!   `{"tokens"?: {..}, "generation": n, "deactivated": b}`;
//! - `db-key:<profile id>`: the profile's SQLCipher key, 64 hex digits;
//! - `slot:<name>`: an installation-wide secret, 64 hex digits.
//!
//! Profile ids and slot names never contain `:`, so these never collide.
//!
//! # Known limit: no lock across processes
//!
//! The lock covers every handle in one process, not other processes. The
//! keychains offer no compare-and-set, so two processes over the same service
//! could interleave their read-modify-write steps, and each keeps its own cache
//! that does not see the other's writes. The desktop shell closes this gap by
//! running as a single instance (`tauri-plugin-single-instance`); nothing else
//! may open the same service while it runs.

#![forbid(unsafe_code)]

mod db_key;
mod error;
mod hex;
mod keychain;
mod slot;
mod tokens;

pub use db_key::DbKeyStore;
pub use error::Error;
pub use keychain::Keychain;
pub use slot::SecretSlot;
pub use tokens::{KeychainTokenStore, MAX_RECORD_BYTES};

/// The `keyring-core` API (credential store trait, the `mock` store) for
/// callers that build a [`Keychain`] over their own store.
pub use keyring_core;

#[doc(no_inline)]
pub use keystone_sync::auth::TokenStore;
