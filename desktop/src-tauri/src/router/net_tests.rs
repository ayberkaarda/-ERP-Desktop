//! `api_request` against real sockets, with the real resolver and outbox:
//! a write that never left this device becomes one draft; a write the
//! server read and then lost the connection of is never queued; an
//! untrusted certificate is told and neither queued nor answered locally.
//! The scripted server is the one of the client tests.

#[path = "../../../crates/keystone-sync/tests/raw_server/mod.rs"]
mod raw_server;

use std::io::Read;
use std::net::TcpListener;
use std::sync::Arc;
use std::time::{Duration, Instant};

use keystone_sync::client::{ApiConfig, ClientOptions, HttpClient};
use raw_server::Act;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde_json::json;
use uuid::Uuid;

use super::local_resolver;
use super::local_support::*;
use crate::dto::api::ResponseSource;
use crate::state::ActiveProfile;

const PARTIES: &str = "/api/v1/parties";
const TLS: &str = "../../../crates/keystone-sync/tests/tls";

impl Fixture {
    /// The same profile and engine; `api_request` goes to `base_url`.
    fn point_at(&self, base_url: &str, connect: Duration, total: Duration) {
        let client = HttpClient::new(
            &ApiConfig {
                base_url: base_url.to_owned(),
                company_id: COMPANY.parse().unwrap(),
                user_agent: "keystone-desktop-test".into(),
            },
            PROFILE,
            self.tokens.clone(),
            &ClientOptions {
                connect_timeout: connect,
                request_timeout: total,
                allow_http_localhost: true,
            },
        )
        .unwrap();
        self.state.activate(ActiveProfile {
            id: PROFILE.into(),
            client: Arc::new(client),
            engine: Some(self.engine.clone()),
        });
    }

    fn online(&self) -> bool {
        self.connectivity
            .online(PROFILE, Some(false), Instant::now())
    }
}

fn write() -> serde_json::Value {
    send("POST", PARTIES, None, Some(json!({"name": "Acme"})))
}

fn closed_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

const SHORT: Duration = Duration::from_millis(700);
const LONG: Duration = Duration::from_secs(5);

#[tokio::test(flavor = "multi_thread")]
async fn a_refused_connection_is_one_draft_and_reaches_no_server() {
    let fx = fixture(vec![]).await;
    fx.point_at(&format!("http://127.0.0.1:{}", closed_port()), SHORT, LONG);
    let answer = fx.try_call(local_resolver(), write()).await.unwrap();
    assert_eq!(answer.status, 202);
    assert_eq!(fx.outbox().len(), 1);
    assert!(!fx.online());
}

/// The server read the write and closed (FIN) or reset (RST) the
/// connection without an answer, or reset it while it arrived: the write
/// may be applied, so it is not queued (it would be sent twice) and the
/// profile stays online.
#[tokio::test(flavor = "multi_thread")]
async fn a_write_read_and_then_cut_is_never_queued() {
    for act in [
        Act::CloseAfterRead,
        Act::ResetAfterRead,
        Act::ResetBeforeRead,
        Act::ResetMidHeaders,
    ] {
        let fx = fixture(vec![]).await;
        let raw = raw_server::start(move |_, _, _| act);
        fx.point_at(&raw.url(), SHORT, LONG);
        let result = fx.try_call(local_resolver(), write()).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(result.unwrap_err().code, "NETWORK_ERROR", "{act:?}");
        let read = usize::from(matches!(act, Act::CloseAfterRead | Act::ResetAfterRead));
        assert_eq!(raw.applied_to(PARTIES), read, "{act:?}");
        assert_eq!(fx.outbox().len(), 0, "{act:?}");
        assert!(fx.online(), "{act:?}");
    }
}

/// The server closes the kept connection right after each answer (FIN or
/// RST, swept over the delay) while the next write follows at once: each
/// write is applied or queued at most once in all.
#[tokio::test(flavor = "multi_thread")]
async fn a_close_racing_the_next_write_never_doubles_it() {
    let mut doubled = Vec::new();
    for reset in [false, true] {
        for micros in [0u64, 100, 300, 700, 1500] {
            let fx = fixture(vec![]).await;
            let delay = Duration::from_micros(micros);
            let raw = raw_server::start(move |_, _, _| {
                if reset {
                    Act::AnswerThenIdleReset(delay)
                } else {
                    Act::AnswerThenIdleClose(delay)
                }
            });
            fx.point_at(&raw.url(), SHORT, LONG);
            for _ in 0..12 {
                if !fx.online() {
                    break;
                }
                let (applied, queued) = (raw.applied_to(PARTIES), fx.outbox().len());
                let result = fx.try_call(local_resolver(), write()).await;
                if result.is_err() {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                let more = (raw.applied_to(PARTIES) - applied) + (fx.outbox().len() - queued);
                if more > 1 {
                    doubled.push(format!("reset={reset} {micros}us: {more}"));
                }
            }
        }
    }
    assert!(doubled.is_empty(), "{doubled:?}");
}

/// A peer that reads the TLS hello and then holds the connection.
fn hanging_handshake(hold: Duration) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for socket in listener.incoming() {
            let Ok(mut socket) = socket else { continue };
            std::thread::spawn(move || {
                let mut buffer = [0u8; 4096];
                let _ = socket.read(&mut buffer);
                std::thread::sleep(hold);
            });
        }
    });
    port
}

