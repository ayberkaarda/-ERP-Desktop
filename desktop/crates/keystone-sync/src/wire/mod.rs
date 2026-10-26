//! Sync wire types, one-to-one with `contracts/sync/*.schema.json`.
//!
//! `from_schema` is written by `desktop/scripts/gen-wire.sh`; the rest is
//! hand-written serde. Every fixture in `contracts/sync/fixtures` is
//! validated against its schema and round-tripped through these types
//! (`tests/wire_fixtures.rs`).
//!
//! Optional nullable properties use `Option<Option<T>>` so an explicit
//! `null` survives a round trip.
//!
//! Forward compatibility: response types ignore unknown fields and an
//! unknown `errors.code` decodes to `ErrorCode::Unknown`. Request types keep
//! `deny_unknown_fields` (they are only written by this client).

mod common;
mod device;
mod from_schema;
mod manifest;
mod meta;
mod pull;
mod push;
pub mod serde_util;

pub use common::{
    ApiError, CommonSamples, Cursor, ErrorResponse, Meta, Permission, Requires, ResourceName,
    ResourceRow, SchemaVersion, Scope, Timestamp, VisibilityGeneration, Xid8,
};
pub use device::{DeviceLoginRequest, DeviceRefreshRequest, DeviceToken, DeviceTokenResponse};
pub use from_schema::{ErrorCode, SCHEMA_DIGESTS};
pub use manifest::{
    Limits, Manifest, ManifestResource, ManifestResponse, ReadMode, Source, WriteCapability,
};
pub use meta::{DesktopMeta, ReverbMeta, ServerMeta, ServerMetaResponse, SyncMeta};
pub use pull::{
    PullData, PullRequest, PullResource, PullResourceResult, PullResponse, ResetReason, Tombstone,
    TombstoneReason,
};
pub use push::{
    Conflict, ConflictChoice, ConflictCode, Mutation, MutationOp, PushData, PushRequest,
    PushResponse, PushResult, PushStatus, Resolution, ResolutionChoice, ResolutionCode,
};

/// Wire `schema_version` this client speaks.
pub const SCHEMA_VERSION: SchemaVersion = 1;
