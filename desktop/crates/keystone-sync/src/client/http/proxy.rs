//! [`HttpClient::proxy`]: a general `/api/v1` request on behalf of the UI
//! (the online path of the shell's `api_request` command).
//!
//! Rules, on top of the refresh rules of the parent module:
//! - Only paths [`ServerUrl::endpoint`] accepts, minus the ones the shell
//!   calls itself: everything under `/api/v1/auth` (sign-in, sign-out,
//!   refresh, device tokens, two-factor, password change: the session life
//!   cycle belongs to the shell commands) except the reads in
//!   [`AUTH_READS`], `/api/v1/sync/*` and `/api/v1/broadcasting/auth` are
//!   refused (`INVALID_SERVER_URL`) before anything is sent.
//! - The client sets `Authorization`, `X-Company-Id` and `Accept`; of the
//!   caller's headers only [`REQUEST_HEADERS`] are passed, the rest is
//!   dropped. Of the answer only [`RESPONSE_HEADERS`] come back.
//! - Bound to one sign-in generation: the generation of the snapshot taken
//!   at the start (or the one given to [`HttpClient::proxy_in`]). A token of
//!   another sign-in is never sent, not even for the retry after a refresh.
//! - A 401 triggers at most one refresh and one retry; a second 401 is
//!   `UNAUTHENTICATED`. 403 `USER_DEACTIVATED` runs the deactivation
//!   compare-and-set against the bound generation.
//! - Answers with a sign-in or account code (401, `UNAUTHENTICATED`,
//!   `USER_DEACTIVATED`, `PASSWORD_CHANGE_REQUIRED`, `TWO_FACTOR_REQUIRED`,
//!   `INVALID_TWO_FACTOR_CODE`) become a redacted `SyncError::Api`. Every
//!   other answer, success or error (`COMPANY_FORBIDDEN` included), comes
//!   back as a [`ProxyResponse`] with the body unchanged.
//! - Request and response bodies are limited to [`PROXY_BODY_LIMIT`].
//! - No streaming: the whole body is read before the call returns.

use std::fmt;
use std::time::SystemTime;

use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, RETRY_AFTER};

use super::*;

/// Largest request or response body the proxy carries.
pub const PROXY_BODY_LIMIT: usize = 32 * 1024 * 1024;

/// Caller headers passed to the server (lowercase).
pub const REQUEST_HEADERS: [&str; 4] = [
    "idempotency-key",
    "accept-language",
    "if-none-match",
    "content-type",
];

/// Answer headers passed back to the caller (lowercase).
pub const RESPONSE_HEADERS: [&str; 5] = [
    "content-type",
    "content-disposition",
    "etag",
    "retry-after",
    "x-request-id",
];

/// Paths under `/api/v1/` (lowercase, without the prefix) the proxy never
/// sends: each one and everything below it.
const FORBIDDEN: [&str; 3] = ["auth", "sync", "broadcasting/auth"];

/// The only `/api/v1/auth` endpoints the proxy sends: reads that change no
/// session (method, path below `/api/v1/`). Anything else under `auth` is
/// refused.
pub const AUTH_READS: [(ProxyMethod, &str); 1] = [(ProxyMethod::Get, "auth/me")];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl ProxyMethod {
    /// `GET`, `POST`, `PUT`, `PATCH` or `DELETE` (any case).
    pub fn from_name(name: &str) -> Option<Self> {
        match name.to_ascii_uppercase().as_str() {
            "GET" => Some(Self::Get),
            "POST" => Some(Self::Post),
            "PUT" => Some(Self::Put),
            "PATCH" => Some(Self::Patch),
            "DELETE" => Some(Self::Delete),
            _ => None,
        }
    }

    fn method(self) -> Method {
        match self {
            Self::Get => Method::GET,
            Self::Post => Method::POST,
            Self::Put => Method::PUT,
            Self::Patch => Method::PATCH,
            Self::Delete => Method::DELETE,
        }
    }
}

/// One request of the UI. `path` is the full path (`/api/v1/...`), without
/// a query; `query` pairs are encoded by the client.
#[derive(Clone, PartialEq, Eq)]
pub struct ProxyRequest {
    pub method: ProxyMethod,
    pub path: String,
    pub query: Vec<(String, String)>,
    /// Only [`REQUEST_HEADERS`] are sent; names match in any case.
    pub headers: Vec<(String, String)>,
    /// Sent as is; `content-type` defaults to `application/json`.
    pub body: Option<Vec<u8>>,
}

/// Neither query values nor the body are printed (they may hold
/// credentials or personal data).
impl fmt::Debug for ProxyRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let headers: Vec<&str> = self.headers.iter().map(|(n, _)| n.as_str()).collect();
        let query: Vec<&str> = self.query.iter().map(|(n, _)| n.as_str()).collect();
        f.debug_struct("ProxyRequest")
            .field("method", &self.method)
            .field("path", &self.path)
            .field("query", &query)
            .field("headers", &headers)
            .field("body_len", &self.body.as_ref().map(Vec::len))
            .finish()
    }
}

