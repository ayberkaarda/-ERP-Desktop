//! How a failed connection is told apart: a request that certainly was not
//! sent (`NotSent`: refused port, unknown host, a handshake that is not
//! TLS), a server whose certificate is not trusted (`CertificateInvalid`,
//! `TLS_CERTIFICATE_INVALID`) and a request whose answer was lost
//! (`Network`). The certificate cases run a real TLS server on loopback
//! with a self-signed certificate (`tests/tls/`, CN and SAN `localhost`,
//! test only); the client's verification is never relaxed.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;

use keystone_sync::SyncError;
use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens};
use keystone_sync::client::{
    ApiConfig, ClientOptions, DeviceAuthApi, HttpClient, ProxyMethod, ProxyRequest,
    fetch_server_meta,
};
use keystone_sync::wire::{DeviceRefreshRequest, Timestamp};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use uuid::Uuid;

const CERT: &[u8] = include_bytes!("tls/selfsigned-cert.der");
const KEY: &[u8] = include_bytes!("tls/selfsigned-key.der");
/// Self-signed, `localhost`, valid only in 2020.
const EXPIRED_CERT: &[u8] = include_bytes!("tls/expired-cert.der");
const EXPIRED_KEY: &[u8] = include_bytes!("tls/expired-key.der");
/// Self-signed, valid now, for `other.example` only.
const WRONG_NAME_CERT: &[u8] = include_bytes!("tls/wrongname-cert.der");
const WRONG_NAME_KEY: &[u8] = include_bytes!("tls/wrongname-key.der");
const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";
const SECRET_QUERY: &str = "LEAKED-SECRET-q1";

fn options() -> ClientOptions {
    ClientOptions {
        connect_timeout: Duration::from_secs(3),
        request_timeout: Duration::from_secs(5),
        allow_http_localhost: false,
    }
}

/// A TLS server on loopback with the self-signed certificate. It serves
/// `connections` handshakes and stops.
fn tls_server(connections: usize) -> u16 {
    tls_server_with(CERT, KEY, connections)
}

/// [`tls_server`] with another certificate and key.
fn tls_server_with(cert: &'static [u8], key: &'static [u8], connections: usize) -> u16 {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("versions")
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(cert.to_vec())],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.to_vec())),
        )
        .expect("certificate");
    let config = Arc::new(config);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    std::thread::spawn(move || {
        for socket in listener.incoming().take(connections) {
            let Ok(socket) = socket else { continue };
            let Ok(connection) = rustls::ServerConnection::new(config.clone()) else {
                continue;
            };
            let mut stream = rustls::StreamOwned::new(connection, socket);
            let mut buffer = [0u8; 1024];
            // The client aborts the handshake; the error is expected.
            let _ = stream.read(&mut buffer);
        }
    });
    port
}

/// A plain TCP server that answers every connection with an HTTP text:
/// a TLS client gets a handshake that is not TLS at all.
fn plain_text_server(connections: usize) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    std::thread::spawn(move || {
        for socket in listener.incoming().take(connections) {
            let Ok(mut socket) = socket else { continue };
            let mut buffer = [0u8; 1024];
            let _ = socket.read(&mut buffer);
            let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
        }
    });
    port
}

/// A port nothing listens on.
fn closed_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    listener.local_addr().expect("addr").port()
}

fn tokens() -> StoredTokens {
    StoredTokens {
        access_token: Secret::new("access-1-0123456789abcdef".to_owned()),
        access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
        refresh_token: Secret::new("refresh-1-0123456789abcdef".to_owned()),
        refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
    }
}

fn signed_in_client(base_url: String) -> (HttpClient, Arc<MemoryTokenStore>) {
    let store = Arc::new(MemoryTokenStore::signed_in("transport", &tokens()));
    let config = ApiConfig {
        base_url,
        company_id: Uuid::parse_str(COMPANY).expect("uuid"),
        user_agent: "keystone-desktop-test/0.1".into(),
    };
    let client =
        HttpClient::new(&config, "transport", Arc::clone(&store), &options()).expect("client");
    (client, store)
}

fn get_with_secret() -> ProxyRequest {
    ProxyRequest {
        method: ProxyMethod::Get,
        path: "/api/v1/parties".into(),
        query: vec![("search".into(), SECRET_QUERY.into())],
        headers: Vec::new(),
        body: None,
    }
}

async fn meta(base_url: &str) -> SyncError {
    fetch_server_meta(base_url, "keystone-desktop-test/0.1", &options())
        .await
        .expect_err("no meta")
}

#[tokio::test]
async fn a_self_signed_certificate_is_its_own_code() {
    let port = tls_server(1);
    let error = meta(&format!("https://localhost:{port}")).await;
    assert!(
        matches!(error, SyncError::CertificateInvalid(_)),
        "{error:?}"
    );
    assert_eq!(error.code(), "TLS_CERTIFICATE_INVALID");
    assert!(error.not_sent(), "{error:?}");
    // The text names the certificate problem, not the address.
    let text = error.to_string();
    assert!(text.contains("certificate"), "{text}");
    assert!(!text.contains("localhost"), "{text}");
    assert!(!text.contains(&port.to_string()), "{text}");
}