#[tokio::test(flavor = "multi_thread")]
async fn timeouts_queue_only_a_write_that_never_connected() {
    // Read, never answered: a lost answer, not queued.
    let fx = fixture(vec![]).await;
    let raw = raw_server::start(|_, _, _| Act::SilentAfterRead(Duration::from_secs(10)));
    fx.point_at(&raw.url(), LONG, Duration::from_millis(800));
    let result = fx.try_call(local_resolver(), write()).await;
    assert_eq!(result.unwrap_err().code, "NETWORK_ERROR");
    assert_eq!((raw.applied_to(PARTIES), fx.outbox().len()), (1, 0));

    // A connection never made (the handshake hangs): the connect timeout
    // queues it.
    let fx = fixture(vec![]).await;
    let port = hanging_handshake(Duration::from_secs(10));
    fx.point_at(&format!("https://localhost:{port}"), SHORT, LONG);
    let answer = fx.try_call(local_resolver(), write()).await.unwrap();
    assert_eq!(answer.status, 202);
    assert_eq!(fx.outbox().len(), 1);

    // The whole-request timeout first: kept on the safe side, not queued.
    let fx = fixture(vec![]).await;
    let port = hanging_handshake(Duration::from_secs(10));
    fx.point_at(&format!("https://localhost:{port}"), LONG, SHORT);
    let result = fx.try_call(local_resolver(), write()).await;
    assert_eq!(result.unwrap_err().code, "NETWORK_ERROR");
    assert_eq!(fx.outbox().len(), 0);
}

/// A rustls server with one of the test certificates.
fn tls_server(name: &str) -> u16 {
    let read = |file: String| {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/router")
            .join(TLS)
            .join(file);
        std::fs::read(path).unwrap()
    };
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(read(format!("{name}-cert.der")))],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(read(format!("{name}-key.der")))),
        )
        .unwrap();
    let config = Arc::new(config);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
        for socket in listener.incoming() {
            let Ok(socket) = socket else { continue };
            let config = config.clone();
            std::thread::spawn(move || {
                let connection = rustls::ServerConnection::new(config).unwrap();
                let mut stream = rustls::StreamOwned::new(connection, socket);
                let mut buffer = [0u8; 4096];
                let _ = stream.read(&mut buffer);
            });
        }
    });
    port
}

/// An untrusted certificate (self-signed, expired, another name): the write
/// is told as such and not queued, the read is not answered from the local
/// copy, the profile is not turned offline, and the address is in no text.
/// The same read with the port closed does take the local copy.
#[tokio::test(flavor = "multi_thread")]
async fn an_untrusted_certificate_is_told_and_neither_queued_nor_answered_locally() {
    let invoice = || {
        row(
            Uuid::now_v7(),
            1,
            json!({"document_date": "2026-10-01", "status": "issued"}),
        )
    };
    for name in ["selfsigned", "expired", "wrongname"] {
        let fx = fixture(vec![("sales-invoices", vec![invoice()])]).await;
        let port = tls_server(name);
        fx.point_at(&format!("https://localhost:{port}"), SHORT, LONG);
        let written = fx.try_call(local_resolver(), write()).await;
        let read = fx
            .try_call(local_resolver(), get("/api/v1/sales-invoices", json!([])))
            .await;
        let error = written.unwrap_err();
        assert_eq!(error.code, "TLS_CERTIFICATE_INVALID", "{name}");
        assert_eq!(read.unwrap_err().code, "TLS_CERTIFICATE_INVALID", "{name}");
        assert_eq!(fx.outbox().len(), 0, "{name}");
        assert!(fx.online(), "{name}");
        let shown = format!("{error:?}");
        assert!(
            !shown.contains("localhost") && !shown.contains(&port.to_string()),
            "{shown}"
        );
    }
    let fx = fixture(vec![("sales-invoices", vec![invoice()])]).await;
    fx.point_at(&format!("https://localhost:{}", closed_port()), SHORT, LONG);
    let read = fx
        .try_call(local_resolver(), get("/api/v1/sales-invoices", json!([])))
        .await
        .unwrap();
    assert_eq!(read.source, ResponseSource::Local);
}
