//! reqwest implementation of [`SyncApi`] and [`DeviceAuthApi`].
//!
//! Refresh rules (the server revokes the whole device when a used refresh
//! token comes back):
//! - Single flight per profile: all clients of one token store + profile
//!   share one [`Session`] (lock, generation, deactivation flag). A caller
//!   whose 401 came with an access token that is no longer current reuses
//!   the new one instead of refreshing.
//! - The refresh token is taken out of the [`TokenStore`] atomically
//!   ([`TokenStore::take`]) before it is sent. It is put back only when the
//!   connection was never established. Every other outcome (timeout,
//!   dropped connection, any HTTP status, unreadable 2xx) treats it as spent:
//!   the store stays empty and the call fails with `UNAUTHENTICATED`, so the
//!   user signs in again (the outbox is kept). A crash mid-refresh ends the
//!   same way. An explicit [`DeviceAuthApi::refresh`] only sends the token
//!   that is currently stored; a spent or foreign token is refused unsent.
//! - A 401 on a sync call triggers at most one refresh and one retry.
//! - 403 `USER_DEACTIVATED` from any call (sync, refresh, login, meta) marks
//!   the session deactivated, then clears the tokens under the session lock.
//!   A refresh answer arriving after the mark is not saved. Until the next
//!   successful sign-in, sync calls fail locally with `USER_DEACTIVATED`.
//!   A failed cleanup is returned as `TOKEN_STORE_ERROR`.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderValue, RETRY_AFTER};
use reqwest::{Method, Url};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::auth::{Secret, Session, StoredTokens, TokenStore};
use crate::error::{Result, SyncError};
use crate::wire::{
    ApiError, DeviceLoginRequest, DeviceRefreshRequest, DeviceTokenResponse, ErrorCode,
    ErrorResponse, ManifestResponse, PullRequest, PullResponse, PushRequest, PushResponse,
    ServerMetaResponse,
};

use super::retry_after::parse_retry_after;
use super::url::ServerUrl;
use super::{ApiConfig, DeviceAuthApi, SyncApi, paths};

const COMPANY_HEADER: &str = "x-company-id";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientOptions {
    pub connect_timeout: Duration,
    /// Whole request, including reading the body.
    pub request_timeout: Duration,
    /// Accept `http://localhost` / loopback base URLs. Tests only.
    pub allow_http_localhost: bool,
}

impl Default for ClientOptions {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(10),
            request_timeout: Duration::from_secs(60),
            allow_http_localhost: false,
        }
    }
}

/// HTTP client of one server profile.
pub struct HttpClient<T> {
    http: reqwest::Client,
    server: ServerUrl,
    company_id: HeaderValue,
    session: Arc<Session<T>>,
}

impl<T> std::fmt::Debug for HttpClient<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpClient")
            .field("server", &self.server.origin())
            .field("session", &self.session)
            .finish_non_exhaustive()
    }
}

struct RawResponse {
    status: u16,
    retry_after: Option<Duration>,
    body: Vec<u8>,
}

impl RawResponse {
    fn is_success(&self) -> bool {
        (200..300).contains(&self.status)
    }
}

enum Transport {
    /// No connection was made: the server never saw the request.
    NotSent(reqwest::Error),
    /// The request may have reached the server; the outcome is unknown.
    Lost(reqwest::Error),
}

impl From<Transport> for SyncError {
    fn from(error: Transport) -> Self {
        match error {
            Transport::NotSent(e) | Transport::Lost(e) => SyncError::Network(e.to_string()),
        }
    }
}

impl<T: TokenStore + 'static> HttpClient<T> {
    /// `profile` is the [`TokenStore`] key of this server profile. Clients
    /// built with the same `tokens` (same `Arc`) and profile share a session.
    pub fn new(
        config: &ApiConfig,
        profile: impl Into<String>,
        tokens: Arc<T>,
        options: &ClientOptions,
    ) -> Result<Self> {
        let server = ServerUrl::parse(&config.base_url, options.allow_http_localhost)?;
        let company_id = HeaderValue::from_str(&config.company_id.to_string())
            .map_err(|e| SyncError::InvalidServerUrl(e.to_string()))?;
        Ok(Self {
            http: build_http(&config.user_agent, options)?,
            server,
            company_id,
            session: Session::shared(&profile.into(), &tokens),
        })
    }
}

