//! The realtime bridge in the running shell: the real connection task
//! against a local fake Reverb, the profile meta and `broadcasting/auth`
//! from wiremock.

use std::sync::atomic::AtomicUsize;

use futures_util::{SinkExt, StreamExt};
use keystone_sync::client::{ProxyMethod, ProxyRequest, paths};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::{WebSocketStream, accept_async};

use super::*;
use crate::dto::realtime::{RealtimeEventDto, RealtimeStateDto};

const KEY: &str = "test-key";
const WAIT: Duration = Duration::from_secs(10);
const ME: &str = "/api/v1/auth/me";
const MANIFEST: &str = "/api/v1/sync/manifest";

fn channel() -> String {
    format!("private-user.{USER}")
}

fn signature(socket_id: &str) -> String {
    format!("{KEY}:SIG-{socket_id}")
}

/// Local Reverb stand-in: every accepted WebSocket comes out of `next`.
struct FakeReverb {
    port: u16,
    conns: mpsc::UnboundedReceiver<Conn>,
}

struct Conn(WebSocketStream<TcpStream>);

impl FakeReverb {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, conns) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((tcp, _)) = listener.accept().await {
                let tx = tx.clone();
                tokio::spawn(async move {
                    if let Ok(ws) = accept_async(tcp).await {
                        let _ = tx.send(Conn(ws));
                    }
                });
            }
        });
        Self { port, conns }
    }

    async fn next(&mut self) -> Conn {
        timeout(WAIT, self.conns.recv())
            .await
            .expect("no connection")
            .expect("server gone")
    }

    /// The next socket that subscribes. A bridge that reads the session
    /// right after a sign-in connects, and a company chosen by that sign-in
    /// restarts the profile: such a socket is already dead here, and skipped.
    async fn subscribed(&mut self, socket_id: &str) -> Conn {
        loop {
            let mut conn = self.next().await;
            if conn.subscribe(socket_id).await {
                return conn;
            }
        }
    }

    /// True when nobody connects within `wait`.
    async fn quiet_for(&mut self, wait: Duration) -> bool {
        timeout(wait, self.conns.recv()).await.is_err()
    }

    fn reverb(&self) -> Value {
        json!({"host": "127.0.0.1", "port": self.port, "scheme": "http", "key": KEY})
    }
}

impl Conn {
    async fn send(&mut self, frame: Value) {
        self.0.send(Message::text(frame.to_string())).await.unwrap();
    }

    async fn event(&mut self, event: &str, data: Value) {
        self.send(json!({"event": event, "channel": channel(), "data": data.to_string()}))
            .await;
    }

    /// Handshake and subscription of the signed-in user's channel; `false`
    /// when the client is gone.
    async fn subscribe(&mut self, socket_id: &str) -> bool {
        let data = json!({"socket_id": socket_id, "activity_timeout": 30});
        let established =
            json!({"event": "pusher:connection_established", "data": data.to_string()});
        if self
            .0
            .send(Message::text(established.to_string()))
            .await
            .is_err()
        {
            return false;
        }
        let frame = loop {
            match timeout(WAIT, self.0.next()).await.expect("no frame") {
                Some(Ok(Message::Text(text))) => {
                    break serde_json::from_str::<Value>(text.as_str()).unwrap();
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => return false,
                Some(Ok(_)) => {}
            }
        };
        assert_eq!(
            frame,
            json!({
                "event": "pusher:subscribe",
                "data": {"channel": channel(), "auth": signature(socket_id)}
            })
        );
        self.send(json!({
            "event": "pusher_internal:subscription_succeeded",
            "channel": channel(),
            "data": "{}"
        }))
        .await;
        true
    }

    /// Waits for the end of the socket. The client may close with an answer
    /// of ours unread: its close frame can then be lost to a TCP reset, so a
    /// reset counts too.
    async fn closed(&mut self) {
        loop {
            let next = timeout(WAIT, self.0.next())
                .await
                .expect("socket left open");
            if matches!(next, None | Some(Err(_) | Ok(Message::Close(_)))) {
                return;
            }
        }
    }
}

/// `server` with `reverb` in its meta and a signing `broadcasting/auth`.
async fn realtime_server(reverb: &FakeReverb) -> MockServer {
    realtime_server_of(reverb, &[(COMPANY, "Acme")]).await
}

async fn realtime_server_of(reverb: &FakeReverb, companies: &[(&str, &str)]) -> MockServer {
    let server = server_with(companies, reverb.reverb()).await;
    Mock::given(method("POST"))
        .and(path(paths::BROADCASTING_AUTH))
        .respond_with(|request: &Request| {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            let socket_id = body["socket_id"].as_str().unwrap();
            ResponseTemplate::new(200).set_body_json(json!({"auth": signature(socket_id)}))
        })
        .mount(&server)
        .await;
    server
}

fn is_state(event: &RealtimeEventDto, profile: &str, want: RealtimeStateDto) -> bool {
    matches!(event, RealtimeEventDto::State { profile_id, state }
        if profile_id == profile && *state == want)
}

impl Fx {
    /// Signed in, first run pulled, socket subscribed.
    async fn connected(&self, reverb: &mut FakeReverb, server: &MockServer) -> (ProfileDto, Conn) {
        let profile = synced(self, server).await;
        let conn = reverb.subscribed("1.1").await;
        self.wait_state(&profile.id, RealtimeStateDto::Connected)
            .await;
        (profile, conn)
    }

