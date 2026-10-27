//! reqwest implementation of [`SyncApi`] and [`DeviceAuthApi`].
//!
//! Refresh rules (the server revokes the whole device when a used refresh
//! token comes back):
//! - Single flight per profile: all clients of one store medium + profile
//!   share one [`Session`] ([`TokenStore::identity`]), which carries the
//!   store handle and the lock; the client has no store of its own. Every
//!   token read is a snapshot of the whole [`SessionRecord`] (tokens,
//!   generation, deactivation) taken under that lock. A caller whose 401 came with an
//!   access token that is no longer current reuses the new one.
//! - The refresh token is taken out of the store atomically
//!   ([`TokenStore::take`]) before it is sent. It is put back only when the
//!   connection was never established. Every other outcome (timeout,
//!   dropped connection, any HTTP status, unreadable 2xx) treats it as spent:
//!   the store stays empty and the call fails with `UNAUTHENTICATED`, so the
//!   user signs in again (the outbox is kept). A crash mid-refresh ends the
//!   same way. An explicit [`DeviceAuthApi::refresh`] only sends the token
//!   that is currently stored; a spent or foreign token is refused unsent.
//! - A 401 on a sync call triggers at most one refresh and one retry.
//! - Cancel-safe: a refresh (automatic or explicit) and a password change
//!   run on their own Tokio task, under the session lock, to the end. A
//!   caller that stops waiting (timeout, aborted task) does not lose the
//!   pair the server issued; the store gets it all the same.
//! - 403 `USER_DEACTIVATED` from any call (sync, refresh, login, meta) runs
//!   [`TokenStore::deactivate`] under the lock: a compare-and-set against the
//!   generation of the snapshot the call was made with, so a deactivation
//!   answered to a call from before a newer sign-in changes nothing. The
//!   mark is persistent and cleared only by a successful sign-in; while it
//!   is set, sync calls fail locally with `USER_DEACTIVATED`. A failed write
//!   is returned as `TOKEN_STORE_ERROR`.
//! - Everything on the sign-in path (login and refresh errors) is redacted.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderValue, RETRY_AFTER};
use reqwest::{Method, Url};
use serde::Serialize;
use serde::de::DeserializeOwned;
use zeroize::Zeroizing;

use crate::auth::{Secret, Session, SessionRecord, StoredTokens, TokenStore, TokenWrite};
use crate::error::{Result, SyncError};
use crate::wire::{
    ApiError, DeviceLoginRequest, DeviceRefreshRequest, DeviceTokenResponse, ErrorCode,
    ErrorResponse, ManifestResponse, PullRequest, PullResponse, PushRequest, PushResponse,
    ServerMetaResponse,
};

use super::retry_after::parse_retry_after;
use super::url::ServerUrl;
use super::{ApiConfig, DeviceAuthApi, SyncApi, paths};

mod proxy;

pub use proxy::{
    AUTH_READS, PROXY_BODY_LIMIT, ProxyMethod, ProxyRequest, ProxyResponse, REQUEST_HEADERS,
    RESPONSE_HEADERS,
};

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

/// HTTP client of one server profile. Tokens are read and written only
/// through the profile's [`Session`], which carries the store handle.
pub struct HttpClient {
    http: reqwest::Client,
    server: ServerUrl,
    company_id: HeaderValue,
    company: uuid::Uuid,
    session: Arc<Session>,
}

impl std::fmt::Debug for HttpClient {
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
    /// No connection was made (DNS, TCP or TLS handshake failed): the HTTP
    /// request was never sent.
    NotSent(reqwest::Error),
    /// The request may have reached the server; the outcome is unknown.
    Lost(reqwest::Error),
}

impl From<Transport> for SyncError {
    fn from(error: Transport) -> Self {
        match error {
            Transport::NotSent(e) => SyncError::NotSent(e.to_string()),
            Transport::Lost(e) => SyncError::Network(e.to_string()),
        }
    }
}

