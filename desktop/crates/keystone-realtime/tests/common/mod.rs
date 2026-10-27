//! Local fake Reverb server (plain tokio-tungstenite) and a fake authorizer.
#![allow(dead_code)]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use keystone_realtime::{
    AuthRequest, AuthorizeError, Backoff, ChannelAuth, ChannelAuthorizer, Options, RealtimeConfig,
    RealtimeEvent, RealtimeHandle, RealtimeState, ReverbParams,
};
use serde_json::{Value, json};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::handshake::server::{Request, Response};
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::{WebSocketStream, accept_hdr_async};

pub const KEY: &str = "test-key";
pub const CHANNEL: &str = "private-user.u1";
pub const WAIT: Duration = Duration::from_secs(5);

/// What the fake server's `broadcasting/auth` would return.
pub fn signature(socket_id: &str, channel: &str) -> String {
    format!("{KEY}:SECRETSIG-{socket_id}-{channel}")
}

pub struct FakeServer {
    pub port: u16,
    attempts: mpsc::UnboundedReceiver<Result<Conn, Refused>>,
}

/// A connection that did not upgrade to a WebSocket.
#[derive(Debug)]
pub struct Refused {
    /// First bytes the client sent (0x16 0x03 opens a TLS handshake).
    pub first_bytes: Vec<u8>,
}

pub struct Conn {
    pub ws: WebSocketStream<TcpStream>,
    pub uri: String,
}

/// What the server side read next.
#[derive(Debug)]
pub enum Read {
    Text(Value),
    Close(Option<CloseFrame>),
    Ended,
}

impl FakeServer {
    // The handshake callback signature is fixed by tungstenite.
    #[allow(clippy::result_large_err)]
    pub async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, attempts) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let tx = tx.clone();
                tokio::spawn(async move {
                    let mut first = [0u8; 3];
                    let n = timeout(WAIT, tcp.peek(&mut first))
                        .await
                        .ok()
                        .and_then(Result::ok)
                        .unwrap_or(0);
                    let first_bytes = first[..n].to_vec();
                    let uri = Arc::new(Mutex::new(String::new()));
                    let seen = uri.clone();
                    let accepted = accept_hdr_async(tcp, move |req: &Request, resp: Response| {
                        *seen.lock().unwrap() = req.uri().to_string();
                        Ok(resp)
                    })
                    .await;
                    let _ = tx.send(
                        accepted
                            .map(|ws| Conn {
                                ws,
                                uri: uri.lock().unwrap().clone(),
                            })
                            .map_err(|_| Refused { first_bytes }),
                    );
                });
            }
        });
        Self { port, attempts }
    }

    /// Next connection attempt, upgraded or not.
    pub async fn next_attempt(&mut self) -> Result<Conn, Refused> {
        timeout(WAIT, self.attempts.recv())
            .await
            .expect("no connection attempt")
            .expect("server gone")
    }

    pub async fn next_conn(&mut self) -> Conn {
        self.next_attempt().await.expect("websocket upgrade failed")
    }

    /// True when no attempt arrives within `d`.
    pub async fn quiet_for(&mut self, d: Duration) -> bool {
        timeout(d, self.attempts.recv()).await.is_err()
    }

    pub fn params(&self) -> ReverbParams {
        ReverbParams {
            host: Some("127.0.0.1".into()),
            port: Some(self.port),
            scheme: Some("http".into()),
            key: Some(KEY.into()),
        }
    }

    pub fn config(&self) -> RealtimeConfig {
        RealtimeConfig::from_params(&self.params(), "9.9.9", true)
            .unwrap()
            .unwrap()
    }
}

impl Conn {
    pub async fn send(&mut self, frame: Value) {
        self.ws
            .send(Message::text(frame.to_string()))
            .await
            .unwrap();
    }

    pub async fn established(&mut self, socket_id: &str, activity_timeout: u64) {
        let data = json!({"socket_id": socket_id, "activity_timeout": activity_timeout});
        self.send(json!({"event": "pusher:connection_established", "data": data.to_string()}))
            .await;
    }

    pub async fn event(&mut self, channel: &str, event: &str, data: Value) {
        self.send(json!({"event": event, "channel": channel, "data": data.to_string()}))
            .await;
    }

    pub async fn subscription_succeeded(&mut self, channel: &str) {
        self.send(json!({
            "event": "pusher_internal:subscription_succeeded",
            "channel": channel,
            "data": "{}"
        }))
        .await;
    }