    async fn wait_state(&self, id: &str, want: RealtimeStateDto) {
        self.realtime.wait_for(|e| is_state(e, id, want)).await;
    }

    /// Waits until the last state of `id` is `want`.
    async fn settles_on(&self, id: &str, want: RealtimeStateDto) {
        eventually("the realtime state settles", async || {
            let events = self.realtime.events();
            let last = events.iter().rev().find_map(|e| match e {
                RealtimeEventDto::State { profile_id, state } if profile_id == id => Some(*state),
                _ => None,
            });
            last == Some(want)
        })
        .await;
    }

    /// The states of `id`, in order.
    fn states(&self, id: &str) -> Vec<RealtimeStateDto> {
        let events = self.realtime.events();
        events
            .iter()
            .filter_map(|e| match e {
                RealtimeEventDto::State { profile_id, state } if profile_id == id => Some(*state),
                _ => None,
            })
            .collect()
    }

    async fn revoked_events(&self) -> usize {
        self.realtime
            .events()
            .iter()
            .filter(|e| matches!(e, RealtimeEventDto::SessionRevoked { .. }))
            .count()
    }
}

async fn manifests(server: &MockServer) -> usize {
    requests(server, MANIFEST).await.len()
}

#[tokio::test(flavor = "multi_thread")]
async fn the_signed_in_user_subscribes_with_a_signature_of_the_server() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, _conn) = fx.connected(&mut reverb, &server).await;

    let calls = requests(&server, paths::BROADCASTING_AUTH).await;
    let call = calls.last().expect("a signature was asked for");
    let body: Value = serde_json::from_slice(&call.body).unwrap();
    assert_eq!(body, json!({"socket_id": "1.1", "channel_name": channel()}));
    let bearer = call.headers.get("authorization").unwrap();
    assert!(bearer.to_str().unwrap().starts_with("Bearer access-1-"));

    let status = fx.desktop.realtime_status().await;
    assert_eq!(status.profile_id.as_deref(), Some(profile.id.as_str()));
    assert_eq!(status.state, RealtimeStateDto::Connected);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_signed_out_profile_stays_idle_and_opens_no_socket() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();

    fx.wait_state(&profile.id, RealtimeStateDto::Idle).await;
    assert!(reverb.quiet_for(Duration::from_millis(200)).await);
    assert!(requests(&server, ME).await.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn closing_a_profile_closes_its_socket_and_ends_the_bridge() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, mut conn) = fx.connected(&mut reverb, &server).await;

    fx.desktop
        .remove(&fx.state, &profile.id, true)
        .await
        .unwrap();

    conn.closed().await;
    fx.settles_on(&profile.id, RealtimeStateDto::Idle).await;
    assert!(reverb.quiet_for(Duration::from_millis(300)).await);
    let status = fx.desktop.realtime_status().await;
    assert_eq!(status.profile_id, None);
    assert_eq!(status.state, RealtimeStateDto::Idle);
}

