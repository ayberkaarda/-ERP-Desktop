//! A request that reached the server must never be called "not sent", or a
//! write would be queued and sent a second time. Real sockets on loopback:
//! a scripted HTTP server ([`raw_server`]) that cuts the connection at
//! chosen points and counts the requests it read in full, and a peer that
//! hangs inside the TLS handshake. Both client paths are covered: the proxy
//! (`api_request`) and the plain sender (meta, sync calls, refresh).

mod raw_server;

use std::io::Read;
use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;

use keystone_sync::SyncError;
use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens};
use keystone_sync::client::{
    ApiConfig, ClientOptions, HttpClient, ProxyMethod, ProxyRequest, ProxyResponse,
    fetch_server_meta,
};
use keystone_sync::wire::Timestamp;
use raw_server::Act;
use uuid::Uuid;

const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";

fn tokens() -> StoredTokens {
    StoredTokens {
        access_token: Secret::new("access-1-0123456789abcdef".to_owned()),
        access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
        refresh_token: Secret::new("refresh-1-0123456789abcdef".to_owned()),
        refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
    }
}

fn options(connect: Duration, total: Duration) -> ClientOptions {
    ClientOptions {
        connect_timeout: connect,
        request_timeout: total,
        allow_http_localhost: true,
    }
}

fn client_with(base_url: &str, connect: Duration, total: Duration) -> HttpClient {
    let store = Arc::new(MemoryTokenStore::signed_in("cut", &tokens()));
    let config = ApiConfig {
        base_url: base_url.to_owned(),
        company_id: Uuid::parse_str(COMPANY).unwrap(),
        user_agent: "keystone-desktop-test/0.1".into(),
    };
    HttpClient::new(&config, "cut", store, &options(connect, total)).unwrap()
}

fn client(base_url: &str) -> HttpClient {
    client_with(base_url, Duration::from_secs(3), Duration::from_secs(5))
}

fn post() -> ProxyRequest {
    ProxyRequest {
        method: ProxyMethod::Post,
        path: "/api/v1/parties".into(),
        query: Vec::new(),
        headers: vec![(
            "idempotency-key".into(),
            "0192f5a0-0000-7000-8000-0000000000aa".into(),
        )],
        body: Some(br#"{"name":"Acme"}"#.to_vec()),
    }
}

fn kind(result: &Result<ProxyResponse, SyncError>) -> String {
    match result {
        Ok(r) => format!("Ok({})", r.status),
        Err(SyncError::NotSent(_)) => "NotSent".into(),
        Err(SyncError::Network(_)) => "Network".into(),
        Err(other) => format!("{other:?}"),
    }
}

/// A peer that reads the TLS ClientHello and then says nothing for `hold`:
/// the handshake never ends, so no request is ever written.
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

/// The server read the write and closed (FIN) or reset (RST) without an
/// answer, or reset it while it was still arriving: the outcome is unknown
/// (`Network`), never "not sent".
#[tokio::test(flavor = "multi_thread")]
async fn a_request_read_and_then_cut_is_never_not_sent() {
    for act in [
        Act::CloseAfterRead,
        Act::ResetAfterRead,
        Act::ResetBeforeRead,
        Act::ResetMidHeaders,
    ] {
        let raw = raw_server::start(move |_, _, _| act);
        let result = client(&raw.url()).proxy(&post()).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            matches!(result, Err(SyncError::Network(_))),
            "{act:?}: {}",
            kind(&result)
        );
        let read = usize::from(matches!(act, Act::CloseAfterRead | Act::ResetAfterRead));
        // Not sent again on a new connection: at most what was read once.
        assert_eq!(raw.applied(), read, "{act:?}");
    }
}

/// The answer started and broke off in its body: the server had the
/// request. Neither the proxy nor the plain sender call it "not sent".
#[tokio::test(flavor = "multi_thread")]
async fn an_answer_cut_in_its_body_is_a_lost_answer() {
    let raw = raw_server::start(|_, _, _| Act::PartialBody);
    let result = client(&raw.url()).proxy(&post()).await;
    assert!(
        matches!(result, Err(SyncError::Network(_))),
        "{}",
        kind(&result)
    );
    assert_eq!(raw.applied(), 1);

    let error = fetch_server_meta(
        &raw.url(),
        "keystone-desktop-test/0.1",
        &options(Duration::from_secs(3), Duration::from_secs(5)),
    )
    .await
    .expect_err("cut");
    assert!(matches!(error, SyncError::Network(_)), "{error:?}");
}

