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
//! - [`engine::SyncEngine`]: local reads (`list`, `get`, `snapshot`),
//!   writes (`enqueue`, checked against `write_policy`; `put_snapshot`,
//!   bound to the sign-in generation of the answer), outbox and Conflict
//!   Inbox work (`outbox_entries`, `retry`, `discard`, `conflict_records`,
//!   `resolve_conflict*`), `prune`, `sign_out`, status (`status`,
//!   `subscribe`, `subscribe_changes`) and the loop ([`engine::sync_loop`]).
//! - [`auth::Session`]: sign-in (`Session::sign_in`), the token lock and
//!   `forget_tokens` (drops the tokens of one generation, keeps the data).
//! - [`client::HttpClient`]: device sign-in, server meta, online calls and
//!   `change_password`.
//!
//! Plus the plain types they take and return: [`store::Store`]
//! (`open`, retention policy, specs, `local_copy`), [`store::DbKey`],
//! [`store::offline_manifest`], [`outbox::NewMutation`], [`wire`] and
//! [`error`].
//!
//! Raw database, outbox and mirror access stays inside the crate, so
//! nothing outside the engine bypasses its access checks or the work seal:
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store) {
//!     let _ = store.read(|_| Ok::<(), keystone_sync::SyncError>(()));
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store) {
//!     let _ = store.write(|_| Ok::<(), keystone_sync::SyncError>(()));
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: std::sync::Arc<keystone_sync::store::Store>) {
//!     let _ = keystone_sync::outbox::Outbox::new(store);
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: std::sync::Arc<keystone_sync::store::Store>) {
//!     let _ = keystone_sync::conflicts::ConflictStore::new(store);
//! }
//! ```
//!
//! ```compile_fail,E0603
//! use keystone_sync::store::MirrorStore;
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store, name: &keystone_sync::wire::ResourceName) {
//!     let _ = store.reset_resource(name);
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store, name: &keystone_sync::wire::ResourceName) {
//!     let _ = store.list(name, &keystone_sync::store::ListQuery::default());
//! }
//! ```
//!
//! Snapshots, resource registration and retention pruning are engine work
//! too (verified sign-in, work seal, generation of the answer):
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store, name: &keystone_sync::wire::ResourceName) {
//!     let _ = store.snapshot(name);
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store, name: &keystone_sync::wire::ResourceName) {
//!     let at = keystone_sync::wire::Timestamp("2026-10-26T09:30:00+03:00".into());
//!     let _ = store.put_snapshot(name, &serde_json::Value::Null, &at);
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store, name: &keystone_sync::wire::ResourceName) {
//!     let _ = store.remove_snapshot(name);
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store) {
//!     let _ = store.snapshot_resources();
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store, name: keystone_sync::wire::ResourceName) {
//!     let _ = store.register(&keystone_sync::store::ResourceSpec::new(name));
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store, name: keystone_sync::wire::ResourceName) {
//!     let _ = store.register_all(&[keystone_sync::store::ResourceSpec::new(name)]);
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store) {
//!     let _ = store.prune();
//! }
//! ```
//!
//! ```compile_fail,E0624
//! fn raw(store: &keystone_sync::store::Store) {
//!     let _ = store.prune_at("2026-10-26");
//! }
//! ```
//!
//! The crate's own integration tests reach these through `store::raw`,
//! which exists only with the `raw-store` feature (a dev-dependency of the
//! crate on itself turns it on for them).
//!
//! The error codes on the blocks above (E0624 private method or function,
//! E0603 private item) are checked by nightly rustdoc only; on stable the
//! control below compiles every path and type they use, so a block cannot
//! fail for a misspelt name instead of privacy.
//!
//! The guarded doors are there (positive control of the blocks above):
//!
//! ```no_run
//! use std::sync::Arc;
//! use keystone_sync::client::HttpClient;
//! use keystone_sync::engine::SyncEngine;
//! use keystone_sync::store::{ListQuery, ResourceSpec, Store};
//! use keystone_sync::wire::{ResourceName, Timestamp};
//! fn shell(client: HttpClient, db: Arc<Store>, name: &ResourceName) {
//!     let _ = ResourceSpec::new(name.clone());
//!     let engine = SyncEngine::new(client, db.clone());
//!     let _ = engine.list(name, &ListQuery::default());
//!     let _ = engine.write_policy(name);
//!     let _ = engine.outbox_entries();
//!     let _ = engine.snapshot(name);
//!     let at = Timestamp("2026-10-26T09:30:00+03:00".into());
//!     let _ = engine.put_snapshot(name, &serde_json::Value::Null, &at, 1);
//!     let _ = engine.prune();
//!     let _ = db.used_bytes();
//!     let _ = db.resource_specs();
//!     let _ = db.local_copy(name);
//!     let _: Option<keystone_sync::outbox::Outbox> = None;
//!     let _: Option<keystone_sync::conflicts::ConflictStore> = None;
//!     let _: keystone_sync::Result<()> = Ok::<(), keystone_sync::SyncError>(());
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