    pub async fn read(&mut self) -> Read {
        self.read_within(WAIT).await.expect("nothing read")
    }

    /// `None` when nothing arrives within `d`.
    pub async fn read_within(&mut self, d: Duration) -> Option<Read> {
        let deadline = tokio::time::Instant::now() + d;
        loop {
            let next = tokio::time::timeout_at(deadline, self.ws.next())
                .await
                .ok()?;
            return Some(match next {
                None | Some(Err(_)) => Read::Ended,
                Some(Ok(Message::Text(t))) => Read::Text(serde_json::from_str(t.as_str()).unwrap()),
                Some(Ok(Message::Close(f))) => Read::Close(f),
                Some(Ok(_)) => continue,
            });
        }
    }

    pub async fn recv(&mut self) -> Value {
        match self.read().await {
            Read::Text(v) => v,
            other => panic!("expected a frame, got {other:?}"),
        }
    }

    /// Handshake + expected subscribe frame + subscription_succeeded.
    pub async fn accept_client(&mut self, socket_id: &str) {
        self.established(socket_id, 30).await;
        let sub = self.recv().await;
        assert_eq!(
            sub,
            json!({
                "event": "pusher:subscribe",
                "data": {"channel": CHANNEL, "auth": signature(socket_id, CHANNEL)}
            })
        );
        self.subscription_succeeded(CHANNEL).await;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Sign,
    Deny,
    Unauthenticated,
    Unavailable,
}

#[derive(Clone)]
pub struct FakeAuthorizer {
    pub calls: Arc<Mutex<Vec<(String, String)>>>,
    pub modes: Arc<Mutex<Vec<Mode>>>,
}

impl FakeAuthorizer {
    /// Answers with `modes` in order, the last one repeating.
    pub fn new(modes: &[Mode]) -> Self {
        Self {
            calls: Arc::default(),
            modes: Arc::new(Mutex::new(modes.to_vec())),
        }
    }

    pub fn calls(&self) -> Vec<(String, String)> {
        self.calls.lock().unwrap().clone()
    }
}

impl ChannelAuthorizer for FakeAuthorizer {
    fn authorize(
        &self,
        request: AuthRequest<'_>,
    ) -> impl Future<Output = Result<ChannelAuth, AuthorizeError>> + Send {
        let socket_id = request.socket_id.to_owned();
        let channel = request.channel_name.to_owned();
        self.calls
            .lock()
            .unwrap()
            .push((socket_id.clone(), channel.clone()));
        let mode = {
            let mut modes = self.modes.lock().unwrap();
            if modes.len() > 1 {
                modes.remove(0)
            } else {
                modes[0]
            }
        };
        async move {
            match mode {
                Mode::Sign => Ok(ChannelAuth::new(signature(&socket_id, &channel))),
                Mode::Deny => Err(AuthorizeError::Denied),
                Mode::Unauthenticated => Err(AuthorizeError::Unauthenticated),
                Mode::Unavailable => Err(AuthorizeError::Unavailable),
            }
        }
    }
}

pub fn fast_options() -> Options {
    Options {
        connect_timeout: Duration::from_secs(2),
        max_activity_timeout: Duration::from_secs(30),
        pong_timeout: Duration::from_secs(1),
        backoff: Backoff {
            initial: Duration::from_millis(50),
            max: Duration::from_millis(200),
            jitter: 0.0,
        },
    }
}

pub fn start(
    server: &FakeServer,
    authorizer: FakeAuthorizer,
    options: Options,
) -> (RealtimeHandle, mpsc::UnboundedReceiver<RealtimeEvent>) {
    keystone_realtime::start(
        server.config(),
        vec![CHANNEL.to_owned()],
        authorizer,
        7,
        options,
    )
    .unwrap()
}

pub async fn next_event(rx: &mut mpsc::UnboundedReceiver<RealtimeEvent>) -> RealtimeEvent {
    timeout(WAIT, rx.recv())
        .await
        .expect("no event")
        .expect("event channel closed")
}

pub async fn wait_state(handle: &RealtimeHandle, want: RealtimeState) {
    let mut rx = handle.watch_state();
    timeout(WAIT, rx.wait_for(|s| *s == want))
        .await
        .unwrap_or_else(|_| panic!("state never became {want:?}, is {:?}", handle.state()))
        .unwrap();
}