/// Read, then silence until the whole-request timeout: the request was
/// sent, so it is a lost answer on both paths.
#[tokio::test(flavor = "multi_thread")]
async fn a_timeout_after_sending_is_a_lost_answer_on_both_paths() {
    let raw = raw_server::start(|_, _, _| Act::SilentAfterRead(Duration::from_secs(10)));
    let short = Duration::from_millis(800);
    let result = client_with(&raw.url(), Duration::from_secs(3), short)
        .proxy(&post())
        .await;
    assert!(
        matches!(result, Err(SyncError::Network(_))),
        "{}",
        kind(&result)
    );
    assert_eq!(raw.applied(), 1);

    let error = fetch_server_meta(
        &raw.url(),
        "keystone-desktop-test/0.1",
        &options(Duration::from_secs(3), short),
    )
    .await
    .expect_err("silent");
    assert!(matches!(error, SyncError::Network(_)), "{error:?}");
    assert_eq!(raw.applied(), 2);
}

/// A handshake that never ends: the connect timeout ends it before any
/// request was written (`NotSent`); a whole-request timeout that comes
/// first is kept on the safe side (`Network`). Both paths.
#[tokio::test(flavor = "multi_thread")]
async fn the_connect_timeout_is_not_sent_and_the_request_timeout_is_not() {
    let hold = Duration::from_secs(10);
    let (short, long) = (Duration::from_millis(700), Duration::from_secs(5));

    let url = format!("https://localhost:{}", hanging_handshake(hold));
    let result = client_with(&url, short, long).proxy(&post()).await;
    assert!(
        matches!(result, Err(SyncError::NotSent(_))),
        "{}",
        kind(&result)
    );
    let error = fetch_server_meta(&url, "keystone-desktop-test/0.1", &options(short, long))
        .await
        .expect_err("connect timeout");
    assert!(matches!(error, SyncError::NotSent(_)), "{error:?}");

    let url = format!("https://localhost:{}", hanging_handshake(hold));
    let result = client_with(&url, long, short).proxy(&post()).await;
    assert!(
        matches!(result, Err(SyncError::Network(_))),
        "{}",
        kind(&result)
    );
    let error = fetch_server_meta(&url, "keystone-desktop-test/0.1", &options(long, short))
        .await
        .expect_err("request timeout");
    assert!(matches!(error, SyncError::Network(_)), "{error:?}");
}

/// The kept connection was closed by the server while idle (FIN or RST):
/// the next write goes out on a new connection, once.
#[tokio::test(flavor = "multi_thread")]
async fn an_idle_close_of_the_kept_connection_takes_a_new_one() {
    for act in [
        Act::AnswerThenIdleClose(Duration::from_millis(100)),
        Act::AnswerThenIdleReset(Duration::from_millis(100)),
    ] {
        let raw = raw_server::start(move |conn, _, _| if conn == 0 { act } else { Act::Answer });
        let client = client(&raw.url());
        let first = client.proxy(&post()).await;
        assert!(first.is_ok(), "{}", kind(&first));
        tokio::time::sleep(Duration::from_millis(500)).await;
        let second = client.proxy(&post()).await;
        assert!(second.is_ok(), "{act:?}: {}", kind(&second));
        assert_eq!(raw.applied(), 2, "{act:?}");
        assert_eq!(raw.connections(), 2, "{act:?}");
    }
}

/// The server closes (FIN or RST) right after each answer while the client
/// sends the next write on the kept connection at once, swept over the
/// close delay. A "not sent" must never have been read by the server, and
/// nothing is read twice.
#[tokio::test(flavor = "multi_thread")]
async fn a_close_racing_the_next_write_never_doubles_it() {
    let mut bad = Vec::new();
    for reset in [false, true] {
        for micros in [0u64, 100, 300, 700, 1500, 3000] {
            let delay = Duration::from_micros(micros);
            let raw = raw_server::start(move |_, _, _| {
                if reset {
                    Act::AnswerThenIdleReset(delay)
                } else {
                    Act::AnswerThenIdleClose(delay)
                }
            });
            let client = client(&raw.url());
            for _ in 0..20 {
                let before = raw.applied();
                let result = client.proxy(&post()).await;
                if result.is_err() {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
                let read = raw.applied() - before;
                let shown = kind(&result);
                if (shown == "NotSent" && read > 0) || read > 1 {
                    bad.push(format!("reset={reset} {micros}us {shown} read {read}"));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{bad:?}");
}
