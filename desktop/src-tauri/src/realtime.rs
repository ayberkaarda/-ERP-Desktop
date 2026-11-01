//! Realtime bridge of the active profile: runs the `keystone-realtime`
//! connection for the signed-in user and hands its events to the sync loop
//! and the webview ([`crate::REALTIME_EVENT`]).
//!
//! [`Bridge`] lives and dies with the profile ([`crate::bootstrap::Desktop`]
//! starts and stops it next to the sync loop, on the engine runtime). What
//! it does comes from the meta snapshot of the profile: no Reverb key or
//! host is `disabled`; plain `ws://` is refused unless the debug-only dev
//! flag allows it (`unavailable`, no retry).
//!
//! Rules this module keeps:
//! - A connection belongs to one sign-in generation, read when it opens.
//!   The bridge looks at the session again on every sign-in of the shell
//!   and every engine status change (a sign-out is one), and a generation
//!   that moved (or tokens that are gone) closes the connection; the next
//!   one subscribes the user of the new sign-in. A revocation thus always
//!   arrives on the connection of the sign-in it concerns, and the one
//!   still in the channel of an older connection changes nothing.
//! - `.session.revoked`: the tokens of that generation go
//!   (`Session::forget_tokens`, a compare-and-set), then a `Trigger::Manual`
//!   run meets the missing tokens and the engine turns to `AuthRequired`,
//!   then the UI is told. Never a sign-out: unsent work and local data stay
//!   for the next sign-in.
//! - `.membership.revoked`: `Trigger::Manual` and the UI is told.
//! - `.notification.created`: to the webview only.
//! - The broadcasting call runs on its own task: the connection drops the
//!   `authorize` future on its timeout and on shutdown, and the call, with
//!   any refresh in it, goes on to its end regardless.

use std::sync::Arc;
use std::time::Duration;

use keystone_realtime::{
    AuthRequest, AuthorizeError, ChannelAuth, ChannelAuthorizer, ConfigError, Options,
    RealtimeConfig, RealtimeEvent, RealtimeState, ReverbParams, StopReason, user_channel,
};
use keystone_sync::SyncError;
use keystone_sync::client::{HttpClient, ProxyMethod, ProxyRequest};
use keystone_sync::engine::{SyncHandle, SyncStatus, Trigger};
use keystone_sync::wire::ErrorCode;
use serde_json::Value;
use tauri::State;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::bootstrap::{Desktop, answer_json};
use crate::commands::CommandResult;
use crate::dto::realtime::{RealtimeEventDto, RealtimeStateDto, RealtimeStatusDto};
use crate::profiles::ReverbSnapshot;
use crate::runtime::EngineRuntime;

/// How long [`Bridge::close`] waits before it cuts the bridge off.
const CLOSE_WAIT: Duration = Duration::from_secs(3);

const ME_PATH: &str = "/api/v1/auth/me";

/// Where the bridge delivers events (the Tauri app, or a test recorder).
pub trait RealtimeSink: Send + Sync + 'static {
    fn emit(&self, event: RealtimeEventDto);
}

/// Emits to every webview of the app as [`crate::REALTIME_EVENT`].
pub struct TauriRealtimeSink<R: tauri::Runtime>(pub tauri::AppHandle<R>);

impl<R: tauri::Runtime> RealtimeSink for TauriRealtimeSink<R> {
    fn emit(&self, event: RealtimeEventDto) {
        use tauri::Emitter;
        if let Err(error) = self.0.emit(crate::REALTIME_EVENT, &event) {
            log::warn!("realtime event not delivered: {error}");
        }
    }
}

/// `reverb` of the profile's meta snapshot, field by field.
pub fn reverb_params(reverb: &ReverbSnapshot) -> ReverbParams {
    ReverbParams {
        host: reverb.host.clone(),
        port: reverb.port,
        scheme: reverb.scheme.clone(),
        key: reverb.key.clone(),
    }
}

/// What the connection of a profile can be, from its meta.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Plan {
    Connect(RealtimeConfig),
    Disabled,
    Refused,
}

