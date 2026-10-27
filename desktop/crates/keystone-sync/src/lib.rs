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
//!
//! # External API (the desktop shell)
//!
//! The shell enters the crate through three doors:
//! - [`engine::SyncEngine`]: local reads (`list`, `get`), writes
//!   (`enqueue`, checked against `write_policy`), outbox and Conflict Inbox
//!   work (`outbox_entries`, `retry`, `discard`, `conflict_records`,
//!   `resolve_conflict*`), `sign_out`, status (`status`, `subscribe`,
//!   `subscribe_changes`) and the loop ([`engine::sync_loop`]).
//! - [`auth::Session`]: sign-in (`Session::sign_in`) and the token lock.
//! - [`client::HttpClient`]: device sign-in, server meta and online calls.
//!
//! Plus the plain types they take and return: [`store::Store`]
//! (`open`, retention, specs, snapshots), [`store::DbKey`],
//! [`store::offline_manifest`], [`outbox::NewMutation`], [`wire`] and
//! [`error`].
//!
//! Raw database, outbox and mirror access stays inside the crate, so
//! nothing outside the engine bypasses its access checks or the work seal:
//!
//! ```compile_fail
//! fn raw(store: &keystone_sync::store::Store) {
//!     let _ = store.read(|_| Ok(()));
//! }
//! ```
//!
//! ```compile_fail
//! fn raw(store: &keystone_sync::store::Store) {
//!     let _ = store.write(|_| Ok(()));
//! }
//! ```
//!
//! ```compile_fail
//! fn raw(store: std::sync::Arc<keystone_sync::store::Store>) {
//!     let _ = keystone_sync::outbox::Outbox::new(store);
//! }
//! ```
//!
//! ```compile_fail
//! fn raw(store: std::sync::Arc<keystone_sync::store::Store>) {
//!     let _ = keystone_sync::conflicts::ConflictStore::new(store);
//! }
//! ```
//!
//! ```compile_fail
//! use keystone_sync::store::MirrorStore;
//! ```
//!
//! ```compile_fail
//! fn raw(store: &keystone_sync::store::Store, name: &keystone_sync::wire::ResourceName) {
//!     let _ = store.reset_resource(name);
//! }
//! ```
//!
//! ```compile_fail
//! fn raw(store: &keystone_sync::store::Store, name: &keystone_sync::wire::ResourceName) {
//!     let _ = store.list(name, &keystone_sync::store::ListQuery::default());
//! }
//! ```
//!
//! The crate's own integration tests reach these through `store::raw`,
//! which exists only with the `raw-store` feature (a dev-dependency of the
//! crate on itself turns it on for them).
//!
//! The guarded doors are there (positive control of the blocks above):
//!
//! ```no_run
//! use std::sync::Arc;
//! use keystone_sync::client::HttpClient;
//! use keystone_sync::engine::SyncEngine;
//! use keystone_sync::store::{ListQuery, Store};
//! use keystone_sync::wire::ResourceName;
//! fn shell(client: HttpClient, db: Arc<Store>, name: &ResourceName) {
//!     let engine = SyncEngine::new(client, db.clone());
//!     let _ = engine.list(name, &ListQuery::default());
//!     let _ = engine.write_policy(name);
//!     let _ = engine.outbox_entries();
//!     let _ = db.resource_specs();
//! }
//! ```

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