impl<T: TokenStore> HttpClient<T> {
    pub fn server(&self) -> &ServerUrl {
        &self.server
    }

    pub fn session(&self) -> &Arc<Session<T>> {
        &self.session
    }

    fn store(&self) -> &T {
        self.session.store()
    }

    fn profile(&self) -> &str {
        self.session.profile()
    }

    /// `GET /api/v1/meta` (public).
    pub async fn server_meta(&self) -> Result<ServerMetaResponse> {
        let generation = self.session.generation();
        let result = async {
            let url = self.server.endpoint(paths::META)?;
            let raw = send(&self.http, Method::GET, url, None, None, None).await?;
            decode(&raw)
        }
        .await;
        self.settle(result, generation).await
    }

    /// Sync call with bearer token, one refresh + retry on 401.
    async fn authorized<Req, Resp>(
        &self,
        method: Method,
        path: &str,
        body: Option<&Req>,
    ) -> Result<Resp>
    where
        Req: Serialize + Sync,
        Resp: DeserializeOwned,
    {
        if self.session.is_deactivated() {
            return Err(deactivated());
        }
        let generation = self.session.generation();
        let result = async {
            let url = self.server.endpoint(path)?;
            let body = body.map(serde_json::to_vec).transpose()?;
            let access = self.current_access().await?;
            let mut raw = self
                .send_authorized(method.clone(), url.clone(), body.clone(), &access)
                .await?;
            if raw.status == 401 {
                let fresh = self.refresh_after_unauthorized(&access).await?;
                raw = self.send_authorized(method, url, body, &fresh).await?;
            }
            decode(&raw)
        }
        .await;
        self.settle(result, generation).await
    }

    async fn send_authorized(
        &self,
        method: Method,
        url: Url,
        body: Option<Vec<u8>>,
        access: &Secret,
    ) -> Result<RawResponse> {
        let bearer = HeaderValue::from_str(&format!("Bearer {}", access.expose()))
            .map(|mut value| {
                value.set_sensitive(true);
                value
            })
            .map_err(|_| sign_in_required("stored access token is not a valid header value"))?;
        Ok(send(
            &self.http,
            method,
            url,
            body,
            Some(bearer),
            Some(self.company_id.clone()),
        )
        .await?)
    }

    /// The one place that reacts to `USER_DEACTIVATED`. `generation` is the
    /// session generation when the call started: a deactivation answered to
    /// a call older than the last sign-in is reported but changes nothing.
    async fn settle<R>(&self, result: Result<R>, generation: u64) -> Result<R> {
        let error = match result {
            Err(
                error @ SyncError::Api {
                    code: ErrorCode::UserDeactivated,
                    ..
                },
            ) => error,
            other => return other,
        };
        if !self.session.mark_deactivated(generation) {
            return Err(error);
        }
        let _gate = self.session.lock().await;
        if !self.session.is_deactivated() {
            return Err(error);
        }
        match self.store().clear(self.profile()) {
            Ok(()) => Err(error),
            Err(clear) => Err(SyncError::TokenStore(format!(
                "clearing tokens after USER_DEACTIVATED failed: {clear}"
            ))),
        }
    }

    /// Access token, waiting for a refresh in flight.
    async fn current_access(&self) -> Result<Secret> {
        let _gate = self.session.lock().await;
        if self.session.is_deactivated() {
            return Err(deactivated());
        }
        self.store()
            .load(self.profile())?
            .map(|tokens| tokens.access_token.clone())
            .ok_or_else(|| sign_in_required("not signed in"))
    }

    async fn refresh_after_unauthorized(&self, rejected: &Secret) -> Result<Secret> {
        let _gate = self.session.lock().await;
        if self.session.is_deactivated() {
            return Err(deactivated());
        }
        let current = self
            .store()
            .load(self.profile())?
            .ok_or_else(|| sign_in_required("not signed in"))?;
        if current.access_token != *rejected {
            // Another caller refreshed while this request was in flight.
            return Ok(current.access_token.clone());
        }
        let taken = self
            .store()
            .take(self.profile())?
            .ok_or_else(|| sign_in_required("not signed in"))?;
        let response = self.rotate_locked(taken).await?;
        Ok(Secret::new(response.data.token.clone()))
    }