impl Plan {
    fn first_state(&self) -> RealtimeStateDto {
        match self {
            Self::Connect(_) => RealtimeStateDto::Idle,
            Self::Disabled => RealtimeStateDto::Disabled,
            Self::Refused => RealtimeStateDto::Unavailable,
        }
    }
}

fn plan(reverb: &ReverbParams, app_version: &str, allow_dev_plain: bool) -> Plan {
    match RealtimeConfig::from_params(reverb, app_version, allow_dev_plain) {
        Ok(Some(config)) => Plan::Connect(config),
        Ok(None) => Plan::Disabled,
        Err(error) => {
            log_refused(&error);
            Plan::Refused
        }
    }
}

fn log_refused(error: &ConfigError) {
    log::warn!("realtime not started: {error}");
}

/// Signs channels with the profile's client, for one sign-in generation.
struct Authorizer {
    client: Arc<HttpClient>,
    generation: u64,
}

impl ChannelAuthorizer for Authorizer {
    fn authorize(
        &self,
        request: AuthRequest<'_>,
    ) -> impl Future<Output = Result<ChannelAuth, AuthorizeError>> + Send {
        let client = self.client.clone();
        let generation = self.generation;
        let socket_id = request.socket_id.to_owned();
        let channel = request.channel_name.to_owned();
        // Started here, not on the first poll: from now on the call does not
        // depend on the returned future being kept.
        let call = tauri::async_runtime::spawn(async move {
            client
                .broadcasting_auth(&socket_id, &channel, generation)
                .await
        });
        async move {
            match call.await {
                Ok(Ok(body)) => ChannelAuth::from_response_body(&body),
                Ok(Err(error)) => Err(authorize_error(&error)),
                Err(_) => Err(AuthorizeError::Unavailable),
            }
        }
    }
}

fn authorize_error(error: &SyncError) -> AuthorizeError {
    match error {
        error if ends_the_session(error) => AuthorizeError::Unauthenticated,
        SyncError::Api { status: 403, .. } => AuthorizeError::Denied,
        _ => AuthorizeError::Unavailable,
    }
}

/// No use trying again before the session changes.
fn ends_the_session(error: &SyncError) -> bool {
    matches!(
        error,
        SyncError::Api {
            code: ErrorCode::Unauthenticated | ErrorCode::UserDeactivated,
            ..
        }
    )
}

/// The generation a connection can be opened for: tokens there, no
/// deactivation. An unreadable record counts as none.
fn signed_in(client: &HttpClient) -> Option<u64> {
    match client.session().record() {
        Ok(record) if record.tokens.is_some() && !record.deactivated => Some(record.generation),
        Ok(_) => None,
        Err(error) => {
            log::warn!("realtime: session not readable: {}", error.code());
            None
        }
    }
}

/// Why the user of a sign-in is not known.
enum NoUser {
    /// The session cannot answer until it changes.
    SessionEnded,
    /// Offline, server trouble: try again.
    Retry,
}

/// Id of the user of sign-in `generation` (for the channel name).
async fn user_of(client: &HttpClient, generation: u64) -> Result<String, NoUser> {
    let request = ProxyRequest {
        method: ProxyMethod::Get,
        path: ME_PATH.to_owned(),
        query: Vec::new(),
        headers: Vec::new(),
        body: None,
    };
    let response = client
        .proxy_in(&request, generation)
        .await
        .map_err(|error| {
            if ends_the_session(&error) {
                NoUser::SessionEnded
            } else {
                NoUser::Retry
            }
        })?;
    let body: Value = answer_json(&response).map_err(|_| NoUser::Retry)?;
    body["data"]["user"]["id"]
        .as_str()
        .map(str::to_owned)
        .ok_or(NoUser::Retry)
}

/// What an event of the connection does.
struct Handler {
    profile_id: String,
    client: Arc<HttpClient>,
    sync: Option<SyncHandle>,
    sink: Arc<dyn RealtimeSink>,
}

