//! Private channel authorization (`POST /api/v1/broadcasting/auth`).
//!
//! The crate does not call the endpoint itself: the shell implements
//! [`ChannelAuthorizer`] with the active profile's authenticated HTTP client
//! (bearer, refresh, generation binding all live there). The endpoint is on
//! the proxy deny list, so the webview can never reach it.

use std::fmt;
use std::future::Future;

use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

/// What the server signs: the socket id from `pusher:connection_established`
/// and the channel name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct AuthRequest<'a> {
    pub socket_id: &'a str,
    pub channel_name: &'a str,
}

impl AuthRequest<'_> {
    /// JSON request body `{socket_id, channel_name}`.
    pub fn to_json_body(&self) -> Vec<u8> {
        serde_json::to_vec(self).unwrap_or_default()
    }
}

/// The signature returned by the server (`{"auth": "key:hmac"}`). Never
/// printed: `Debug` is redacted and the crate does not log it.
#[derive(Clone)]
pub struct ChannelAuth {
    auth: Zeroizing<String>,
    channel_data: Option<String>,
}

#[derive(Deserialize)]
struct AuthBody {
    auth: String,
    #[serde(default)]
    channel_data: Option<String>,
}

impl ChannelAuth {
    pub fn new(auth: impl Into<String>) -> Self {
        Self {
            auth: Zeroizing::new(auth.into()),
            channel_data: None,
        }
    }

    /// Parses a 2xx response body of the auth endpoint.
    pub fn from_response_body(body: &[u8]) -> Result<Self, AuthorizeError> {
        let parsed: AuthBody =
            serde_json::from_slice(body).map_err(|_| AuthorizeError::Unavailable)?;
        if parsed.auth.trim().is_empty() {
            return Err(AuthorizeError::Unavailable);
        }
        Ok(Self {
            auth: Zeroizing::new(parsed.auth),
            channel_data: parsed.channel_data,
        })
    }

    pub(crate) fn auth(&self) -> &str {
        &self.auth
    }

    pub(crate) fn channel_data(&self) -> Option<&str> {
        self.channel_data.as_deref()
    }
}

impl fmt::Debug for ChannelAuth {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ChannelAuth")
            .field("auth", &"<redacted>")
            .field("channel_data", &self.channel_data.as_ref().map(|_| ".."))
            .finish()
    }
}

/// Outcome classes the connection task acts on. Carries no server text so
/// nothing sensitive can reach a log through it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AuthorizeError {
    /// No usable token (401 after refresh, signed out, generation changed):
    /// the task stops without reconnecting.
    #[error("session ended")]
    Unauthenticated,
    /// 403: this channel is not allowed; the subscription is skipped until
    /// the next connection.
    #[error("channel denied")]
    Denied,
    /// Network or server error: the connection is dropped and retried with
    /// backoff.
    #[error("authorization unavailable")]
    Unavailable,
}

/// Signs channel subscriptions. Implemented by the shell.
pub trait ChannelAuthorizer: Send + Sync + 'static {
    fn authorize(
        &self,
        request: AuthRequest<'_>,
    ) -> impl Future<Output = Result<ChannelAuth, AuthorizeError>> + Send;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_shape() {
        let body = AuthRequest {
            socket_id: "1.2",
            channel_name: "private-user.u1",
        }
        .to_json_body();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
            serde_json::json!({"socket_id": "1.2", "channel_name": "private-user.u1"})
        );
    }

    #[test]
    fn parses_response_and_redacts_debug() {
        let auth = ChannelAuth::from_response_body(br#"{"auth":"key:SIGNATURE"}"#).unwrap();
        assert_eq!(auth.auth(), "key:SIGNATURE");
        assert_eq!(auth.channel_data(), None);
        let debug = format!("{auth:?}");
        assert!(!debug.contains("SIGNATURE"), "{debug}");
        assert!(debug.contains("redacted"));
    }

    #[test]
    fn rejects_bad_bodies() {
        for body in [&b"{}"[..], b"not json", br#"{"auth":""}"#] {
            assert_eq!(
                ChannelAuth::from_response_body(body).unwrap_err(),
                AuthorizeError::Unavailable
            );
        }
    }
}