    /// Sends one refresh with `taken`, already removed from the store. The
    /// caller holds the session lock.
    async fn rotate_locked(&self, taken: StoredTokens) -> Result<DeviceTokenResponse> {
        let url = self.server.endpoint(paths::DEVICE_REFRESH)?;
        let request = DeviceRefreshRequest {
            refresh_token: taken.refresh_token.expose().to_owned(),
        };
        let body = serde_json::to_vec(&request)?;
        drop(request);

        let raw = match send(&self.http, Method::POST, url, Some(body), None, None).await {
            Ok(raw) => raw,
            Err(Transport::NotSent(e)) => {
                if !self.session.is_deactivated() {
                    self.store().save(self.profile(), &taken)?;
                }
                return Err(SyncError::Network(e.to_string()));
            }
            Err(Transport::Lost(_)) => {
                return Err(sign_in_required(
                    "refresh outcome unknown (no answer); the refresh token is spent, sign in again",
                ));
            }
        };
        if !raw.is_success() {
            let error = decode::<()>(&raw)
                .err()
                .unwrap_or_else(|| sign_in_required("refresh failed"));
            if matches!(
                error,
                SyncError::Api {
                    code: ErrorCode::UserDeactivated,
                    ..
                }
            ) {
                return Err(error);
            }
            return Err(sign_in_required(&format!(
                "refresh answered HTTP {} ({}); the refresh token is spent, sign in again",
                raw.status,
                error.code()
            )));
        }
        let response = decode_token(&raw).map_err(|_| {
            sign_in_required("refresh answer unreadable; the refresh token is spent, sign in again")
        })?;
        if self.session.is_deactivated() {
            return Err(deactivated());
        }
        self.store()
            .save(self.profile(), &StoredTokens::from(response.data.clone()))?;
        Ok(response)
    }
}

impl<T: TokenStore> SyncApi for HttpClient<T> {
    async fn manifest(&self) -> Result<ManifestResponse> {
        self.authorized::<(), _>(Method::GET, paths::MANIFEST, None)
            .await
    }

    async fn pull(&self, request: &PullRequest) -> Result<PullResponse> {
        self.authorized(Method::POST, paths::PULL, Some(request))
            .await
    }

    async fn push(&self, request: &PushRequest) -> Result<PushResponse> {
        self.authorized(Method::POST, paths::PUSH, Some(request))
            .await
    }
}

impl<T: TokenStore> DeviceAuthApi for HttpClient<T> {
    /// Saves the new tokens on success and starts a new session generation
    /// (clears a deactivation mark). 401 `TWO_FACTOR_REQUIRED` and 422
    /// `INVALID_TWO_FACTOR_CODE` come back as `SyncError::Api`; resend with
    /// `two_factor_code`. A lost login response is harmless: logging in
    /// again with the same fingerprint replaces the device.
    async fn login(&self, request: &DeviceLoginRequest) -> Result<DeviceTokenResponse> {
        let generation = self.session.generation();
        let result = async {
            let url = self.server.endpoint(paths::DEVICE_LOGIN)?;
            let body = serde_json::to_vec(request)?;
            let raw = send(&self.http, Method::POST, url, Some(body), None, None).await?;
            if !raw.is_success() {
                return decode(&raw);
            }
            let response = decode_token(&raw)?;
            let _gate = self.session.lock().await;
            self.store()
                .save(self.profile(), &StoredTokens::from(response.data.clone()))?;
            self.session.signed_in();
            Ok(response)
        }
        .await;
        self.settle(result, generation).await
    }

    /// Serialized with the automatic refresh. Only the refresh token that is
    /// currently stored is sent (taken out of the store first); any other
    /// token, including one already spent, is refused without a request.
    async fn refresh(&self, request: &DeviceRefreshRequest) -> Result<DeviceTokenResponse> {
        let generation = self.session.generation();
        let result = async {
            let _gate = self.session.lock().await;
            if self.session.is_deactivated() {
                return Err(deactivated());
            }
            let current = self
                .store()
                .load(self.profile())?
                .is_some_and(|stored| stored.refresh_token.expose() == request.refresh_token);
            if !current {
                return Err(sign_in_required(
                    "refresh token is not the current one; it was not sent",
                ));
            }
            let taken = self
                .store()
                .take(self.profile())?
                .ok_or_else(|| sign_in_required("not signed in"))?;
            self.rotate_locked(taken).await
        }
        .await;
        self.settle(result, generation).await
    }
}