impl Handler {
    /// Handles `event` of the connection opened for sign-in `generation`.
    async fn handle(&self, event: RealtimeEvent, generation: u64) {
        let profile_id = self.profile_id.clone();
        match event {
            RealtimeEvent::SessionRevoked { reason } => {
                match self.client.session().forget_tokens(generation).await {
                    Ok(true) => {}
                    Ok(false) => {
                        log::info!("realtime: revocation of an earlier sign-in ignored");
                        return;
                    }
                    // The server has ended the session anyway: the next call
                    // finds out, and the user is told now.
                    Err(error) => log::warn!("realtime: tokens not dropped: {}", error.code()),
                }
                self.run_sync();
                self.sink
                    .emit(RealtimeEventDto::SessionRevoked { profile_id, reason });
            }
            RealtimeEvent::MembershipRevoked { company_id } => {
                self.run_sync();
                self.sink.emit(RealtimeEventDto::MembershipRevoked {
                    profile_id,
                    company_id,
                });
            }
            RealtimeEvent::NotificationCreated(notification) => {
                self.sink.emit(RealtimeEventDto::NotificationCreated {
                    profile_id,
                    notification: notification.into(),
                });
            }
            RealtimeEvent::Subscribed { .. } | RealtimeEvent::Stopped(_) => {}
            RealtimeEvent::SubscriptionFailed { reason, .. } => {
                log::warn!("realtime: subscription failed: {reason:?}");
            }
        }
    }

    fn run_sync(&self) {
        if let Some(sync) = &self.sync {
            sync.trigger(Trigger::Manual);
        }
    }
}

/// What a bridge of one profile works with.
pub struct Link {
    pub profile_id: String,
    pub client: Arc<HttpClient>,
    pub reverb: ReverbParams,
    pub app_version: String,
    /// The dev flag: [`crate::bootstrap::allow_http`].
    pub allow_dev_plain: bool,
    /// The profile's sync loop; `None` while it does not run.
    pub sync: Option<SyncHandle>,
    /// Engine status: tokens can go with any run.
    pub status: watch::Receiver<SyncStatus>,
    /// Moves on every sign-in of the shell.
    pub sessions: watch::Receiver<u64>,
    pub sink: Arc<dyn RealtimeSink>,
    pub options: Options,
}

/// The running bridge of the active profile.
pub struct Bridge {
    state: watch::Receiver<RealtimeStateDto>,
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
}

impl Bridge {
    /// Starts the bridge on the engine runtime.
    pub fn start(runtime: &EngineRuntime, link: Link) -> Self {
        let plan = plan(&link.reverb, &link.app_version, link.allow_dev_plain);
        let (state_tx, state) = watch::channel(plan.first_state());
        let (shutdown, stop) = watch::channel(false);
        let worker = Worker {
            handler: Handler {
                profile_id: link.profile_id,
                client: link.client,
                sync: link.sync,
                sink: link.sink,
            },
            state: state_tx,
            stop,
            status: Some(link.status),
            sessions: Some(link.sessions),
            options: link.options,
        };
        let task = runtime.spawn(worker.run(plan));
        Self {
            state,
            shutdown,
            task,
        }
    }

    pub fn state(&self) -> RealtimeStateDto {
        *self.state.borrow()
    }

    /// Closes the connection and waits for the bridge; a bridge stuck longer
    /// than [`CLOSE_WAIT`] (a token write behind a slow refresh) is cut off.
    pub async fn close(mut self) {
        self.shutdown.send_replace(true);
        if tokio::time::timeout(CLOSE_WAIT, &mut self.task)
            .await
            .is_err()
        {
            self.task.abort();
            let _ = self.task.await;
        }
    }
}

/// How a connection ended.
enum Ended {
    /// The bridge is closing.
    Shutdown,
    /// The sign-in it was opened for is not the current one any more.
    SessionMoved,
    /// It stopped by itself; only another sign-in can change that.
    Stopped,
}