impl HttpClient {
    /// `profile` is the [`TokenStore`] key of this server profile. All
    /// clients of the same store medium and profile share a session.
    pub fn new<T: TokenStore + 'static>(
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
            company: config.company_id,
            session: Session::shared(&profile.into(), tokens),
        })
    }

    pub fn server(&self) -> &ServerUrl {
        &self.server
    }

    /// The session the client works in; the engine of the profile is built
    /// over the same one ([`crate::engine::SyncEngine::new`]).
    pub fn session(&self) -> &Arc<Session> {
        &self.session
    }

    fn store(&self) -> &dyn TokenStore {
        self.session.store()
    }

    fn profile(&self) -> &str {
        self.session.profile()
    }

    /// The whole record, read under the session lock.
    async fn snapshot(&self) -> Result<SessionRecord> {
        let _gate = self.session.lock().await;
        self.store().load_record(self.profile())
    }

    /// `GET /api/v1/meta` (public).
    pub async fn server_meta(&self) -> Result<ServerMetaResponse> {
        let generation = self.snapshot().await?.generation;
        let result = async {
            let url = self.server.endpoint(paths::META)?;
            let raw = send(&self.http, Method::GET, url, None, None, None).await?;
            decode(&raw)
        }
        .await;
        self.settle(result, generation).await
    }

    /// Sync call with bearer token, one refresh + retry on 401. With
    /// `expected`, a token of another sign-in generation is never sent.
    async fn authorized<Req, Resp>(
        &self,
        method: Method,
        path: &str,
        body: Option<&Req>,
        expected: Option<u64>,
    ) -> Result<Resp>
    where
        Req: Serialize + Sync,
        Resp: DeserializeOwned,
    {
        let url = self.server.endpoint(path)?;
        let body = body.map(serde_json::to_vec).transpose()?;
        // Token and generation come from one snapshot.
        let record = self.snapshot().await?;
        if record.deactivated {
            return Err(deactivated());
        }
        if expected.is_some_and(|g| g != record.generation) {
            return Err(session_changed());
        }
        let mut generation = record.generation;
        let access = record
            .tokens
            .map(|tokens| tokens.access_token.clone())
            .ok_or_else(|| sign_in_required("not signed in"))?;
        // Each attempt reports the generation of its own snapshot.
        let result = async {
            let mut raw = self
                .send_authorized(method.clone(), url.clone(), body.clone(), &access)
                .await?;
            if raw.status == 401 {
                let (fresh, fresh_generation) = self.refresh_after_unauthorized(&access).await?;
                if expected.is_some_and(|g| g != fresh_generation) {
                    // A sign-in happened meanwhile: its token is not ours.
                    return Err(session_changed());
                }
                generation = fresh_generation;
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
        send_bearer(
            &self.http,
            method,
            url,
            body,
            access,
            self.company_id.clone(),
        )
        .await
    }

    /// The one place that reacts to `USER_DEACTIVATED`: a compare-and-set on
    /// `generation` (of the snapshot the call was made with) under the lock.
    /// A stale deactivation (a sign-in happened since) is reported as is but
    /// changes nothing.
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
        let _gate = self.session.lock().await;
        match self
            .store()
            .deactivate(&TokenWrite::new(), self.profile(), generation)
        {
            Ok(_) => Err(error),
            Err(store) => Err(SyncError::TokenStore(format!(
                "recording USER_DEACTIVATED failed: {store}"
            ))),
        }
    }

    /// What token work needs, owned, so it can go on without this call.
    fn token_task(&self) -> Result<TokenTask> {
        Ok(TokenTask {
            http: self.http.clone(),
            refresh_url: self.server.endpoint(paths::DEVICE_REFRESH)?,
            session: Arc::clone(&self.session),
        })
    }

    /// Token and generation for the retry, from one snapshot under the lock.
    /// Runs detached: a caller dropped while the refresh is on its way does
    /// not lose the new pair.
    async fn refresh_after_unauthorized(&self, rejected: &Secret) -> Result<(Secret, u64)> {
        let task = self.token_task()?;
        let rejected = rejected.clone();
        detached(async move {
            let _gate = task.session.lock().await;
            task.refresh_rejected(&rejected).await
        })
        .await
    }

    /// `POST /api/v1/auth/password/change` with the current session.
    ///
    /// Under the session lock for the whole exchange (no refresh, sign-in
    /// or sign-out interleaves). A 401 refreshes once and sends again. When
    /// the server reissues the device's token pair (every older refresh
    /// token is then void), the new pair replaces the stored one in the
    /// same generation: it is not a new sign-in. Returns `true` then, and
    /// `false` when the server kept the tokens (`204`). Runs detached: a
    /// caller dropped while the request is on its way does not lose the new
    /// pair. Not sent while deactivated or signed out. Failures come back
    /// as the server's error (`VALIDATION_ERROR` with its fields for a wrong
    /// current password or a weak new one); sign-in and account codes are
    /// redacted. The passwords never appear in errors or debug output.
    pub async fn change_password(&self, current: &Secret, new: &Secret) -> Result<bool> {
        let task = self.token_task()?;
        let url = self.server.endpoint(paths::PASSWORD_CHANGE)?;
        let company = self.company_id.clone();
        let body = Zeroizing::new(serde_json::to_vec(&PasswordChange {
            current_password: current.expose(),
            password: new.expose(),
            password_confirmation: new.expose(),
        })?);
        let (result, generation) = detached(async move {
            let _gate = task.session.lock().await;
            let record = task.session.record()?;
            let generation = record.generation;
            let result = task.change_password(&record, url, company, &body).await;
            Ok((result, generation))
        })
        .await?;
        self.settle(result, generation).await
    }
}

