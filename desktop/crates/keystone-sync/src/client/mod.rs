//! HTTP side of the protocol. [`HttpClient`] (reqwest + rustls) sends
//! `Authorization: Bearer <access token>` and `X-Company-Id` on sync calls,
//! accepts only paths under [`API_PREFIX`] on the profile base URL (https,
//! see [`ServerUrl`]), and turns error bodies into
//! [`SyncError::Api`](crate::error::SyncError::Api) via
//! [`SyncError::from_api`](crate::error::SyncError::from_api).
//!
//! Tokens are read from and written to a [`TokenStore`](crate::auth::TokenStore).
//! Nothing here logs; tokens and bodies never appear in error messages.

use std::future::Future;

use uuid::Uuid;

use crate::error::Result;
use crate::wire::{
    DeviceLoginRequest, DeviceRefreshRequest, DeviceTokenResponse, ManifestResponse, PullRequest,
    PullResponse, PushRequest, PushResponse,
};

mod http;
mod retry_after;
mod url;

pub use http::{ClientOptions, HttpClient, fetch_server_meta};
pub use retry_after::parse_retry_after;
pub use url::ServerUrl;

pub const API_PREFIX: &str = "/api/v1";

/// Endpoint paths, relative to the server base URL.
pub mod paths {
    pub const META: &str = "/api/v1/meta";
    pub const MANIFEST: &str = "/api/v1/sync/manifest";
    pub const PULL: &str = "/api/v1/sync/pull";
    pub const PUSH: &str = "/api/v1/sync/push";
    pub const DEVICE_LOGIN: &str = "/api/v1/auth/device";
    pub const DEVICE_REFRESH: &str = "/api/v1/auth/device/refresh";
}

/// Server profile chosen at runtime (never baked in at build time).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApiConfig {
    /// Scheme and host, without a trailing slash or `/api/v1`.
    pub base_url: String,
    pub company_id: Uuid,
    pub user_agent: String,
}

/// Sync endpoints. Calls need a valid access token; the implementation gets
/// it from [`crate::auth`] and refreshes once on 401 before failing.
pub trait SyncApi: Send + Sync {
    fn manifest(&self) -> impl Future<Output = Result<ManifestResponse>> + Send;

    fn pull(&self, request: &PullRequest) -> impl Future<Output = Result<PullResponse>> + Send;

    fn push(&self, request: &PushRequest) -> impl Future<Output = Result<PushResponse>> + Send;
}

/// Device token endpoints (no bearer token).
pub trait DeviceAuthApi: Send + Sync {
    fn login(
        &self,
        request: &DeviceLoginRequest,
    ) -> impl Future<Output = Result<DeviceTokenResponse>> + Send;

    /// Refresh tokens are single use: callers must not run two refreshes at once.
    /// [`HttpClient`] serializes refreshes itself.
    fn refresh(
        &self,
        request: &DeviceRefreshRequest,
    ) -> impl Future<Output = Result<DeviceTokenResponse>> + Send;
}