struct Worker {
    handler: Handler,
    state: watch::Sender<RealtimeStateDto>,
    stop: watch::Receiver<bool>,
    status: Option<watch::Receiver<SyncStatus>>,
    sessions: Option<watch::Receiver<u64>>,
    options: Options,
}

impl Worker {
    async fn run(mut self, plan: Plan) {
        let first = plan.first_state();
        self.announce(first);
        match plan {
            Plan::Connect(config) => {
                self.supervise(config).await;
                self.publish(RealtimeStateDto::Idle);
            }
            Plan::Disabled | Plan::Refused => wait_stop(&mut self.stop).await,
        }
    }

    /// One connection per sign-in, for as long as the profile is open.
    async fn supervise(&mut self, config: RealtimeConfig) {
        // The generation given up on: it is not tried again.
        let mut retired = None;
        let mut failures = 0;
        loop {
            self.mark_session_seen();
            let current = signed_in(&self.handler.client);
            let Some(generation) = current.filter(|g| Some(*g) != retired) else {
                if current.is_none() {
                    self.publish(RealtimeStateDto::Idle);
                }
                tokio::select! {
                    biased;
                    () = wait_stop(&mut self.stop) => return,
                    () = session_news(&mut self.status, &mut self.sessions) => continue,
                }
            };
            self.publish(RealtimeStateDto::Connecting);
            let client = self.handler.client.clone();
            let user = tokio::select! {
                biased;
                () = wait_stop(&mut self.stop) => return,
                user = user_of(&client, generation) => user,
            };
            let user = match user {
                Ok(user) => user,
                Err(NoUser::SessionEnded) => {
                    self.publish(RealtimeStateDto::Idle);
                    retired = Some(generation);
                    continue;
                }
                Err(NoUser::Retry) => {
                    self.publish(RealtimeStateDto::Unavailable);
                    failures += 1;
                    let delay = self.options.backoff.delay(failures, 0.5);
                    tokio::select! {
                        biased;
                        () = wait_stop(&mut self.stop) => return,
                        () = tokio::time::sleep(delay) => continue,
                        () = session_news(&mut self.status, &mut self.sessions) => continue,
                    }
                }
            };
            failures = 0;
            match self.connection(&config, user, generation).await {
                Ended::Shutdown => return,
                Ended::SessionMoved => {}
                Ended::Stopped => retired = Some(generation),
            }
        }
    }

    /// Runs one connection to its end.
    async fn connection(
        &mut self,
        config: &RealtimeConfig,
        user: String,
        generation: u64,
    ) -> Ended {
        let authorizer = Authorizer {
            client: self.handler.client.clone(),
            generation,
        };
        let channels = vec![user_channel(&user)];
        let options = self.options.clone();
        let started =
            keystone_realtime::start(config.clone(), channels, authorizer, generation, options);
        let (handle, mut events) = match started {
            Ok(started) => started,
            Err(error) => {
                log_refused(&error);
                self.publish(RealtimeStateDto::Unavailable);
                return Ended::Stopped;
            }
        };
        let mut connection = handle.watch_state();
        self.publish(RealtimeStateDto::from(*connection.borrow_and_update()));
        let ended = self.follow(&mut events, &mut connection, generation).await;
        // Close frame sent and the task gone before anything else opens.
        handle.close().await;
        if !matches!(ended, Ended::Shutdown) {
            let last = *connection.borrow();
            self.publish(last.into());
        }
        ended
    }

    /// Hands on events and states until the connection has to end.
    async fn follow(
        &mut self,
        events: &mut mpsc::UnboundedReceiver<RealtimeEvent>,
        connection: &mut watch::Receiver<RealtimeState>,
        generation: u64,
    ) -> Ended {
        let mut states_open = true;
        loop {
            tokio::select! {
                biased;
                () = wait_stop(&mut self.stop) => return Ended::Shutdown,
                event = events.recv() => match event {
                    None | Some(RealtimeEvent::Stopped(StopReason::Fatal { .. })) => {
                        return Ended::Stopped;
                    }
                    Some(RealtimeEvent::Stopped(_)) => {
                        return if signed_in(&self.handler.client) == Some(generation) {
                            Ended::Stopped
                        } else {
                            Ended::SessionMoved
                        };
                    }
                    Some(event) => self.handler.handle(event, generation).await,
                },
                changed = connection.changed(), if states_open => match changed {
                    Ok(()) => {
                        let state = *connection.borrow_and_update();
                        self.publish(state.into());
                    }
                    Err(_) => states_open = false,
                },
                () = session_news(&mut self.status, &mut self.sessions) => {
                    if signed_in(&self.handler.client) != Some(generation) {
                        return Ended::SessionMoved;
                    }
                }
            }
        }
    }

