//! reqwest implementation of [`SyncApi`] and [`DeviceAuthApi`].
//!
//! Refresh rules (the server revokes the whole device when a used refresh
//! token comes back):
//! - Refreshes are single-flight: one `tokio` mutex guards every token read
//!   for a request and every refresh. A caller whose 401 came with an access
//!   token that is no longer current reuses the new one instead of refreshing.
//! - The refresh token leaves the [`TokenStore`] *before* it is sent. It is put
//!   back only when the server provably did not consume it (connection never
//!   established, or a 4xx other than 401/403, or 503). A lost response
//!   (timeout, dropped connection, unreadable 2xx, other 5xx) leaves the
//!   store empty: the token is treated as spent, the call fails with
//!   `UNAUTHENTICATED` and the user signs in again (the outbox is kept). A
//!   crash mid-refresh ends the same way. The same refresh token is never
//!   sent twice.
//! - A 401 on a sync call triggers at most one refresh and one retry.
//! - 403 `USER_DEACTIVATED` on any call clears the tokens and is returned as
//!   is (`Code::Server(ErrorCode::UserDeactivated)`); the engine wipes data.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderValue, RETRY_AFTER};
use reqwest::{Method, Url};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::auth::{Secret, StoredTokens, TokenStore};
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
    profile: String,
    tokens: Arc<T>,
    /// Single-flight gate for token reads and refreshes.
    gate: tokio::sync::Mutex<()>,
}

impl<T> std::fmt::Debug for HttpClient<T> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HttpClient")
            .field("server", &self.server.origin())
            .field("profile", &self.profile)
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

impl<T: TokenStore> HttpClient<T> {
    /// `profile` is the [`TokenStore`] key of this server profile.
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
            profile: profile.into(),
            tokens,
            gate: tokio::sync::Mutex::new(()),
        })
    }

    pub fn server(&self) -> &ServerUrl {
        &self.server
    }

    /// `GET /api/v1/meta` (public).
    pub async fn server_meta(&self) -> Result<ServerMetaResponse> {
        let url = self.server.endpoint(paths::META)?;
        let raw = send(&self.http, Method::GET, url, None, None, None).await?;
        decode(&raw)
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
        self.finish(&raw)
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

    /// Decodes a final response; 403 `USER_DEACTIVATED` clears the tokens.
    fn finish<Resp: DeserializeOwned>(&self, raw: &RawResponse) -> Result<Resp> {
        let result = decode(raw);
        if let Err(SyncError::Api {
            code: ErrorCode::UserDeactivated,
            ..
        }) = &result
        {
            // Best effort: the error itself already tells the engine to wipe.
            let _ = self.tokens.clear(&self.profile);
        }
        result
    }

    fn load(&self) -> Result<Option<StoredTokens>> {
        self.tokens.load(&self.profile)
    }

    /// Access token, waiting for a refresh in flight.
    async fn current_access(&self) -> Result<Secret> {
        let _gate = self.gate.lock().await;
        self.load()?
            .map(|tokens| tokens.access_token)
            .ok_or_else(|| sign_in_required("not signed in"))
    }

    async fn refresh_after_unauthorized(&self, rejected: &Secret) -> Result<Secret> {
        let _gate = self.gate.lock().await;
        let current = self
            .load()?
            .ok_or_else(|| sign_in_required("not signed in"))?;
        if current.access_token != *rejected {
            // Another caller refreshed while this request was in flight.
            return Ok(current.access_token);
        }
        let refresh = current.refresh_token.clone();
        let response = self.rotate_locked(&refresh, Some(current)).await?;
        Ok(Secret::new(response.data.token))
    }

    /// Sends one refresh. The caller holds `gate`. `taken` is the stored pair
    /// when `refresh` came from the store; it is removed before sending.
    async fn rotate_locked(
        &self,
        refresh: &Secret,
        taken: Option<StoredTokens>,
    ) -> Result<DeviceTokenResponse> {
        let url = self.server.endpoint(paths::DEVICE_REFRESH)?;
        let body = serde_json::to_vec(&DeviceRefreshRequest {
            refresh_token: refresh.expose().to_owned(),
        })?;
        if taken.is_some() {
            self.tokens.clear(&self.profile)?;
        }
        let restore = |tokens: &Option<StoredTokens>| -> Result<()> {
            match tokens {
                Some(tokens) => self.tokens.save(&self.profile, tokens),
                None => Ok(()),
            }
        };

        let raw = match send(&self.http, Method::POST, url, Some(body), None, None).await {
            Ok(raw) => raw,
            Err(Transport::NotSent(e)) => {
                restore(&taken)?;
                return Err(SyncError::Network(e.to_string()));
            }
            Err(Transport::Lost(_)) => {
                return Err(sign_in_required(
                    "refresh response was lost; the refresh token is spent, sign in again",
                ));
            }
        };
        if raw.is_success() {
            let response = decode_token(&raw)?;
            self.tokens
                .save(&self.profile, &StoredTokens::from(response.data.clone()))?;
            return Ok(response);
        }
        let error = decode::<DeviceTokenResponse>(&raw)
            .err()
            .unwrap_or_else(|| sign_in_required("refresh failed"));
        if refresh_not_consumed(raw.status) {
            restore(&taken)?;
        }
        Err(error)
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
    /// Saves the new tokens on success. 401 `TWO_FACTOR_REQUIRED` and 422
    /// `INVALID_TWO_FACTOR_CODE` come back as `SyncError::Api`; resend with
    /// `two_factor_code`. A lost login response is harmless: logging in
    /// again with the same fingerprint replaces the device.
    async fn login(&self, request: &DeviceLoginRequest) -> Result<DeviceTokenResponse> {
        let url = self.server.endpoint(paths::DEVICE_LOGIN)?;
        let body = serde_json::to_vec(request)?;
        let raw = send(&self.http, Method::POST, url, Some(body), None, None).await?;
        if !raw.is_success() {
            return decode(&raw);
        }
        let response = decode_token(&raw)?;
        let _gate = self.gate.lock().await;
        self.tokens
            .save(&self.profile, &StoredTokens::from(response.data.clone()))?;
        Ok(response)
    }

    /// Serialized with the automatic refresh. When `request` carries the
    /// stored refresh token, the store follows the rules in the module docs;
    /// either way a successful refresh is saved.
    async fn refresh(&self, request: &DeviceRefreshRequest) -> Result<DeviceTokenResponse> {
        let _gate = self.gate.lock().await;
        let refresh = Secret::new(request.refresh_token.clone());
        let taken = self
            .load()?
            .filter(|stored| stored.refresh_token == refresh);
        self.rotate_locked(&refresh, taken).await
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

/// A refresh answered with this status left the token unused on the server.
/// 401/403: the token (or user) is gone anyway. 5xx other than 503: the
/// request may have been processed before the failure.
fn refresh_not_consumed(status: u16) -> bool {
    matches!(status, 400..=499 if status != 401 && status != 403) || status == 503
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
