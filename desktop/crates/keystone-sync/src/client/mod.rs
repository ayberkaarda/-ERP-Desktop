//! HTTP side of the protocol. [`HttpClient`] (reqwest + rustls) sends
//! `Authorization: Bearer <access token>` and `X-Company-Id` on sync calls,
//! accepts only paths under [`API_PREFIX`] on the profile base URL (https,
//! see [`ServerUrl`]), and turns error bodies into
//! [`SyncError::Api`](crate::error::SyncError::Api) via
//! [`SyncError::from_api`](crate::error::SyncError::from_api).
//!
//! [`HttpClient::proxy`] carries any other `/api/v1` request of the UI
//! (paths the client calls itself are refused).
//!
//! Tokens are read from and written to a [`TokenStore`](crate::auth::TokenStore).
//! Nothing here logs; tokens and bodies never appear in error messages.

use std::future::Future;
use std::sync::Arc;

use uuid::Uuid;

use crate::auth::Session;
use crate::error::Result;
use crate::wire::{
    DeviceLoginRequest, DeviceRefreshRequest, DeviceTokenResponse, ManifestResponse, PullRequest,
    PullResponse, PushRequest, PushResponse,
};

mod http;
mod retry_after;
mod url;

/// Seals [`SyncApi`]: the supertrait is reachable only inside the crate.
pub(crate) mod sealed {
    pub trait Sealed {}
}

pub use http::{
    ClientOptions, HttpClient, PROXY_BODY_LIMIT, ProxyMethod, ProxyRequest, ProxyResponse,
    REQUEST_HEADERS, RESPONSE_HEADERS, fetch_server_meta,
};
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
///
/// Sealed: only this crate implements it ([`HttpClient`], and test fakes
/// inside the crate). The contract every implementation keeps, and that
/// the engine relies on: [`SyncApi::session`] returns the same
/// [`Session`] for the whole life of the client, and every call of the
/// client (sync, refresh, login) reads and writes tokens through that
/// session and no other. Outside the crate the trait can be used as a
/// bound but not implemented, so no other session can be smuggled in.
///
/// The generation-bound calls (`*_in`) and [`SyncApi::session`] have no
/// default: an implementation must decide how it keeps a call to its
/// sign-in generation, and name the session it works in.
///
/// ```compile_fail
/// use keystone_sync::client::SyncApi;
/// use keystone_sync::error::Result;
/// use keystone_sync::wire::{ManifestResponse, PullRequest, PullResponse, PushRequest, PushResponse};
/// struct Plain;
/// impl SyncApi for Plain {
///     async fn manifest(&self) -> Result<ManifestResponse> { unimplemented!() }
///     async fn pull(&self, _: &PullRequest) -> Result<PullResponse> { unimplemented!() }
///     async fn push(&self, _: &PushRequest) -> Result<PushResponse> { unimplemented!() }
/// }
/// ```
///
/// ```compile_fail
/// use keystone_sync::client::SyncApi;
/// use keystone_sync::error::Result;
/// use keystone_sync::wire::{ManifestResponse, PullRequest, PullResponse, PushRequest, PushResponse};
/// struct NoSession;
/// impl SyncApi for NoSession {
///     async fn manifest(&self) -> Result<ManifestResponse> { unimplemented!() }
///     async fn pull(&self, _: &PullRequest) -> Result<PullResponse> { unimplemented!() }
///     async fn push(&self, _: &PushRequest) -> Result<PushResponse> { unimplemented!() }
///     async fn manifest_in(&self, _: u64) -> Result<ManifestResponse> { unimplemented!() }
///     async fn pull_in(&self, _: &PullRequest, _: u64) -> Result<PullResponse> { unimplemented!() }
///     async fn push_in(&self, _: &PushRequest, _: u64) -> Result<PushResponse> { unimplemented!() }
/// }
/// ```
///
/// ```compile_fail
/// use std::sync::Arc;
/// use keystone_sync::auth::Session;
/// use keystone_sync::client::SyncApi;
/// use keystone_sync::error::Result;
/// use keystone_sync::wire::{ManifestResponse, PullRequest, PullResponse, PushRequest, PushResponse};
/// struct Bound(Arc<Session>);
/// impl SyncApi for Bound {
///     fn session(&self) -> &Arc<Session> { &self.0 }
///     async fn manifest(&self) -> Result<ManifestResponse> { unimplemented!() }
///     async fn pull(&self, _: &PullRequest) -> Result<PullResponse> { unimplemented!() }
///     async fn push(&self, _: &PushRequest) -> Result<PushResponse> { unimplemented!() }
///     async fn manifest_in(&self, _: u64) -> Result<ManifestResponse> { unimplemented!() }
///     async fn pull_in(&self, _: &PullRequest, _: u64) -> Result<PullResponse> { unimplemented!() }
///     async fn push_in(&self, _: &PushRequest, _: u64) -> Result<PushResponse> { unimplemented!() }
/// }
/// ```
///
/// As a bound it is usable (positive control of the blocks above):
///
/// ```no_run
/// use keystone_sync::client::{HttpClient, SyncApi};
/// fn session_of<A: SyncApi>(api: &A) -> String { api.session().profile().to_owned() }
/// fn with_client(client: &HttpClient) -> String { session_of(client) }
/// ```
pub trait SyncApi: sealed::Sealed + Send + Sync {
    /// The profile session the client works in (its token store handle,
    /// profile id, token lock and sign-in gate): fixed for the life of the
    /// client, and the one all its calls use. The engine of the client is
    /// built over this same session ([`crate::engine::SyncEngine::new`]).
    fn session(&self) -> &Arc<Session>;

    /// Company every request of this client is scoped to. A
    /// `COMPANY_FORBIDDEN` answer removes local data only when it belongs to
    /// this company; `None` (scope unknown) never removes any.
    fn company_id(&self) -> Option<Uuid> {
        None
    }

    fn manifest(&self) -> impl Future<Output = Result<ManifestResponse>> + Send;

    fn pull(&self, request: &PullRequest) -> impl Future<Output = Result<PullResponse>> + Send;

    fn push(&self, request: &PushRequest) -> impl Future<Output = Result<PushResponse>> + Send;

    /// [`SyncApi::manifest`] bound to a sign-in generation
    /// ([`crate::auth::SessionRecord::generation`]): sent only with tokens of
    /// `generation` (a refresh keeps it); after another sign-in it fails
    /// with `UNAUTHENTICATED` without sending anything. Required: there is
    /// no default that could ignore the generation.
    fn manifest_in(&self, generation: u64)
    -> impl Future<Output = Result<ManifestResponse>> + Send;

    /// [`SyncApi::pull`] bound to a sign-in generation (see [`SyncApi::manifest_in`]).
    fn pull_in(
        &self,
        request: &PullRequest,
        generation: u64,
    ) -> impl Future<Output = Result<PullResponse>> + Send;

    /// [`SyncApi::push`] bound to a sign-in generation (see [`SyncApi::manifest_in`]).
    fn push_in(
        &self,
        request: &PushRequest,
        generation: u64,
    ) -> impl Future<Output = Result<PushResponse>> + Send;
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