    /// News from before the session is read below is not news.
    fn mark_session_seen(&mut self) {
        if let Some(status) = &mut self.status {
            status.borrow_and_update();
        }
        if let Some(sessions) = &mut self.sessions {
            sessions.borrow_and_update();
        }
    }

    /// Sets the state and tells the webview, when it changed.
    fn publish(&self, state: RealtimeStateDto) {
        if self.state.send_replace(state) != state {
            self.emit(state);
        }
    }

    /// Tells the webview the state the bridge starts in.
    fn announce(&self, state: RealtimeStateDto) {
        self.emit(state);
    }

    fn emit(&self, state: RealtimeStateDto) {
        self.handler.sink.emit(RealtimeEventDto::State {
            profile_id: self.handler.profile_id.clone(),
            state,
        });
    }
}

/// Resolves when the session may have changed. A source that ended (its
/// engine or desktop is going away) is dropped, so it cannot spin.
async fn session_news(
    status: &mut Option<watch::Receiver<SyncStatus>>,
    sessions: &mut Option<watch::Receiver<u64>>,
) {
    loop {
        tokio::select! {
            changed = async { status.as_mut()?.changed().await.ok() }, if status.is_some() => {
                if changed.is_some() {
                    return;
                }
                *status = None;
            }
            changed = async { sessions.as_mut()?.changed().await.ok() }, if sessions.is_some() => {
                if changed.is_some() {
                    return;
                }
                *sessions = None;
            }
            else => std::future::pending::<()>().await,
        }
    }
}

/// Resolves once the bridge is asked to stop or its owner is gone.
async fn wait_stop(stop: &mut watch::Receiver<bool>) {
    let _ = stop.wait_for(|stop| *stop).await;
}

/// The connection state of the active profile, for a webview that starts
/// listening after the state events went out.
#[tauri::command]
pub async fn realtime_status(desktop: State<'_, Desktop>) -> CommandResult<RealtimeStatusDto> {
    Ok(desktop.realtime_status().await)
}

/// Records events (tests).
#[cfg(test)]
#[derive(Debug, Default)]
pub struct Recorder {
    events: std::sync::Mutex<Vec<RealtimeEventDto>>,
    notify: tokio::sync::Notify,
}

#[cfg(test)]
impl Recorder {
    pub fn events(&self) -> Vec<RealtimeEventDto> {
        self.events.lock().unwrap().clone()
    }

    /// Waits (up to 10 s) for an event that matches `want`.
    pub async fn wait_for(&self, want: impl Fn(&RealtimeEventDto) -> bool) -> RealtimeEventDto {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let notified = self.notify.notified();
            if let Some(found) = self.events().into_iter().find(|e| want(e)) {
                return found;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                panic!("no matching realtime event; got {:?}", self.events());
            }
        }
    }
}