#[tokio::test]
async fn a_closed_port_is_not_a_certificate_problem() {
    let port = closed_port();
    let error = meta(&format!("https://localhost:{port}")).await;
    assert!(matches!(error, SyncError::NotSent(_)), "{error:?}");
    assert_eq!(error.code(), "NETWORK_ERROR");
    assert!(error.not_sent());
}

#[tokio::test]
async fn an_unknown_host_is_not_sent() {
    let error = meta("https://keystone-desktop-test.invalid").await;
    assert!(matches!(error, SyncError::NotSent(_)), "{error:?}");
    assert_eq!(error.code(), "NETWORK_ERROR");
}

#[tokio::test]
async fn a_handshake_that_is_not_tls_is_not_a_certificate_problem() {
    let port = plain_text_server(1);
    let error = meta(&format!("https://localhost:{port}")).await;
    assert!(matches!(error, SyncError::NotSent(_)), "{error:?}");
    assert_eq!(error.code(), "NETWORK_ERROR");
}

#[tokio::test]
async fn the_proxy_tells_the_certificate_apart_without_the_query() {
    let port = tls_server(1);
    let (client, _store) = signed_in_client(format!("https://localhost:{port}"));
    let error = client
        .proxy(&get_with_secret())
        .await
        .expect_err("untrusted");
    assert_eq!(error.code(), "TLS_CERTIFICATE_INVALID");
    let shown = format!("{error} {error:?}");
    assert!(!shown.contains(SECRET_QUERY), "{shown}");
    assert!(!shown.contains("access-1"), "{shown}");

    let closed = closed_port();
    let (client, _store) = signed_in_client(format!("https://localhost:{closed}"));
    let error = client.proxy(&get_with_secret()).await.expect_err("closed");
    assert!(matches!(error, SyncError::NotSent(_)), "{error:?}");
    let shown = format!("{error} {error:?}");
    assert!(!shown.contains(SECRET_QUERY), "{shown}");
}

/// A refresh refused at the handshake was never sent: the refresh token
/// goes back into the store, as for a refused connection.
#[tokio::test]
async fn a_refresh_refused_at_the_certificate_keeps_the_tokens() {
    let port = tls_server(1);
    let (client, _store) = signed_in_client(format!("https://localhost:{port}"));
    let request = DeviceRefreshRequest {
        refresh_token: tokens().refresh_token.expose().to_owned(),
    };
    let error = client.refresh(&request).await.expect_err("untrusted");
    assert_eq!(error.code(), "TLS_CERTIFICATE_INVALID");
    let record = client.session().record().expect("record");
    let kept = record.tokens.expect("tokens kept");
    assert_eq!(kept.refresh_token.expose(), tokens().refresh_token.expose());
}

/// Every untrusted certificate is the certificate code, whatever is wrong
/// with it and whatever the address, and the text never names the address.
/// (Which reason is named depends on the platform verifier: Windows reports
/// an untrusted self-signed root as `unknown issuer` before it looks at the
/// dates or the name.)
#[tokio::test]
async fn expired_and_wrong_name_certificates_are_the_certificate_code() {
    for (label, cert, key, host) in [
        ("self-signed by address", CERT, KEY, "127.0.0.1"),
        ("expired", EXPIRED_CERT, EXPIRED_KEY, "localhost"),
        ("wrong name", WRONG_NAME_CERT, WRONG_NAME_KEY, "localhost"),
    ] {
        let port = tls_server_with(cert, key, 1);
        let error = meta(&format!("https://{host}:{port}")).await;
        assert!(
            matches!(error, SyncError::CertificateInvalid(_)),
            "{label}: {error:?}"
        );
        assert_eq!(error.code(), "TLS_CERTIFICATE_INVALID", "{label}");
        let text = format!("{error} {error:?}");
        assert!(!text.contains(host), "{label}: {text}");
        assert!(!text.contains(&port.to_string()), "{label}: {text}");
    }
}

/// A peer that reads the hello and answers with a fatal TLS alert.
fn alert_peer(alert: u8) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    std::thread::spawn(move || {
        for socket in listener.incoming().take(1) {
            let Ok(mut socket) = socket else { continue };
            let mut buffer = [0u8; 4096];
            let _ = socket.read(&mut buffer);
            let _ = socket.write_all(&[0x15, 0x03, 0x03, 0x00, 0x02, 0x02, alert]);
            std::thread::sleep(Duration::from_millis(200));
        }
    });
    port
}

/// The server refuses the handshake with a `bad_certificate` (42) or
/// `certificate_unknown` (46) alert: its text speaks of a certificate, but it
/// is no verdict on the server's certificate. Told by type, it stays a
/// connection that could not be made.
#[tokio::test]
async fn a_certificate_alert_from_the_server_is_not_a_certificate_verdict() {
    for alert in [42u8, 46] {
        let port = alert_peer(alert);
        let error = meta(&format!("https://localhost:{port}")).await;
        assert!(matches!(error, SyncError::NotSent(_)), "{alert}: {error:?}");
        assert_eq!(error.code(), "NETWORK_ERROR");
    }
}
