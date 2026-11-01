//! [`HttpClient::broadcasting_auth`]: the signature of a private channel
//! (`POST /api/v1/broadcasting/auth`). The webview cannot reach this path
//! (see the proxy's deny list); the shell's realtime bridge calls it here.
//!
//! The refresh rules of the parent module apply. The answer is handed back
//! raw and unparsed, in memory that is zeroed on drop: it is a signature,
//! and neither it nor the request appears in logs or errors.

use reqwest::Method;
use serde::Serialize;
use zeroize::Zeroizing;

use crate::error::Result;

use super::{HttpClient, decode, paths};

#[derive(Serialize)]
struct ChannelAuthRequest<'a> {
    socket_id: &'a str,
    channel_name: &'a str,
}

impl HttpClient {
    /// Signs `channel_name` for `socket_id` with the tokens of sign-in
    /// `generation`; after another sign-in it fails with `UNAUTHENTICATED`
    /// without sending anything. A 401 refreshes once and sends again.
    pub async fn broadcasting_auth(
        &self,
        socket_id: &str,
        channel_name: &str,
        generation: u64,
    ) -> Result<Zeroizing<Vec<u8>>> {
        let request = ChannelAuthRequest {
            socket_id,
            channel_name,
        };
        self.authorized_with(
            Method::POST,
            paths::BROADCASTING_AUTH,
            Some(&request),
            Some(generation),
            |raw| {
                if raw.is_success() {
                    return Ok(Zeroizing::new(raw.body));
                }
                decode::<()>(&raw).map(|()| Zeroizing::new(Vec::new()))
            },
        )
        .await
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use serde_json::{Value, json};
    use uuid::Uuid;
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::super::{ApiConfig, ClientOptions};
    use super::*;
    use crate::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore};
    use crate::wire::Timestamp;

    const PROFILE: &str = "realtime";
    const AUTH: &str = "/api/v1/broadcasting/auth";
    const REFRESH: &str = "/api/v1/auth/device/refresh";
    const PAD: &str = "0123456789abcdef0123456789abcdef";
    const SOCKET: &str = "123.456";
    const CHANNEL: &str = "private-user.u1";
    const SIGNED: &[u8] = br#"{"auth":"key:SECRETSIG"}"#;

    fn access(n: u8) -> String {
        format!("access-{n}-{PAD}")
    }

    fn tokens(n: u8) -> StoredTokens {
        StoredTokens {
            access_token: Secret::new(access(n)),
            access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
            refresh_token: Secret::new(format!("refresh-{n}-{PAD}")),
            refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
        }
    }

    fn token_body(n: u8) -> Value {
        json!({ "data": {
            "token": access(n),
            "expires_at": "2026-10-26T10:15:00+03:00",
            "refresh_token": format!("refresh-{n}-{PAD}"),
            "refresh_expires_at": "2026-11-25T09:15:00+03:00"
        }})
    }

    fn error_body(code: &str) -> Value {
        json!({ "errors": { "message": "refused", "code": code } })
    }

    fn signed_in(n: u8) -> Arc<MemoryTokenStore> {
        Arc::new(MemoryTokenStore::signed_in(PROFILE, &tokens(n)))
    }

    fn client(server: &MockServer, store: &Arc<MemoryTokenStore>) -> HttpClient {
        HttpClient::new(
            &ApiConfig {
                base_url: server.uri(),
                company_id: Uuid::nil(),
                user_agent: "keystone-desktop-test/0.1".into(),
            },
            PROFILE,
            Arc::clone(store),
            &ClientOptions {
                connect_timeout: Duration::from_secs(2),
                request_timeout: Duration::from_secs(10),
                allow_http_localhost: true,
            },
        )
        .expect("client")
    }

    async fn count(server: &MockServer, endpoint: &str) -> usize {
        server
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|r| r.url.path() == endpoint)
            .count()
    }

    #[tokio::test]
    async fn the_answer_comes_back_raw_for_the_socket_and_channel() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(AUTH))
            .and(header("authorization", format!("Bearer {}", access(1))))
            .and(body_json(
                json!({"socket_id": SOCKET, "channel_name": CHANNEL}),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_raw(SIGNED, "application/json"))
            .expect(1)
            .mount(&server)
            .await;
        let store = signed_in(1);
        let client = client(&server, &store);

        let body = client
            .broadcasting_auth(SOCKET, CHANNEL, 1)
            .await
            .expect("signature");
        assert_eq!(body.as_slice(), SIGNED);
    }

    #[tokio::test]
    async fn a_401_refreshes_once_and_sends_again_with_the_new_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(AUTH))
            .and(header("authorization", format!("Bearer {}", access(1))))
            .respond_with(ResponseTemplate::new(401).set_body_json(error_body("UNAUTHENTICATED")))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(REFRESH))
            .respond_with(ResponseTemplate::new(200).set_body_json(token_body(2)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(AUTH))
            .and(header("authorization", format!("Bearer {}", access(2))))
            .respond_with(ResponseTemplate::new(200).set_body_raw(SIGNED, "application/json"))
            .mount(&server)
            .await;
        let store = signed_in(1);
        let client = client(&server, &store);

        let body = client.broadcasting_auth(SOCKET, CHANNEL, 1).await.unwrap();
        assert_eq!(body.as_slice(), SIGNED);
        assert_eq!(count(&server, REFRESH).await, 1);
        assert_eq!(count(&server, AUTH).await, 2);
    }

    #[tokio::test]
    async fn the_tokens_of_another_sign_in_are_never_sent() {
        let server = MockServer::start().await;
        let store = signed_in(1);
        let client = client(&server, &store);

        let error = client
            .broadcasting_auth(SOCKET, CHANNEL, 7)
            .await
            .unwrap_err();
        assert_eq!(error.code(), "UNAUTHENTICATED");
        assert_eq!(count(&server, AUTH).await, 0);
    }

    #[tokio::test]
    async fn a_refusal_is_the_servers_error_without_the_request_in_it() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(AUTH))
            .respond_with(ResponseTemplate::new(403).set_body_json(error_body("FORBIDDEN")))
            .mount(&server)
            .await;
        let store = signed_in(1);
        let client = client(&server, &store);

        let error = client
            .broadcasting_auth(SOCKET, CHANNEL, 1)
            .await
            .unwrap_err();
        assert_eq!(error.code(), "FORBIDDEN");
        let text = format!("{error} {error:?}");
        assert!(!text.contains(SOCKET), "{text}");
        assert!(!text.contains(&access(1)), "{text}");
    }

    #[tokio::test]
    async fn a_deactivation_answer_marks_the_bound_generation() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(AUTH))
            .respond_with(ResponseTemplate::new(403).set_body_json(error_body("USER_DEACTIVATED")))
            .mount(&server)
            .await;
        let store = signed_in(1);
        let client = client(&server, &store);

        let error = client
            .broadcasting_auth(SOCKET, CHANNEL, 1)
            .await
            .unwrap_err();
        assert_eq!(error.code(), "USER_DEACTIVATED");
        assert!(store.load_record(PROFILE).unwrap().deactivated);
    }
}