/// Request body of a password change; never printed.
#[derive(Serialize)]
struct PasswordChange<'a> {
    current_password: &'a str,
    password: &'a str,
    password_confirmation: &'a str,
}

/// Token work that outlives its caller: owns its HTTP client and session.
struct TokenTask {
    http: reqwest::Client,
    refresh_url: Url,
    session: Arc<Session>,
}

impl TokenTask {
    fn store(&self) -> &dyn TokenStore {
        self.session.store()
    }

    fn profile(&self) -> &str {
        self.session.profile()
    }

    /// The refresh of a 401 to `rejected`; the caller holds the session lock.
    async fn refresh_rejected(&self, rejected: &Secret) -> Result<(Secret, u64)> {
        let record = self.store().load_record(self.profile())?;
        if record.deactivated {
            return Err(deactivated());
        }
        let current = record
            .tokens
            .ok_or_else(|| sign_in_required("not signed in"))?;
        if current.access_token != *rejected {
            // Another caller refreshed, or a sign-in happened, meanwhile.
            return Ok((current.access_token.clone(), record.generation));
        }
        let taken = self
            .store()
            .take(&TokenWrite::new(), self.profile())?
            .ok_or_else(|| sign_in_required("not signed in"))?;
        let response = self.rotate_locked(taken).await?;
        // A refresh keeps the generation; the lock rules out a sign-in.
        Ok((Secret::new(response.data.token.clone()), record.generation))
    }