/// `GET /api/v1/meta` before a profile exists (no tokens involved).
pub async fn fetch_server_meta(
    base_url: &str,
    user_agent: &str,
    options: &ClientOptions,
) -> Result<ServerMetaResponse> {
    let server = ServerUrl::parse(base_url, options.allow_http_localhost)?;
    let http = build_http(user_agent, options)?;
    let raw = send(
        &http,
        Method::GET,
        server.endpoint(paths::META)?,
        None,
        None,
        None,
    )
    .await?;
    decode(&raw)
}

fn build_http(user_agent: &str, options: &ClientOptions) -> Result<reqwest::Client> {
    // `rustls-no-provider`: use ring. Fails harmlessly when a provider is
    // already installed for the process.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::Client::builder()
        .user_agent(user_agent)
        .connect_timeout(options.connect_timeout)
        .timeout(options.request_timeout)
        // A redirect could move the bearer token to another origin or to http.
        .redirect(reqwest::redirect::Policy::none())
        .https_only(!options.allow_http_localhost);
    if options.allow_http_localhost {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|e| SyncError::Network(e.to_string()))
}

async fn send(
    http: &reqwest::Client,
    method: Method,
    url: Url,
    body: Option<Vec<u8>>,
    bearer: Option<HeaderValue>,
    company: Option<HeaderValue>,
) -> std::result::Result<RawResponse, Transport> {
    let mut request = http
        .request(method, url)
        .header(ACCEPT, HeaderValue::from_static("application/json"));
    if let Some(bearer) = bearer {
        request = request.header(AUTHORIZATION, bearer);
    }
    if let Some(company) = company {
        request = request.header(COMPANY_HEADER, company);
    }
    if let Some(body) = body {
        request = request
            .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
            .body(body);
    }
    let response = request.send().await.map_err(|e| {
        if e.is_connect() || e.is_builder() {
            Transport::NotSent(e)
        } else {
            Transport::Lost(e)
        }
    })?;
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get(RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_retry_after(value, SystemTime::now()));
    let body = response.bytes().await.map_err(Transport::Lost)?.to_vec();
    Ok(RawResponse {
        status,
        retry_after,
        body,
    })
}

/// 2xx: the body as `R`. Otherwise the error envelope through
/// [`SyncError::from_api`]; a body that is not an error envelope (proxy
/// page, empty body) becomes a code chosen by status.
fn decode<R: DeserializeOwned>(raw: &RawResponse) -> Result<R> {
    if raw.is_success() {
        return Ok(serde_json::from_slice(&raw.body)?);
    }
    let error = match serde_json::from_slice::<ErrorResponse>(&raw.body) {
        Ok(body) => body.errors,
        Err(_) => ApiError {
            message: format!("HTTP {}", raw.status),
            code: code_for_status(raw.status),
            fields: None,
        },
    };
    Err(SyncError::from_api(raw.status, error, raw.retry_after))
}

/// Token bodies: a decode error must not echo token text.
fn decode_token(raw: &RawResponse) -> Result<DeviceTokenResponse> {
    serde_json::from_slice(&raw.body).map_err(|_| {
        SyncError::Decode(<serde_json::Error as serde::de::Error>::custom(
            "device token response is malformed",
        ))
    })
}

fn code_for_status(status: u16) -> ErrorCode {
    match status {
        401 => ErrorCode::Unauthenticated,
        403 => ErrorCode::Forbidden,
        404 => ErrorCode::NotFound,
        405 => ErrorCode::MethodNotAllowed,
        429 => ErrorCode::TooManyAttempts,
        500..=599 => ErrorCode::ServerError,
        _ => ErrorCode::HttpError,
    }
}

/// Local stand-in for a 401: the engine moves to `AuthRequired`.
fn sign_in_required(message: &str) -> SyncError {
    SyncError::Api {
        status: 401,
        code: ErrorCode::Unauthenticated,
        message: message.to_owned(),
        fields: BTreeMap::new(),
        retry_after: None,
    }
}

/// Local stand-in for 403 `USER_DEACTIVATED` once the session is marked.
fn deactivated() -> SyncError {
    SyncError::Api {
        status: 403,
        code: ErrorCode::UserDeactivated,
        message: "account deactivated".to_owned(),
        fields: BTreeMap::new(),
        retry_after: None,
    }
}
