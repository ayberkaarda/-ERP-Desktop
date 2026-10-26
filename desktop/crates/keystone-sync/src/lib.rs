//! Keystone desktop sync engine: encrypted local store, outbox, Conflict
//! Inbox and the push/pull loop against `/api/v1/sync`. No UI code.
//!
//! Module map (each module owns its folder):
//! - [`error`]: `SyncError`, codes equal to the server `ErrorCode`
//! - [`wire`]: types of `contracts/sync`
//! - [`store`]: SQLCipher store, migration registry, generic mirror
//! - [`outbox`], [`conflicts`]: draft writes and user decisions
//! - [`client`], [`auth`]: HTTP endpoints and device tokens
//! - [`backoff`]: retry timing
//! - [`engine`]: the sync loop

#![forbid(unsafe_code)]

pub mod auth;
pub mod backoff;
pub mod client;
pub mod conflicts;
pub mod engine;
pub mod error;
pub mod outbox;
pub mod store;
pub mod wire;

pub use error::{Result, SyncError};
