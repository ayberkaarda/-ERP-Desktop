//! Connection task: connect, handshake, authorize and subscribe, keep alive,
//! deliver events, reconnect with backoff.

use std::collections::HashSet;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rustls::ClientConfig;
use rustls_platform_verifier::BuilderVerifierExt;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio::time::{Instant, sleep, sleep_until, timeout};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};

use crate::auth::{AuthRequest, AuthorizeError, ChannelAuthorizer};
use crate::backoff::{Backoff, jitter_unit};
use crate::config::{ConfigError, RealtimeConfig, Transport, validate_channel};
use crate::event::{RealtimeEvent, RealtimeState, StopReason, SubscriptionFailure, user_event};
use crate::protocol::{self, CodeAction, Incoming};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Pusher error code for a refused subscription signature.
const UNAUTHORIZED_SUBSCRIPTION: u16 = 4009;

/// Timing of the connection task.
#[derive(Debug, Clone, PartialEq)]
pub struct Options {
    /// TCP + TLS + WebSocket upgrade, and again for
    /// `pusher:connection_established`.
    pub connect_timeout: Duration,
    /// Upper bound for the server's `activity_timeout`: after this much
    /// silence the client sends `pusher:ping`.
    pub max_activity_timeout: Duration,
    /// Time allowed for any frame after our `pusher:ping` before the
    /// connection is dropped and reopened.
    pub pong_timeout: Duration,
    pub backoff: Backoff,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(10),
            max_activity_timeout: Duration::from_secs(120),
            pong_timeout: Duration::from_secs(30),
            backoff: Backoff::default(),
        }
    }
}

/// Owner side of a connection task. Dropping it stops the task (the socket
/// is closed with a close frame); [`RealtimeHandle::close`] also waits for
/// the task to finish.
#[derive(Debug)]
pub struct RealtimeHandle {
    state: watch::Receiver<RealtimeState>,
    shutdown: Option<watch::Sender<bool>>,
    task: Option<JoinHandle<()>>,
    generation: u64,
}

impl RealtimeHandle {
    /// Handle for a server without Reverb (`RealtimeState::Disabled`).
    pub fn disabled() -> Self {
        let (_tx, state) = watch::channel(RealtimeState::Disabled);
        Self {
            state,
            shutdown: None,
            task: None,
            generation: 0,
        }
    }

    pub fn state(&self) -> RealtimeState {
        *self.state.borrow()
    }

    pub fn watch_state(&self) -> watch::Receiver<RealtimeState> {
        self.state.clone()
    }

    /// Session generation this connection was opened for.
    pub fn generation(&self) -> u64 {
        self.generation
    }

    /// Asks the task to close the socket and stop (does not wait).
    pub fn shutdown(&self) {
        if let Some(tx) = &self.shutdown {
            tx.send_replace(true);
        }
    }

    /// Stops the connection when the session generation moved on (sign-in,
    /// sign-out, deactivation). Returns whether it was stopped.
    pub fn close_if_stale(&self, current_generation: u64) -> bool {
        if current_generation == self.generation {
            return false;
        }
        self.shutdown();
        true
    }

    /// Whether the connection task has ended.
    pub fn is_finished(&self) -> bool {
        self.task.as_ref().is_none_or(JoinHandle::is_finished)
    }