/// The server's answer: status, the allowed headers (lowercase names, in
/// arrival order) and the whole body.
#[derive(Clone, PartialEq, Eq)]
pub struct ProxyResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl ProxyResponse {
    /// First value of `name` (any case).
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
}

/// The body is not printed.
impl fmt::Debug for ProxyResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ProxyResponse")
            .field("status", &self.status)
            .field("headers", &self.headers)
            .field("body_len", &self.body.len())
            .finish()
    }
}

struct Prepared {
    method: Method,
    url: Url,
    headers: HeaderMap,
    body: Option<Vec<u8>>,
}

impl HttpClient {
    /// Sends `request` with the current session (see the module rules).
    /// `Ok` for every answer that is not a sign-in or account failure.
    pub async fn proxy(&self, request: &ProxyRequest) -> Result<ProxyResponse> {
        self.proxy_bound(request, None).await
    }

    /// [`HttpClient::proxy`] bound to `generation`: after another sign-in it
    /// fails with `UNAUTHENTICATED` without sending anything.
    pub async fn proxy_in(&self, request: &ProxyRequest, generation: u64) -> Result<ProxyResponse> {
        self.proxy_bound(request, Some(generation)).await
    }

    async fn proxy_bound(
        &self,
        request: &ProxyRequest,
        expected: Option<u64>,
    ) -> Result<ProxyResponse> {
        let prepared = self.prepare(request)?;
        let record = self.snapshot().await?;
        if record.deactivated {
            return Err(deactivated());
        }
        if expected.is_some_and(|g| g != record.generation) {
            return Err(session_changed());
        }
        let bound = record.generation;
        let access = record
            .tokens
            .map(|tokens| tokens.access_token.clone())
            .ok_or_else(|| sign_in_required("not signed in"))?;
        let result = async {
            let mut raw = self.send_proxy(&prepared, &access).await?;
            if raw.status == 401 {
                let (fresh, generation) = self.refresh_after_unauthorized(&access).await?;
                if generation != bound {
                    return Err(session_changed());
                }
                raw = self.send_proxy(&prepared, &fresh).await?;
            }
            settle_answer(raw)
        }
        .await;
        self.settle(result, bound).await
    }

    fn prepare(&self, request: &ProxyRequest) -> Result<Prepared> {
        let mut url = self.server.endpoint(&request.path)?;
        if is_forbidden(request.method, &request.path) {
            return Err(SyncError::InvalidServerUrl(
                "this path is reserved for the desktop client".to_owned(),
            ));
        }
        if !request.query.is_empty() {
            url.query_pairs_mut().extend_pairs(&request.query);
        }
        let mut headers = HeaderMap::new();
        for (name, value) in &request.headers {
            let name = name.to_ascii_lowercase();
            if !REQUEST_HEADERS.contains(&name.as_str()) {
                continue;
            }
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|_| SyncError::InvalidServerUrl("bad request header".to_owned()))?;
            let value = HeaderValue::from_str(value).map_err(|_| {
                SyncError::InvalidServerUrl(format!("request header {name} has an invalid value"))
            })?;
            headers.append(name, value);
        }
        if let Some(body) = &request.body {
            if body.len() > PROXY_BODY_LIMIT {
                return Err(too_large("request"));
            }
            if !headers.contains_key(CONTENT_TYPE) {
                headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            }
        }
        Ok(Prepared {
            method: request.method.method(),
            url,
            headers,
            body: request.body.clone(),
        })
    }

    async fn send_proxy(&self, prepared: &Prepared, access: &Secret) -> Result<ProxyRaw> {
        let token = access.expose().as_bytes();
        let mut text = Zeroizing::new(Vec::with_capacity(7 + token.len()));
        text.extend_from_slice(b"Bearer ");
        text.extend_from_slice(token);
        let mut bearer = HeaderValue::from_bytes(&text)
            .map_err(|_| sign_in_required("stored access token is not a valid header value"))?;
        bearer.set_sensitive(true);

        let mut request = self
            .http
            .request(prepared.method.clone(), prepared.url.clone())
            .headers(prepared.headers.clone())
            .header(ACCEPT, HeaderValue::from_static("application/json"))
            .header(AUTHORIZATION, bearer)
            .header(COMPANY_HEADER, self.company_id.clone());
        if let Some(body) = &prepared.body {
            request = request.body(body.clone());
        }
        let mut response = request.send().await.map_err(|e| {
            SyncError::from(if e.is_connect() || e.is_builder() {
                Transport::NotSent(e)
            } else {
                Transport::Lost(e)
            })
        })?;
        if response
            .content_length()
            .is_some_and(|n| n > PROXY_BODY_LIMIT as u64)
        {
            return Err(too_large("response"));
        }
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| SyncError::from(Transport::Lost(e)))?
        {
            if body.len() + chunk.len() > PROXY_BODY_LIMIT {
                return Err(too_large("response"));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(ProxyRaw {
            status,
            headers,
            body,
        })
    }
}