#[tokio::test(flavor = "multi_thread")]
async fn switching_profiles_leaves_no_socket_of_the_old_one() {
    let mut reverb_a = FakeReverb::start().await;
    let mut reverb_b = FakeReverb::start().await;
    let server_a = realtime_server(&reverb_a).await;
    let server_b = realtime_server(&reverb_b).await;
    let fx = fx();
    let (a, mut conn_a) = fx.connected(&mut reverb_a, &server_a).await;

    let b = fx.add(&server_b).await;
    fx.desktop.select(&fx.state, &b.id).await.unwrap();
    conn_a.closed().await;
    fx.login().await.unwrap();
    let mut conn_b = reverb_b.subscribed("2.1").await;
    fx.wait_state(&b.id, RealtimeStateDto::Connected).await;
    assert!(reverb_a.quiet_for(Duration::from_millis(300)).await);

    conn_b
        .event(
            "notification.created",
            json!({"id": "n-b", "type": "x", "created_at": "2026-10-27T10:00:00Z"}),
        )
        .await;
    fx.realtime
        .wait_for(|e| {
            matches!(e, RealtimeEventDto::NotificationCreated { profile_id, .. }
                if *profile_id == b.id)
        })
        .await;

    fx.desktop.select(&fx.state, &a.id).await.unwrap();
    conn_b.closed().await;
    let _again = reverb_a.subscribed("1.2").await;
    assert!(reverb_b.quiet_for(Duration::from_millis(300)).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_notification_reaches_the_webview_and_starts_no_run() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, mut conn) = fx.connected(&mut reverb, &server).await;
    let before = manifests(&server).await;

    conn.event(
        "notification.created",
        json!({"id": "n1", "type": "approval", "data": {"x": 1},
               "read_at": null, "created_at": "2026-10-27T10:00:00Z"}),
    )
    .await;

    let event = fx
        .realtime
        .wait_for(|e| matches!(e, RealtimeEventDto::NotificationCreated { .. }))
        .await;
    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({
            "type": "notification_created", "profile_id": profile.id,
            "notification": {"id": "n1", "type": "approval", "data": {"x": 1},
                             "read_at": null, "created_at": "2026-10-27T10:00:00Z"}
        })
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(manifests(&server).await, before);
    assert!(fx.record().tokens.is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_revoked_membership_starts_a_run_and_tells_the_webview() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, mut conn) = fx.connected(&mut reverb, &server).await;
    eventually("the first run is over", async || {
        fx.state.engine().unwrap().status().state == SyncState::Idle
    })
    .await;
    let before = manifests(&server).await;

    conn.event("membership.revoked", json!({"company_id": COMPANY}))
        .await;

    eventually("a new run", async || manifests(&server).await > before).await;
    let event = fx
        .realtime
        .wait_for(|e| matches!(e, RealtimeEventDto::MembershipRevoked { .. }))
        .await;
    assert_eq!(
        event,
        RealtimeEventDto::MembershipRevoked {
            profile_id: profile.id.clone(),
            company_id: COMPANY.into(),
        }
    );
    // The session goes on, on the same socket.
    assert!(fx.record().tokens.is_some());
    assert!(reverb.quiet_for(Duration::from_millis(200)).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_revoked_session_drops_the_tokens_and_keeps_the_local_data() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, mut conn) = fx.connected(&mut reverb, &server).await;
    assert_eq!(rows(&fx), 1);
    let before = fx.record();

    conn.event("session.revoked", json!({"reason": "deactivated"}))
        .await;

    let event = fx
        .realtime
        .wait_for(|e| matches!(e, RealtimeEventDto::SessionRevoked { .. }))
        .await;
    assert_eq!(
        event,
        RealtimeEventDto::SessionRevoked {
            profile_id: profile.id.clone(),
            reason: "deactivated".into(),
        }
    );
    conn.closed().await;

    // Generation and marks stay; only the tokens are gone.
    let after = fx.record();
    assert!(after.tokens.is_none());
    assert_eq!(after.generation, before.generation);
    assert!(!after.deactivated);

    // The run it asked for turns the engine to sign-in required...
    fx.events
        .wait_for(
            |e| matches!(e, EngineEvent::Status { status, .. } if status.state == "auth_required"),
        )
        .await;
    fx.settles_on(&profile.id, RealtimeStateDto::Idle).await;
    assert!(reverb.quiet_for(Duration::from_millis(300)).await);

    // ...and nothing local was deleted: the row is there, unsealed by the
    // same user's next sign-in.
    assert_eq!(fx.state.store().unwrap().row_count(&parties()).unwrap(), 1);
    assert!(fx.desktop.profile_dir(&profile.id).join(DB_FILE).exists());
    fx.login().await.unwrap();
    eventually("the same user reads the data again", async || {
        rows(&fx) == 1
    })
    .await;
    let _again = reverb.subscribed("1.2").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_revocation_after_a_new_sign_in_reaches_the_new_tokens() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (_profile, mut first) = fx.connected(&mut reverb, &server).await;
    let generation = fx.record().generation;

    // Same company: the profile does not restart.
    fx.login().await.unwrap();
    assert_eq!(fx.record().generation, generation + 1);
    first.closed().await;
    let mut second = reverb.subscribed("1.2").await;

    second
        .event("session.revoked", json!({"reason": "password_reset"}))
        .await;
    eventually("the new tokens are gone", async || {
        fx.record().tokens.is_none()
    })
    .await;
    assert_eq!(fx.record().generation, generation + 1);
    assert_eq!(fx.revoked_events().await, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_without_reverb_is_disabled_and_nothing_is_called() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;

    fx.wait_state(&profile.id, RealtimeStateDto::Disabled).await;
    let status = fx.desktop.realtime_status().await;
    assert_eq!(status.state, RealtimeStateDto::Disabled);
    assert!(requests(&server, paths::BROADCASTING_AUTH).await.is_empty());
    // `/auth/me` of the sign-in only.
    assert_eq!(requests(&server, ME).await.len(), 1);

    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    assert_eq!(
        fx.desktop.realtime_status().await.state,
        RealtimeStateDto::Disabled
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn signing_out_closes_the_socket() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, mut conn) = fx.connected(&mut reverb, &server).await;

    fx.desktop.sign_out(&fx.state, true).await.unwrap();

    conn.closed().await;
    fx.settles_on(&profile.id, RealtimeStateDto::Idle).await;
    assert!(reverb.quiet_for(Duration::from_millis(300)).await);
}

#[tokio::test(flavor = "multi_thread")]
async fn tokens_lost_to_the_engine_close_the_socket() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (_profile, mut conn) = fx.connected(&mut reverb, &server).await;

    let client = fx.state.client().unwrap();
    let generation = fx.record().generation;
    assert!(client.session().forget_tokens(generation).await.unwrap());
    crate::bootstrap::trigger(&fx.state, Trigger::Manual).unwrap();

    conn.closed().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_that_does_not_answer_is_retried_until_the_user_is_known() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, mut conn) = fx.connected(&mut reverb, &server).await;

    let failures = Arc::new(AtomicUsize::new(2));
    let left = failures.clone();
    Mock::given(method("GET"))
        .and(path(ME))
        .and(move |_: &Request| {
            left.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                .is_ok()
        })
        .respond_with(ResponseTemplate::new(503))
        .with_priority(1)
        .mount(&server)
        .await;

    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    conn.closed().await;
    let _again = reverb.subscribed("1.2").await;
    assert_eq!(failures.load(Ordering::SeqCst), 0);
    fx.realtime
        .wait_for(|e| is_state(e, &profile.id, RealtimeStateDto::Unavailable))
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_fatal_close_is_not_retried_until_the_next_sign_in() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, mut conn) = fx.connected(&mut reverb, &server).await;

    let frame = CloseFrame {
        code: CloseCode::from(4001),
        reason: "app disabled".into(),
    };
    conn.0.close(Some(frame)).await.unwrap();

    fx.settles_on(&profile.id, RealtimeStateDto::Unavailable)
        .await;
    assert!(reverb.quiet_for(Duration::from_millis(300)).await);

    fx.login().await.unwrap();
    let _again = reverb.subscribed("1.2").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn sign_in_and_sign_out_without_a_sync_loop_still_move_the_socket() {
    // Several companies, none chosen: no run follows a sign-in, so no
    // engine status does either; the shell's word is all the bridge gets.
    let mut reverb = FakeReverb::start().await;
    let companies = [(COMPANY, "Acme"), (COMPANY_2, "Beta")];
    let server = realtime_server_of(&reverb, &companies).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();

    assert!(fx.login().await.unwrap().company_required);
    let mut first = reverb.subscribed("1.1").await;
    fx.desktop.sign_out(&fx.state, true).await.unwrap();
    first.closed().await;

    assert!(fx.login().await.unwrap().company_required);
    let mut second = reverb.subscribed("1.2").await;
    fx.desktop.sign_out(&fx.state, true).await.unwrap();
    second.closed().await;
    fx.settles_on(&profile.id, RealtimeStateDto::Idle).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refresh_in_flight_does_not_close_a_healthy_socket() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, mut conn) = fx.connected(&mut reverb, &server).await;

    // A call meets an expired token: the refresh holds the tokens out of
    // the store while its answer is on the way.
    let expired = fx.record().tokens.unwrap().access_token;
    Mock::given(method("GET"))
        .and(path("/api/v1/parties"))
        .and(wiremock::matchers::header(
            "authorization",
            format!("Bearer {}", expired.expose()).as_str(),
        ))
        .respond_with(
            ResponseTemplate::new(401).set_body_json(
                json!({"errors": {"message": "expired", "code": "UNAUTHENTICATED"}}),
            ),
        )
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path(paths::DEVICE_REFRESH))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_body(9))
                .set_delay(Duration::from_millis(600)),
        )
        .mount(&server)
        .await;
    let client = fx.state.client().unwrap();
    let call = tokio::spawn(async move {
        let request = ProxyRequest {
            method: ProxyMethod::Get,
            path: "/api/v1/parties".into(),
            query: Vec::new(),
            headers: Vec::new(),
            body: None,
        };
        client.proxy(&request).await
    });
    eventually("the refresh is on its way", async || {
        fx.record().tokens.is_none()
    })
    .await;

    // Engine news in that window makes the bridge read the session.
    crate::bootstrap::trigger(&fx.state, Trigger::Manual).unwrap();
    call.await.unwrap().unwrap();

    // Same socket, no second one.
    assert!(reverb.quiet_for(Duration::from_millis(300)).await);
    conn.event(
        "notification.created",
        json!({"id": "after", "type": "x", "created_at": "2026-10-27T10:00:00Z"}),
    )
    .await;
    fx.realtime
        .wait_for(|e| matches!(e, RealtimeEventDto::NotificationCreated { .. }))
        .await;
    fx.settles_on(&profile.id, RealtimeStateDto::Connected)
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_old_socket_closes_before_the_sign_in_is_settled() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (_profile, mut first) = fx.connected(&mut reverb, &server).await;
    let generation = fx.record().generation;

    // `/auth/me` does not answer in this test: the sign-in stays unsettled.
    Mock::given(method("GET"))
        .and(path(ME))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(me_body(&[(COMPANY, "Acme")]))
                .set_delay(Duration::from_secs(30)),
        )
        .with_priority(1)
        .mount(&server)
        .await;

    tokio::select! {
        _ = fx.login() => panic!("the sign-in settled first"),
        () = first.closed() => {}
    }
    assert_eq!(fx.record().generation, generation + 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn plain_ws_stays_refused_without_the_dev_flag() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let added = fx.add(&server).await;

    // The same meta in an app without the flag: its `ws://` socket only.
    let mut no_flag = options();
    no_flag.allow_http_localhost = false;
    let (desktop, _events, realtime) = desktop_over(fx.dir.path(), &fx.service, &fx.mock, no_flag);
    let stored = fx.desktop.registry().load().unwrap();
    let mut profile = stored.get(&added.id).unwrap().clone();
    profile.id = Uuid::now_v7().to_string();
    profile.base_url = "https://erp.example.com".into();
    let id = profile.id.clone();
    desktop.registry().add(profile).unwrap();
    let state = AppState::default();

    desktop.select(&state, &id).await.unwrap();

    assert_eq!(
        desktop.realtime_status().await.state,
        RealtimeStateDto::Unavailable
    );
    realtime
        .wait_for(|e| is_state(e, &id, RealtimeStateDto::Unavailable))
        .await;
    assert!(reverb.quiet_for(Duration::from_millis(200)).await);
    assert_eq!(realtime.events().len(), 1, "{:?}", realtime.events());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_switch_waits_for_the_old_bridge_before_it_returns() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let other = self::server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let (_profile, mut conn) = fx.connected(&mut reverb, &server).await;
    let b = fx.add(&other).await;

    // The old bridge is stuck on the session lock, in its revocation.
    let session = fx.state.client().unwrap().session().clone();
    let held = session.lock().await;
    conn.event("session.revoked", json!({"reason": "deactivated"}))
        .await;
    conn.closed().await;
    tokio::time::sleep(Duration::from_millis(200)).await;

    fx.desktop.select(&fx.state, &b.id).await.unwrap();

    // Gone when the switch returned: the lock opens on nobody.
    drop(held);
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(session.record().unwrap().tokens.is_some());
    assert_eq!(fx.revoked_events().await, 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_new_sign_in_closes_the_old_socket_before_the_next_opens() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (profile, mut first) = fx.connected(&mut reverb, &server).await;

    fx.login().await.unwrap();
    first.closed().await;
    let _second = reverb.subscribed("1.2").await;
    fx.settles_on(&profile.id, RealtimeStateDto::Connected)
        .await;

    let states = fx.states(&profile.id);
    assert_eq!(
        states[states.len() - 4..],
        [
            RealtimeStateDto::Connected,
            RealtimeStateDto::Idle,
            RealtimeStateDto::Connecting,
            RealtimeStateDto::Connected,
        ],
        "{states:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_revoked_session_keeps_the_unsent_work() {
    let mut reverb = FakeReverb::start().await;
    let server = realtime_server(&reverb).await;
    let fx = fx();
    let (_profile, mut conn) = fx.connected(&mut reverb, &server).await;
    let engine = fx.state.engine().unwrap();
    engine.enqueue(draft()).unwrap();
    assert_eq!(engine.refresh_status().unwrap().pending, 1);

    conn.event("session.revoked", json!({"reason": "deactivated"}))
        .await;
    fx.events
        .wait_for(
            |e| matches!(e, EngineEvent::Status { status, .. } if status.state == "auth_required"),
        )
        .await;

    assert_eq!(engine.refresh_status().unwrap().pending, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_revocation_of_an_earlier_sign_in_starts_no_run() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let earlier = fx.record().generation;
    fx.login().await.unwrap();
    let engine = fx.state.engine().unwrap();

    // A loop of this test, for its handle.
    let (handle, sync) = sync_loop(engine.clone());
    let sync = tokio::spawn(sync.run());
    let settled = async |server: &MockServer| {
        let mut seen = manifests(server).await;
        loop {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let now = manifests(server).await;
            if now == seen && engine.status().state == SyncState::Idle {
                return now;
            }
            seen = now;
        }
    };
    let before = settled(&server).await;

    let sink = Arc::new(crate::realtime::Recorder::default());
    let client = fx.state.client().unwrap();
    crate::realtime::deliver(
        &profile.id,
        client.clone(),
        Some(handle.clone()),
        sink.clone(),
        keystone_realtime::RealtimeEvent::SessionRevoked { reason: "x".into() },
        earlier,
    )
    .await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(manifests(&server).await, before);
    assert!(sink.events().is_empty());
    assert!(fx.record().tokens.is_some());

    // The same handle does start a run when one is due.
    let company_id = COMPANY.to_owned();
    crate::realtime::deliver(
        &profile.id,
        client,
        Some(handle),
        sink,
        keystone_realtime::RealtimeEvent::MembershipRevoked { company_id },
        earlier + 1,
    )
    .await;
    eventually("a run", async || manifests(&server).await > before).await;
    sync.abort();
}