#[cfg(test)]
impl RealtimeSink for Recorder {
    fn emit(&self, event: RealtimeEventDto) {
        self.events.lock().unwrap().push(event);
        self.notify.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::time::Duration;

    use keystone_realtime::{Backoff, Transport};
    use keystone_sync::auth::{MemoryTokenStore, Secret, StoredTokens, TokenStore};
    use keystone_sync::client::{ApiConfig, ClientOptions, paths};
    use keystone_sync::wire::{ErrorCode, Timestamp};
    use serde_json::{Value, json};
    use uuid::Uuid;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    const PROFILE: &str = "p1";
    const PAD: &str = "0123456789abcdef0123456789abcdef";
    const CHANNEL: &str = "private-user.u1";

    fn params(host: Option<&str>, key: Option<&str>, scheme: Option<&str>) -> ReverbParams {
        ReverbParams {
            host: host.map(Into::into),
            port: Some(6001),
            scheme: scheme.map(Into::into),
            key: key.map(Into::into),
        }
    }

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

    fn client(base_url: &str, store: &Arc<MemoryTokenStore>) -> Arc<HttpClient> {
        Arc::new(
            HttpClient::new(
                &ApiConfig {
                    base_url: base_url.into(),
                    company_id: Uuid::nil(),
                    user_agent: "keystone-desktop-test".into(),
                },
                PROFILE,
                Arc::clone(store),
                &ClientOptions {
                    connect_timeout: Duration::from_secs(2),
                    request_timeout: Duration::from_secs(10),
                    allow_http_localhost: true,
                },
            )
            .unwrap(),
        )
    }

    fn signed_in() -> Arc<MemoryTokenStore> {
        Arc::new(MemoryTokenStore::signed_in(PROFILE, &tokens(1)))
    }

    fn api_error(status: u16, code: ErrorCode) -> SyncError {
        SyncError::Api {
            status,
            code,
            message: "x".into(),
            fields: BTreeMap::new(),
            retry_after: None,
            redacted: None,
        }
    }

    #[test]
    fn a_meta_without_key_or_host_means_disabled() {
        for params in [
            ReverbParams::default(),
            params(None, Some("key"), Some("https")),
            params(Some("ws.example.com"), None, Some("https")),
            params(Some(""), Some(""), None),
        ] {
            assert_eq!(plan(&params, "0.1.0", true), Plan::Disabled, "{params:?}");
        }
    }

    #[test]
    fn the_socket_url_comes_from_the_meta() {
        let reverb = params(Some("ws.example.com"), Some("key"), Some("https"));
        let Plan::Connect(config) = plan(&reverb, "0.1.0", false) else {
            panic!("not connectable");
        };
        assert_eq!(config.transport(), Transport::Tls);
        assert_eq!(
            config.url().as_str(),
            "wss://ws.example.com:6001/app/key?protocol=7&client=keystone-desktop&version=0.1.0"
        );
    }

    #[test]
    fn plain_ws_needs_the_dev_flag() {
        let reverb = params(Some("127.0.0.1"), Some("key"), Some("http"));
        assert_eq!(plan(&reverb, "0.1.0", false), Plan::Refused);
        let flagged = plan(&reverb, "0.1.0", true);
        if cfg!(debug_assertions) {
            assert!(matches!(flagged, Plan::Connect(_)), "{flagged:?}");
        } else {
            assert_eq!(flagged, Plan::Refused);
        }
        let remote = params(Some("ws.example.com"), Some("key"), Some("ws"));
        assert_eq!(plan(&remote, "0.1.0", true), Plan::Refused);
    }

    #[test]
    fn broadcasting_errors_map_to_what_the_connection_does() {
        for (error, want) in [
            (
                api_error(401, ErrorCode::Unauthenticated),
                AuthorizeError::Unauthenticated,
            ),
            (
                api_error(403, ErrorCode::UserDeactivated),
                AuthorizeError::Unauthenticated,
            ),
            (api_error(403, ErrorCode::Forbidden), AuthorizeError::Denied),
            (
                api_error(500, ErrorCode::ServerError),
                AuthorizeError::Unavailable,
            ),
            (
                api_error(429, ErrorCode::TooManyAttempts),
                AuthorizeError::Unavailable,
            ),
            (
                SyncError::Network("gone".into()),
                AuthorizeError::Unavailable,
            ),
            (
                SyncError::TokenStore("locked".into()),
                AuthorizeError::Unavailable,
            ),
        ] {
            assert_eq!(authorize_error(&error), want, "{error:?}");
        }
    }

    #[tokio::test]
    async fn the_authorizer_answers_with_the_server_signature() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(paths::BROADCASTING_AUTH))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"auth": "key:sig"})))
            .mount(&server)
            .await;
        let store = signed_in();
        let authorizer = Authorizer {
            client: client(&server.uri(), &store),
            generation: 1,
        };
        let request = AuthRequest {
            socket_id: "1.1",
            channel_name: CHANNEL,
        };
        assert!(authorizer.authorize(request).await.is_ok());

        // A later sign-in: this connection's authorizer sends nothing more.
        let session = authorizer.client.session();
        session.sign_in(&tokens(2)).await.unwrap();
        let before = server.received_requests().await.unwrap().len();
        let outcome = authorizer.authorize(request).await;
        assert_eq!(outcome.unwrap_err(), AuthorizeError::Unauthenticated);
        assert_eq!(server.received_requests().await.unwrap().len(), before);
    }

    #[tokio::test]
    async fn a_dropped_authorize_still_finishes_the_call_and_its_refresh() {
        let server = MockServer::start().await;
        let expired = format!("Bearer {}", access(1));
        Mock::given(method("POST"))
            .and(path(paths::BROADCASTING_AUTH))
            .and(header("authorization", expired.as_str()))
            .respond_with(
                ResponseTemplate::new(401)
                    .set_body_json(json!({"errors": {"message": "x", "code": "UNAUTHENTICATED"}})),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(paths::DEVICE_REFRESH))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(token_body(2))
                    .set_delay(Duration::from_millis(400)),
            )
            .mount(&server)
            .await;
        let fresh = format!("Bearer {}", access(2));
        Mock::given(method("POST"))
            .and(path(paths::BROADCASTING_AUTH))
            .and(header("authorization", fresh.as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"auth": "key:sig"})))
            .mount(&server)
            .await;
        let store = signed_in();
        let authorizer = Authorizer {
            client: client(&server.uri(), &store),
            generation: 1,
        };

        // The connection gives up (its timeout, a shutdown) mid-refresh.
        let request = AuthRequest {
            socket_id: "1.1",
            channel_name: CHANNEL,
        };
        let cut =
            tokio::time::timeout(Duration::from_millis(150), authorizer.authorize(request)).await;
        assert!(cut.is_err(), "the call was cut short");
        drop(authorizer);

        // The refresh landed and the retried call went out with its token.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        loop {
            let calls = server.received_requests().await.unwrap();
            let retried = calls.iter().any(|call| {
                call.url.path() == paths::BROADCASTING_AUTH
                    && call
                        .headers
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        == Some(fresh.as_str())
            });
            if retried {
                break;
            }
            assert!(tokio::time::Instant::now() < deadline, "call not finished");
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let stored = store.load_record(PROFILE).unwrap().tokens.unwrap();
        assert_eq!(stored.access_token, Secret::new(access(2)));
    }

    fn handler(store: &Arc<MemoryTokenStore>, sink: &Arc<Recorder>) -> Handler {
        Handler {
            profile_id: PROFILE.into(),
            client: client("http://127.0.0.1:9", store),
            sync: None,
            sink: sink.clone(),
        }
    }

    #[tokio::test]
    async fn a_revocation_of_an_earlier_sign_in_changes_nothing() {
        let store = signed_in();
        let sink = Arc::new(Recorder::default());
        let handler = handler(&store, &sink);
        let session = handler.client.session();
        session.sign_in(&tokens(2)).await.unwrap();

        // Still in the channel of the old connection when the sign-in came.
        handler
            .handle(RealtimeEvent::SessionRevoked { reason: "x".into() }, 1)
            .await;

        let record = store.load_record(PROFILE).unwrap();
        assert_eq!(record.generation, 2);
        assert_eq!(record.tokens.unwrap().access_token, Secret::new(access(2)));
        assert!(sink.events().is_empty());
    }

    #[tokio::test]
    async fn a_revocation_of_the_current_sign_in_drops_its_tokens_and_tells_the_ui() {
        let store = signed_in();
        let sink = Arc::new(Recorder::default());
        let handler = handler(&store, &sink);

        handler
            .handle(
                RealtimeEvent::SessionRevoked {
                    reason: "password_reset".into(),
                },
                1,
            )
            .await;

        let record = store.load_record(PROFILE).unwrap();
        assert_eq!(record.generation, 1);
        assert!(record.tokens.is_none());
        assert!(!record.deactivated);
        assert_eq!(
            sink.events(),
            [RealtimeEventDto::SessionRevoked {
                profile_id: PROFILE.into(),
                reason: "password_reset".into(),
            }]
        );
    }

    fn link(
        reverb: ReverbParams,
        allow_dev_plain: bool,
        store: &Arc<MemoryTokenStore>,
        sink: &Arc<Recorder>,
    ) -> (Link, watch::Sender<SyncStatus>, watch::Sender<u64>) {
        let (status_tx, status) = watch::channel(SyncStatus::default());
        let (sessions_tx, sessions) = watch::channel(0);
        let link = Link {
            profile_id: PROFILE.into(),
            client: client("http://127.0.0.1:9", store),
            reverb,
            app_version: "0.1.0".into(),
            allow_dev_plain,
            sync: None,
            status,
            sessions,
            sink: sink.clone(),
            options: Options {
                backoff: Backoff {
                    initial: Duration::from_millis(10),
                    max: Duration::from_millis(20),
                    jitter: 0.0,
                },
                ..Options::default()
            },
        };
        (link, status_tx, sessions_tx)
    }

    #[tokio::test]
    async fn a_refused_socket_is_unavailable_and_never_called() {
        let runtime = EngineRuntime::start().unwrap();
        let store = signed_in();
        let sink = Arc::new(Recorder::default());
        let reverb = params(Some("127.0.0.1"), Some("key"), Some("http"));
        let (link, _status, _sessions) = link(reverb, false, &store, &sink);

        let bridge = Bridge::start(&runtime, link);
        sink.wait_for(|e| {
            matches!(
                e,
                RealtimeEventDto::State {
                    state: RealtimeStateDto::Unavailable,
                    ..
                }
            )
        })
        .await;
        assert_eq!(bridge.state(), RealtimeStateDto::Unavailable);
        bridge.close().await;
        // No user lookup, no connection: the refused state was the last word.
        assert_eq!(sink.events().len(), 1, "{:?}", sink.events());
    }

    #[tokio::test]
    async fn a_disabled_bridge_says_so_at_once_and_closes() {
        let runtime = EngineRuntime::start().unwrap();
        let store = signed_in();
        let sink = Arc::new(Recorder::default());
        let (link, _status, _sessions) = link(ReverbParams::default(), true, &store, &sink);

        let bridge = Bridge::start(&runtime, link);
        assert_eq!(bridge.state(), RealtimeStateDto::Disabled);
        tokio::time::timeout(Duration::from_secs(5), bridge.close())
            .await
            .expect("bridge ends");
        assert_eq!(
            sink.events(),
            [RealtimeEventDto::State {
                profile_id: PROFILE.into(),
                state: RealtimeStateDto::Disabled,
            }]
        );
    }

    #[tokio::test]
    async fn closing_does_not_wait_for_a_user_lookup_in_flight() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/auth/me"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(30)))
            .mount(&server)
            .await;
        let runtime = EngineRuntime::start().unwrap();
        let store = signed_in();
        let sink = Arc::new(Recorder::default());
        let reverb = params(Some("127.0.0.1"), Some("key"), Some("http"));
        let (mut link, _status, _sessions) = link(reverb, true, &store, &sink);
        link.client = client(&server.uri(), &store);

        let bridge = Bridge::start(&runtime, link);
        sink.wait_for(|e| {
            matches!(
                e,
                RealtimeEventDto::State {
                    state: RealtimeStateDto::Connecting,
                    ..
                }
            )
        })
        .await;
        tokio::time::timeout(Duration::from_secs(5), bridge.close())
            .await
            .expect("bridge ends");
    }
}