struct ProxyRaw {
    status: u16,
    headers: HeaderMap,
    body: Vec<u8>,
}

/// Sign-in and account failures become a redacted error (the engine and the
/// sign-in screen act on them); everything else is passed through.
fn settle_answer(raw: ProxyRaw) -> Result<ProxyResponse> {
    if !(200..300).contains(&raw.status) {
        let parsed = serde_json::from_slice::<ErrorResponse>(&raw.body).ok();
        let auth = raw.status == 401
            || parsed
                .as_ref()
                .is_some_and(|body| is_sign_in_code(&body.errors.code));
        if auth {
            let retry_after = raw
                .headers
                .get(RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| parse_retry_after(value, SystemTime::now()));
            let error = parsed.map_or_else(
                || ApiError {
                    message: format!("HTTP {}", raw.status),
                    code: code_for_status(raw.status),
                    fields: None,
                },
                |body| body.errors,
            );
            return Err(SyncError::from_api(raw.status, error, retry_after).redacted());
        }
    }
    let mut headers = Vec::new();
    for (name, value) in &raw.headers {
        if !RESPONSE_HEADERS.contains(&name.as_str()) {
            continue;
        }
        if let Ok(text) = std::str::from_utf8(value.as_bytes()) {
            headers.push((name.as_str().to_owned(), text.to_owned()));
        }
    }
    Ok(ProxyResponse {
        status: raw.status,
        headers,
        body: raw.body,
    })
}

fn is_sign_in_code(code: &ErrorCode) -> bool {
    matches!(
        code,
        ErrorCode::Unauthenticated
            | ErrorCode::UserDeactivated
            | ErrorCode::PasswordChangeRequired
            | ErrorCode::TwoFactorRequired
            | ErrorCode::InvalidTwoFactorCode
    )
}

/// `path` already passed [`ServerUrl::endpoint`] (plain segments under the prefix).
fn is_forbidden(method: ProxyMethod, path: &str) -> bool {
    let rest = path
        .strip_prefix(super::super::API_PREFIX)
        .and_then(|rest| rest.strip_prefix('/'))
        .unwrap_or(path)
        .to_ascii_lowercase();
    if AUTH_READS.contains(&(method, rest.as_str())) {
        return false;
    }
    FORBIDDEN
        .iter()
        .any(|forbidden| rest == *forbidden || rest.starts_with(&format!("{forbidden}/")))
}

fn too_large(what: &str) -> SyncError {
    SyncError::Decode(<serde_json::Error as serde::de::Error>::custom(format!(
        "{what} body exceeds the {} MiB limit",
        PROXY_BODY_LIMIT / (1024 * 1024)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserved_paths() {
        use ProxyMethod::{Delete, Get, Patch, Post, Put};
        for (method, path) in [
            (Post, "/api/v1/auth/login"),
            (Post, "/api/v1/auth/logout"),
            (Post, "/api/v1/auth/two-factor/verify"),
            (Post, "/api/v1/auth/two-factor/setup"),
            (Post, "/api/v1/auth/two-factor/confirm"),
            (Delete, "/api/v1/auth/two-factor"),
            (Post, "/api/v1/auth/password/change"),
            (Get, "/api/v1/auth/sessions"),
            (
                Delete,
                "/api/v1/auth/sessions/0192f5a0-0000-7000-8000-000000000001",
            ),
            (Post, "/api/v1/auth/device"),
            (Post, "/api/v1/auth/device/refresh"),
            (Get, "/api/v1/auth/devices"),
            (Get, "/api/v1/auth"),
            (Get, "/api/v1/Auth/Device"),
            (Post, "/api/v1/auth/me"),
            (Put, "/api/v1/auth/me"),
            (Patch, "/api/v1/auth/me"),
            (Delete, "/api/v1/auth/me"),
            (Get, "/api/v1/auth/me/x"),
            (Get, "/api/v1/sync/pull"),
            (Get, "/api/v1/SYNC/manifest"),
            (Get, "/api/v1/sync"),
            (Post, "/api/v1/broadcasting/auth"),
        ] {
            assert!(is_forbidden(method, path), "{method:?} {path}");
        }
        for (method, path) in [
            (Get, "/api/v1/auth/me"),
            (Get, "/api/v1/Auth/Me"),
            (Get, "/api/v1/me/devices"),
            (
                Delete,
                "/api/v1/me/devices/0192f5a0-0000-7000-8000-000000000001",
            ),
            (Get, "/api/v1/authors"),
            (Get, "/api/v1/synchronize"),
            (Post, "/api/v1/broadcasting/authx"),
            (Get, "/api/v1/sales-quotes"),
        ] {
            assert!(!is_forbidden(method, path), "{method:?} {path}");
        }
    }
}