    /// Stops the task and waits until the socket is closed.
    pub async fn close(mut self) {
        self.shutdown();
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for RealtimeHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Starts the connection task on the current tokio runtime (panics outside
/// one, like `tokio::spawn`). `channels` are private channel names, e.g.
/// [`crate::user_channel`]. `generation` is the session generation the
/// tokens behind `authorizer` belong to.
pub fn start<A: ChannelAuthorizer>(
    config: RealtimeConfig,
    channels: Vec<String>,
    authorizer: A,
    generation: u64,
    options: Options,
) -> Result<(RealtimeHandle, mpsc::UnboundedReceiver<RealtimeEvent>), ConfigError> {
    for channel in &channels {
        validate_channel(channel)?;
    }
    let (state_tx, state) = watch::channel(RealtimeState::Connecting);
    let (shutdown_tx, shutdown) = watch::channel(false);
    let (events, events_rx) = mpsc::unbounded_channel();
    let task = Task {
        config,
        channels,
        authorizer,
        options,
        state: state_tx,
        events,
        shutdown,
    };
    let task = tokio::spawn(task.run());
    Ok((
        RealtimeHandle {
            state,
            shutdown: Some(shutdown_tx),
            task: Some(task),
            generation,
        },
        events_rx,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Shutdown,
    Stop(StopReason),
    Retry { established: bool, immediate: bool },
}

impl Outcome {
    fn retry(established: bool) -> Self {
        Self::Retry {
            established,
            immediate: false,
        }
    }

    fn from_code(code: u16, established: bool) -> Self {
        match protocol::code_action(code) {
            CodeAction::Stop => Self::Stop(StopReason::Fatal { code }),
            CodeAction::ReconnectNow => Self::Retry {
                established,
                immediate: true,
            },
            CodeAction::Backoff => Self::retry(established),
        }
    }
}

struct Task<A> {
    config: RealtimeConfig,
    channels: Vec<String>,
    authorizer: A,
    options: Options,
    state: watch::Sender<RealtimeState>,
    events: mpsc::UnboundedSender<RealtimeEvent>,
    shutdown: watch::Receiver<bool>,
}

impl<A: ChannelAuthorizer> Task<A> {
    async fn run(mut self) {
        let mut failures: u32 = 0;
        let final_state = loop {
            if *self.shutdown.borrow() {
                break RealtimeState::Idle;
            }
            self.state.send_replace(RealtimeState::Connecting);
            match self.connect_once().await {
                Outcome::Shutdown => break RealtimeState::Idle,
                Outcome::Stop(reason) => {
                    log::info!("realtime: stopped ({reason:?})");
                    let state = match reason {
                        StopReason::Fatal { .. } => RealtimeState::Unavailable,
                        StopReason::SessionRevoked | StopReason::SessionEnded => {
                            RealtimeState::Idle
                        }
                    };
                    self.emit(RealtimeEvent::Stopped(reason));
                    break state;
                }
                Outcome::Retry {
                    established,
                    immediate,
                } => {
                    if established {
                        failures = 0;
                    }
                    failures = failures.saturating_add(1);
                    let delay = if immediate && established {
                        Duration::ZERO
                    } else {
                        self.options.backoff.delay(failures, jitter_unit())
                    };
                    self.state.send_replace(RealtimeState::Unavailable);
                    log::info!("realtime: reconnecting in {} ms", delay.as_millis());
                    tokio::select! {
                        biased;
                        () = shutdown_requested(&mut self.shutdown) => break RealtimeState::Idle,
                        () = sleep(delay) => {}
                    }
                }
            }
        };
        self.state.send_replace(final_state);
        log::info!("realtime: {}", final_state.as_str());
    }

    fn emit(&self, event: RealtimeEvent) {
        // The receiver may be gone (shell shutting down); nothing to do then.
        let _ = self.events.send(event);
    }

    async fn connect_once(&mut self) -> Outcome {
        let origin = self.config.origin();
        let connector = match self.config.transport() {
            Transport::Tls => match tls_config() {
                Ok(config) => Connector::Rustls(config),
                Err(e) => {
                    log::warn!("realtime: tls setup failed: {e}");
                    return Outcome::retry(false);
                }
            },
            Transport::Plain => Connector::Plain,
        };
        let connecting = tokio_tungstenite::connect_async_tls_with_config(
            self.config.url().as_str(),
            None,
            false,
            Some(connector),
        );
        let mut ws = tokio::select! {
            biased;
            () = shutdown_requested(&mut self.shutdown) => return Outcome::Shutdown,
            r = timeout(self.options.connect_timeout, connecting) => match r {
                Ok(Ok((ws, _response))) => ws,
                Ok(Err(e)) => {
                    log::warn!("realtime: connect to {origin} failed: {e}");
                    return Outcome::retry(false);
                }
                Err(_) => {
                    log::warn!("realtime: connect to {origin} timed out");
                    return Outcome::retry(false);
                }
            },
        };

        let handshake = tokio::select! {
            biased;
            () = shutdown_requested(&mut self.shutdown) => {
                close(&mut ws).await;
                return Outcome::Shutdown;
            }
            r = timeout(self.options.connect_timeout, wait_established(&mut ws)) => r,
        };
        let (socket_id, server_timeout) = match handshake {
            Ok(Ok(established)) => established,
            Ok(Err(outcome)) => return outcome,
            Err(_) => {
                log::warn!("realtime: no connection_established from {origin}");
                close(&mut ws).await;
                return Outcome::retry(false);
            }
        };
        self.state.send_replace(RealtimeState::Connected);
        log::info!("realtime: connected to {origin}");
        let max = self.options.max_activity_timeout;
        let activity = server_timeout
            .filter(|s| *s > 0)
            .map_or(max, |s| Duration::from_secs(s).min(max));

        let mut pending: HashSet<String> = HashSet::new();
        for channel in &self.channels {
            let request = AuthRequest {
                socket_id: &socket_id,
                channel_name: channel,
            };
            let auth = tokio::select! {
                biased;
                () = shutdown_requested(&mut self.shutdown) => {
                    close(&mut ws).await;
                    return Outcome::Shutdown;
                }
                r = self.authorizer.authorize(request) => r,
            };
            match auth {
                Ok(auth) => {
                    let frame = protocol::subscribe(channel, &auth);
                    if ws.send(Message::text(frame)).await.is_err() {
                        return Outcome::retry(true);
                    }
                    pending.insert(channel.clone());
                }
                Err(AuthorizeError::Denied) => {
                    log::warn!("realtime: subscription to {channel} denied");
                    let _ = self.events.send(RealtimeEvent::SubscriptionFailed {
                        channel: channel.clone(),
                        reason: SubscriptionFailure::Denied,
                    });
                }
                Err(AuthorizeError::Unauthenticated) => {
                    close(&mut ws).await;
                    return Outcome::Stop(StopReason::SessionEnded);
                }
                Err(AuthorizeError::Unavailable) => {
                    log::warn!("realtime: channel authorization unavailable");
                    close(&mut ws).await;
                    return Outcome::retry(true);
                }
            }
        }

        let mut deadline = Instant::now() + activity;
        let mut awaiting_pong = false;
        loop {
            let next = tokio::select! {
                biased;
                () = shutdown_requested(&mut self.shutdown) => {
                    close(&mut ws).await;
                    return Outcome::Shutdown;
                }
                () = sleep_until(deadline) => {
                    if awaiting_pong {
                        log::warn!("realtime: no pong from {origin}, reconnecting");
                        return Outcome::retry(true);
                    }
                    if ws.send(Message::text(protocol::ping())).await.is_err() {
                        return Outcome::retry(true);
                    }
                    awaiting_pong = true;
                    deadline = Instant::now() + self.options.pong_timeout;
                    continue;
                }
                next = ws.next() => next,
            };
            let message = match next {
                None => {
                    log::info!("realtime: connection to {origin} ended");
                    return Outcome::retry(true);
                }
                Some(Err(e)) => {
                    log::warn!("realtime: connection to {origin} failed: {e}");
                    return Outcome::retry(true);
                }
                Some(Ok(message)) => message,
            };
            // Any frame proves the connection is alive.
            deadline = Instant::now() + activity;
            awaiting_pong = false;
            let text = match message {
                Message::Text(text) => text,
                Message::Close(frame) => {
                    log::info!("realtime: closed by server");
                    return frame.map_or(Outcome::retry(true), |f| {
                        Outcome::from_code(u16::from(f.code), true)
                    });
                }
                _ => continue,
            };
            match protocol::parse(text.as_str()) {
                Err(_) => log::warn!("realtime: unreadable frame dropped"),
                Ok(Incoming::Ping) => {
                    if ws.send(Message::text(protocol::pong())).await.is_err() {
                        return Outcome::retry(true);
                    }
                }
                Ok(Incoming::Pong | Incoming::Established { .. }) => {}
                Ok(Incoming::Other { event }) => log::debug!("realtime: ignored {event}"),
                Ok(Incoming::Error { code }) => {
                    log::warn!("realtime: server error {code:?}");
                    if code == Some(UNAUTHORIZED_SUBSCRIPTION) {
                        for channel in pending.drain() {
                            self.emit(RealtimeEvent::SubscriptionFailed {
                                channel,
                                reason: SubscriptionFailure::Rejected { status: code },
                            });
                        }
                    }
                }
                Ok(Incoming::SubscriptionSucceeded { channel }) => {
                    if pending.remove(&channel) {
                        log::info!("realtime: subscribed to {channel}");
                        self.emit(RealtimeEvent::Subscribed { channel });
                    }
                }
                Ok(Incoming::SubscriptionError { channel, status }) => {
                    if pending.remove(&channel) {
                        log::warn!("realtime: subscription to {channel} refused ({status:?})");
                        self.emit(RealtimeEvent::SubscriptionFailed {
                            channel,
                            reason: SubscriptionFailure::Rejected { status },
                        });
                    }
                }
                Ok(Incoming::ChannelEvent {
                    channel,
                    event,
                    data,
                }) => {
                    if !self.channels.contains(&channel) {
                        log::debug!("realtime: event on unknown channel ignored");
                        continue;
                    }
                    match user_event(&event, data) {
                        None => log::debug!("realtime: ignored {event}"),
                        Some(Err(())) => log::warn!("realtime: malformed {event} dropped"),
                        Some(Ok(parsed)) => {
                            let revoked = matches!(parsed, RealtimeEvent::SessionRevoked { .. });
                            log::info!("realtime: {event}");
                            self.emit(parsed);
                            if revoked {
                                close(&mut ws).await;
                                return Outcome::Stop(StopReason::SessionRevoked);
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Reads until `pusher:connection_established`; `Err` is what to do instead.
async fn wait_established(ws: &mut Socket) -> Result<(String, Option<u64>), Outcome> {
    loop {
        let message = match ws.next().await {
            None | Some(Err(_)) => return Err(Outcome::retry(false)),
            Some(Ok(message)) => message,
        };
        match message {
            Message::Text(text) => match protocol::parse(text.as_str()) {
                Ok(Incoming::Established {
                    socket_id,
                    activity_timeout,
                }) => return Ok((socket_id, activity_timeout)),
                Ok(Incoming::Error { code }) => {
                    log::warn!("realtime: refused during handshake ({code:?})");
                    return Err(
                        code.map_or(Outcome::retry(false), |c| Outcome::from_code(c, false))
                    );
                }
                Ok(Incoming::Ping) => {
                    if ws.send(Message::text(protocol::pong())).await.is_err() {
                        return Err(Outcome::retry(false));
                    }
                }
                Ok(_) | Err(_) => {}
            },
            Message::Close(frame) => {
                return Err(frame.map_or(Outcome::retry(false), |f| {
                    Outcome::from_code(u16::from(f.code), false)
                }));
            }
            _ => {}
        }
    }
}

/// Resolves once shutdown was requested or the handle is gone.
async fn shutdown_requested(rx: &mut watch::Receiver<bool>) {
    loop {
        if *rx.borrow_and_update() {
            return;
        }
        if rx.changed().await.is_err() {
            return;
        }
    }
}

/// Sends a close frame; the peer's reply is not awaited.
async fn close(ws: &mut Socket) {
    let _ = timeout(Duration::from_secs(1), ws.close(None)).await;
}

/// rustls with the ring provider and the OS trust store, as in keystone-sync.
fn tls_config() -> Result<Arc<ClientConfig>, rustls::Error> {
    static CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    if let Some(config) = CONFIG.get() {
        return Ok(config.clone());
    }
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .with_platform_verifier()?
        .with_no_client_auth();
    Ok(CONFIG.get_or_init(|| Arc::new(config)).clone())
}