    /// Sends one refresh with `taken`, already removed from the store. The
    /// caller holds the session lock, so no deactivation or sign-in can
    /// interleave. Errors are redacted.
    async fn rotate_locked(&self, taken: StoredTokens) -> Result<DeviceTokenResponse> {
        let url = self.refresh_url.clone();
        let body = {
            let request = DeviceRefreshRequest {
                refresh_token: taken.refresh_token.expose().to_owned(),
            };
            serde_json::to_vec(&request)?
        };

        let raw = match send(&self.http, Method::POST, url, Some(body), None, None).await {
            Ok(raw) => raw,
            Err(Transport::NotSent(e)) => {
                self.store()
                    .save(&TokenWrite::new(), self.profile(), &taken)?;
                return Err(SyncError::NotSent(e.to_string()));
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
                return Err(error.redacted());
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
        self.store().save(
            &TokenWrite::new(),
            self.profile(),
            &StoredTokens::from(response.data.clone()),
        )?;
        Ok(response)
    }

    /// The password change of [`HttpClient::change_password`] with the
    /// tokens of `record`; the caller holds the session lock.
    async fn change_password(
        &self,
        record: &SessionRecord,
        url: Url,
        company: HeaderValue,
        body: &[u8],
    ) -> Result<bool> {
        if record.deactivated {
            return Err(deactivated());
        }
        let access = record
            .tokens
            .as_ref()
            .map(|tokens| tokens.access_token.clone())
            .ok_or_else(|| sign_in_required("not signed in"))?;
        let post = |access: Secret| {
            let (http, url, company) = (&self.http, url.clone(), company.clone());
            async move {
                send_bearer(
                    http,
                    Method::POST,
                    url,
                    Some(body.to_vec()),
                    &access,
                    company,
                )
                .await
            }
        };
        let mut raw = post(access.clone()).await?;
        if raw.status == 401 {
            let (fresh, _) = self.refresh_rejected(&access).await?;
            raw = post(fresh).await?;
        }
        if !raw.is_success() {
            return Err(decode::<()>(&raw)
                .err()
                .unwrap_or_else(|| sign_in_required("password change failed")));
        }
        if raw.status == 204 {
            return Ok(false);
        }
        let response = decode_token(&raw).map_err(|_| {
            sign_in_required(
                "the password was changed but the new tokens were unreadable; sign in again",
            )
        })?;
        // The lock is held since `record` was read: no sign-in in between,
        // so the reissued pair belongs to the same generation.
        self.store().save(
            &TokenWrite::new(),
            self.profile(),
            &StoredTokens::from(response.data),
        )?;
        Ok(true)
    }
}

/// Runs token work to its end even when the caller stops waiting (a
/// timeout, an aborted task): the server may already have rotated the
/// tokens, and the answer must reach the store. Needs a Tokio runtime; the
/// work is cut short only when the runtime itself shuts down.
async fn detached<T, F>(work: F) -> Result<T>
where
    F: Future<Output = Result<T>> + Send + 'static,
    T: Send + 'static,
{
    match tokio::spawn(work).await {
        Ok(result) => result,
        Err(error) if error.is_panic() => std::panic::resume_unwind(error.into_panic()),
        Err(_) => Err(SyncError::Network(
            "token work stopped with its runtime; outcome unknown".to_owned(),
        )),
    }
}

/// Sends with `Authorization: Bearer <access>` (marked sensitive).
async fn send_bearer(
    http: &reqwest::Client,
    method: Method,
    url: Url,
    body: Option<Vec<u8>>,
    access: &Secret,
    company: HeaderValue,
) -> Result<RawResponse> {
    let token = access.expose().as_bytes();
    let mut text = Zeroizing::new(Vec::with_capacity(7 + token.len()));
    text.extend_from_slice(b"Bearer ");
    text.extend_from_slice(token);
    let mut bearer = HeaderValue::from_bytes(&text)
        .map_err(|_| sign_in_required("stored access token is not a valid header value"))?;
    bearer.set_sensitive(true);
    Ok(send(http, method, url, body, Some(bearer), Some(company)).await?)
}

impl super::sealed::Sealed for HttpClient {}

impl SyncApi for HttpClient {
    fn company_id(&self) -> Option<uuid::Uuid> {
        Some(self.company)
    }

    fn session(&self) -> &Arc<Session> {
        &self.session
    }

    async fn manifest(&self) -> Result<ManifestResponse> {
        self.authorized::<(), _>(Method::GET, paths::MANIFEST, None, None)
            .await
    }

    async fn pull(&self, request: &PullRequest) -> Result<PullResponse> {
        self.authorized(Method::POST, paths::PULL, Some(request), None)
            .await
    }

    async fn push(&self, request: &PushRequest) -> Result<PushResponse> {
        self.authorized(Method::POST, paths::PUSH, Some(request), None)
            .await
    }

    async fn manifest_in(&self, generation: u64) -> Result<ManifestResponse> {
        self.authorized::<(), _>(Method::GET, paths::MANIFEST, None, Some(generation))
            .await
    }

    async fn pull_in(&self, request: &PullRequest, generation: u64) -> Result<PullResponse> {
        self.authorized(Method::POST, paths::PULL, Some(request), Some(generation))
            .await
    }

    async fn push_in(&self, request: &PushRequest, generation: u64) -> Result<PushResponse> {
        self.authorized(Method::POST, paths::PUSH, Some(request), Some(generation))
            .await
    }
}

impl DeviceAuthApi for HttpClient {
    /// On success [`TokenStore::sign_in`] stores the tokens, starts a new
    /// generation and clears a deactivation mark. 401 `TWO_FACTOR_REQUIRED`
    /// and 422 `INVALID_TWO_FACTOR_CODE` come back as `SyncError::Api`
    /// (redacted); resend with `two_factor_code`. A lost login response is
    /// harmless: logging in again with the same fingerprint replaces the
    /// device.
    async fn login(&self, request: &DeviceLoginRequest) -> Result<DeviceTokenResponse> {
        let generation = self.snapshot().await?.generation;
        let result = async {
            let url = self.server.endpoint(paths::DEVICE_LOGIN)?;
            let body = serde_json::to_vec(request)?;
            let raw = send(&self.http, Method::POST, url, Some(body), None, None).await?;
            if !raw.is_success() {
                return decode(&raw).map_err(SyncError::redacted);
            }
            let response = decode_token(&raw)?;
            // Session lock, then the sign-in gate, inside.
            self.session
                .sign_in(&StoredTokens::from(response.data.clone()))
                .await?;
            Ok(response)
        }
        .await;
        self.settle(result, generation).await
    }

    /// Serialized with the automatic refresh. Only the refresh token that is
    /// currently stored is sent (taken out of the store first); any other
    /// token, including one already spent, is refused without a request.
    async fn refresh(&self, request: &DeviceRefreshRequest) -> Result<DeviceTokenResponse> {
        let task = self.token_task()?;
        let wanted = Secret::new(request.refresh_token.clone());
        // Detached like the automatic refresh: a dropped caller does not
        // lose the new pair.
        let (result, generation) = detached(async move {
            let _gate = task.session.lock().await;
            let record = task.store().load_record(task.profile())?;
            let generation = record.generation;
            let current = record
                .tokens
                .as_ref()
                .is_some_and(|stored| stored.refresh_token == wanted);
            let result = if record.deactivated {
                Err(deactivated())
            } else if !current {
                Err(sign_in_required(
                    "refresh token is not the current one; it was not sent",
                ))
            } else {
                match task.store().take(&TokenWrite::new(), task.profile())? {
                    Some(taken) => task.rotate_locked(taken).await,
                    None => Err(sign_in_required("not signed in")),
                }
            };
            Ok((result, generation))
        })
        .await?;
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
        redacted: None,
    }
}

/// A generation-bound call found another sign-in: nothing was sent.
fn session_changed() -> SyncError {
    sign_in_required("another sign-in happened since the call was prepared; it was not sent")
}

/// Local stand-in for 403 `USER_DEACTIVATED` once the session is marked.
fn deactivated() -> SyncError {
    SyncError::Api {
        status: 403,
        code: ErrorCode::UserDeactivated,
        message: "account deactivated".to_owned(),
        fields: BTreeMap::new(),
        retry_after: None,
        redacted: None,
    }
}
