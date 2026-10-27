//! Pusher protocol behaviour against a local fake Reverb server.

mod common;

use std::time::{Duration, Instant};

use common::*;
use keystone_realtime::{
    ConfigError, RealtimeConfig, RealtimeEvent, RealtimeHandle, RealtimeState, ReverbParams,
    StopReason, SubscriptionFailure,
};
use serde_json::json;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;

#[tokio::test]
async fn handshake_uses_the_pusher_url_and_reaches_connected() {
    let mut server = FakeServer::start().await;
    let (handle, _events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    assert_eq!(
        conn.uri,
        "/app/test-key?protocol=7&client=keystone-desktop&version=9.9.9"
    );
    assert_eq!(handle.state(), RealtimeState::Connecting);
    conn.established("1.1", 30).await;
    wait_state(&handle, RealtimeState::Connected).await;
}

#[tokio::test]
async fn subscribes_with_the_signature_for_the_issued_socket_id() {
    let mut server = FakeServer::start().await;
    let authorizer = FakeAuthorizer::new(&[Mode::Sign]);
    let (_handle, mut events) = start(&server, authorizer.clone(), fast_options());
    let mut conn = server.next_conn().await;
    conn.accept_client("111.222").await;
    assert_eq!(
        authorizer.calls(),
        [("111.222".to_owned(), CHANNEL.to_owned())]
    );
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::Subscribed {
            channel: CHANNEL.into()
        }
    );
}

#[tokio::test]
async fn delivers_typed_user_events_and_skips_the_rest() {
    let mut server = FakeServer::start().await;
    let (_handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    conn.accept_client("1.1").await;
    assert!(matches!(
        next_event(&mut events).await,
        RealtimeEvent::Subscribed { .. }
    ));

    conn.event(
        "private-user.other",
        "membership.revoked",
        json!({"company_id": "x"}),
    )
    .await;
    conn.event(CHANNEL, "something.else", json!({})).await;
    conn.event(CHANNEL, "membership.revoked", json!({"wrong": 1}))
        .await;
    conn.event(CHANNEL, "membership.revoked", json!({"company_id": "c1"}))
        .await;
    conn.event(
        CHANNEL,
        "notification.created",
        json!({"id": "n1", "type": "approval.requested", "data": {"doc": "PR-1"},
               "read_at": null, "created_at": "2026-10-27T10:00:00Z"}),
    )
    .await;

    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::MembershipRevoked {
            company_id: "c1".into()
        }
    );
    let RealtimeEvent::NotificationCreated(n) = next_event(&mut events).await else {
        panic!("expected a notification");
    };
    assert_eq!(n.id, "n1");
    assert_eq!(n.kind, "approval.requested");
    assert_eq!(n.data, json!({"doc": "PR-1"}));
    assert_eq!(n.created_at, "2026-10-27T10:00:00Z");
}

#[tokio::test]
async fn session_revoked_is_delivered_then_the_socket_is_closed_for_good() {
    let mut server = FakeServer::start().await;
    let (handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    conn.accept_client("1.1").await;
    next_event(&mut events).await;

    conn.event(CHANNEL, "session.revoked", json!({"reason": "deactivated"}))
        .await;
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::SessionRevoked {
            reason: "deactivated".into()
        }
    );
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::Stopped(StopReason::SessionRevoked)
    );
    assert!(matches!(conn.read().await, Read::Close(_)));
    wait_state(&handle, RealtimeState::Idle).await;
    assert!(server.quiet_for(Duration::from_millis(400)).await);
}

#[tokio::test]
async fn answers_server_ping_with_pong() {
    let mut server = FakeServer::start().await;
    let (_handle, _events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    conn.accept_client("1.1").await;
    conn.send(json!({"event": "pusher:ping", "data": {}})).await;
    assert_eq!(conn.recv().await["event"], "pusher:pong");
}

#[tokio::test]
async fn pings_after_silence_and_keeps_the_connection_when_answered() {
    let mut server = FakeServer::start().await;
    let mut options = fast_options();
    options.max_activity_timeout = Duration::from_millis(200);
    options.pong_timeout = Duration::from_millis(300);
    let (handle, _events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), options);
    let mut conn = server.next_conn().await;
    // The server asks for 30 s; the client's cap (200 ms) wins.
    conn.accept_client("1.1").await;
    for _ in 0..3 {
        let started = Instant::now();
        assert_eq!(conn.recv().await["event"], "pusher:ping");
        assert!(started.elapsed() >= Duration::from_millis(150));
        conn.send(json!({"event": "pusher:pong", "data": {}})).await;
    }
    assert_eq!(handle.state(), RealtimeState::Connected);
    assert!(server.quiet_for(Duration::from_millis(100)).await);
}

#[tokio::test]
async fn missing_pong_drops_the_socket_and_reconnects_with_a_new_subscription() {
    let mut server = FakeServer::start().await;
    let authorizer = FakeAuthorizer::new(&[Mode::Sign]);
    let mut options = fast_options();
    options.max_activity_timeout = Duration::from_millis(150);
    options.pong_timeout = Duration::from_millis(200);
    let (_handle, mut events) = start(&server, authorizer.clone(), options);
    let mut first = server.next_conn().await;
    first.accept_client("1.1").await;
    next_event(&mut events).await;
    assert_eq!(first.recv().await["event"], "pusher:ping");
    // No pong: the client gives up on this socket.
    assert!(matches!(first.read().await, Read::Ended | Read::Close(_)));

    let mut second = server.next_conn().await;
    second.accept_client("2.2").await;
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::Subscribed {
            channel: CHANNEL.into()
        }
    );
    assert_eq!(
        authorizer.calls(),
        [
            ("1.1".to_owned(), CHANNEL.to_owned()),
            ("2.2".to_owned(), CHANNEL.to_owned())
        ]
    );
}

#[tokio::test]
async fn reconnects_after_a_drop_with_backoff_and_resubscribes() {
    let mut server = FakeServer::start().await;
    let authorizer = FakeAuthorizer::new(&[Mode::Sign]);
    let mut options = fast_options();
    options.backoff.initial = Duration::from_millis(300);
    options.backoff.max = Duration::from_millis(300);
    let (handle, mut events) = start(&server, authorizer.clone(), options);
    let mut first = server.next_conn().await;
    first.accept_client("1.1").await;
    next_event(&mut events).await;

    let mut states = handle.watch_state();
    states.mark_unchanged();
    let dropped = Instant::now();
    drop(first);
    let mut second = server.next_conn().await;
    assert!(
        dropped.elapsed() >= Duration::from_millis(280),
        "reconnected after {:?}",
        dropped.elapsed()
    );
    assert!(states.has_changed().unwrap());
    second.accept_client("2.2").await;
    wait_state(&handle, RealtimeState::Connected).await;
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::Subscribed {
            channel: CHANNEL.into()
        }
    );
    assert_eq!(authorizer.calls().last().unwrap().0, "2.2");

    // Events flow on the new socket.
    second
        .event(CHANNEL, "membership.revoked", json!({"company_id": "c2"}))
        .await;
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::MembershipRevoked {
            company_id: "c2".into()
        }
    );
}

#[tokio::test]
async fn backoff_grows_while_the_server_keeps_refusing() {
    let mut server = FakeServer::start().await;
    let mut options = fast_options();
    options.backoff.initial = Duration::from_millis(100);
    options.backoff.max = Duration::from_secs(10);
    let (handle, _events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), options);
    let mut gaps = Vec::new();
    let mut last = Instant::now();
    for _ in 0..4 {
        // Dropped before the handshake: never established, failures add up.
        drop(server.next_conn().await);
        let now = Instant::now();
        gaps.push(now - last);
        last = now;
    }
    // 100, 200, 400 ms between attempts 1-2, 2-3, 3-4.
    assert!(gaps[1] >= Duration::from_millis(90), "{gaps:?}");
    assert!(gaps[2] >= Duration::from_millis(190), "{gaps:?}");
    assert!(gaps[3] >= Duration::from_millis(390), "{gaps:?}");
    assert_ne!(handle.state(), RealtimeState::Connected);
}

#[tokio::test]
async fn close_sends_a_close_frame_and_ends_the_event_channel() {
    let mut server = FakeServer::start().await;
    let (handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    conn.accept_client("1.1").await;
    next_event(&mut events).await;
    let states = handle.watch_state();

    handle.close().await;
    assert!(matches!(conn.read().await, Read::Close(_)));
    assert_eq!(*states.borrow(), RealtimeState::Idle);
    assert!(events.recv().await.is_none());
    assert!(server.quiet_for(Duration::from_millis(300)).await);
}

#[tokio::test]
async fn dropping_the_handle_closes_the_socket() {
    let mut server = FakeServer::start().await;
    let (handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    conn.accept_client("1.1").await;
    next_event(&mut events).await;

    drop(handle);
    assert!(matches!(conn.read().await, Read::Close(_)));
    assert!(
        tokio::time::timeout(WAIT, events.recv())
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn shutdown_during_backoff_stops_reconnecting() {
    let mut server = FakeServer::start().await;
    let mut options = fast_options();
    options.backoff.initial = Duration::from_millis(500);
    let (handle, _events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), options);
    drop(server.next_conn().await);
    wait_state(&handle, RealtimeState::Unavailable).await;
    handle.close().await;
    assert!(server.quiet_for(Duration::from_millis(800)).await);
}

#[tokio::test]
async fn a_new_session_generation_closes_the_connection() {
    let mut server = FakeServer::start().await;
    let (handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    conn.accept_client("1.1").await;
    next_event(&mut events).await;
    assert_eq!(handle.generation(), 7);

    assert!(!handle.close_if_stale(7));
    assert!(conn.read_within(Duration::from_millis(300)).await.is_none());
    assert_eq!(handle.state(), RealtimeState::Connected);

    assert!(handle.close_if_stale(8));
    assert!(matches!(conn.read().await, Read::Close(_)));
    wait_state(&handle, RealtimeState::Idle).await;
    assert!(server.quiet_for(Duration::from_millis(300)).await);
}

#[tokio::test]
async fn fatal_close_code_stops_without_reconnecting() {
    let mut server = FakeServer::start().await;
    let (handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    conn.accept_client("1.1").await;
    next_event(&mut events).await;
    conn.ws
        .close(Some(CloseFrame {
            code: CloseCode::from(4001),
            reason: "Application does not exist".into(),
        }))
        .await
        .unwrap();
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::Stopped(StopReason::Fatal { code: 4001 })
    );
    wait_state(&handle, RealtimeState::Unavailable).await;
    assert!(server.quiet_for(Duration::from_millis(400)).await);
}

#[tokio::test]
async fn fatal_error_during_handshake_stops() {
    let mut server = FakeServer::start().await;
    let (handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    conn.send(json!({"event": "pusher:error", "data": {"code": 4003, "message": "disabled"}}))
        .await;
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::Stopped(StopReason::Fatal { code: 4003 })
    );
    wait_state(&handle, RealtimeState::Unavailable).await;
    assert!(server.quiet_for(Duration::from_millis(400)).await);
}

#[tokio::test]
async fn reconnect_now_code_skips_the_backoff() {
    let mut server = FakeServer::start().await;
    let mut options = fast_options();
    options.backoff.initial = Duration::from_secs(3);
    options.backoff.max = Duration::from_secs(3);
    let (_handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), options);
    let mut conn = server.next_conn().await;
    conn.accept_client("1.1").await;
    next_event(&mut events).await;
    let closed = Instant::now();
    conn.ws
        .close(Some(CloseFrame {
            code: CloseCode::from(4200),
            reason: "reconnect".into(),
        }))
        .await
        .unwrap();
    let mut again = server.next_conn().await;
    assert!(closed.elapsed() < Duration::from_secs(1));
    again.accept_client("2.2").await;
}

#[tokio::test]
async fn unauthenticated_authorizer_ends_the_session_without_reconnecting() {
    let mut server = FakeServer::start().await;
    let (handle, mut events) = start(
        &server,
        FakeAuthorizer::new(&[Mode::Unauthenticated]),
        fast_options(),
    );
    let mut conn = server.next_conn().await;
    conn.established("1.1", 30).await;
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::Stopped(StopReason::SessionEnded)
    );
    assert!(matches!(conn.read().await, Read::Close(_)));
    wait_state(&handle, RealtimeState::Idle).await;
    assert!(server.quiet_for(Duration::from_millis(400)).await);
}

#[tokio::test]
async fn denied_channel_is_reported_and_the_socket_stays_open() {
    let mut server = FakeServer::start().await;
    let (handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Deny]), fast_options());
    let mut conn = server.next_conn().await;
    conn.established("1.1", 30).await;
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::SubscriptionFailed {
            channel: CHANNEL.into(),
            reason: SubscriptionFailure::Denied
        }
    );
    // No subscribe frame was sent; the connection still answers pings.
    conn.send(json!({"event": "pusher:ping", "data": {}})).await;
    assert_eq!(conn.recv().await["event"], "pusher:pong");
    assert_eq!(handle.state(), RealtimeState::Connected);
}

#[tokio::test]
async fn unavailable_authorizer_retries_on_a_new_socket() {
    let mut server = FakeServer::start().await;
    let authorizer = FakeAuthorizer::new(&[Mode::Unavailable, Mode::Sign]);
    let (_handle, mut events) = start(&server, authorizer.clone(), fast_options());
    let mut first = server.next_conn().await;
    first.established("1.1", 30).await;
    assert!(matches!(first.read().await, Read::Close(_) | Read::Ended));
    let mut second = server.next_conn().await;
    second.accept_client("2.2").await;
    assert!(matches!(
        next_event(&mut events).await,
        RealtimeEvent::Subscribed { .. }
    ));
    assert_eq!(authorizer.calls().len(), 2);
}

#[tokio::test]
async fn server_side_subscription_refusals_are_reported() {
    let mut server = FakeServer::start().await;
    let (_handle, mut events) = start(&server, FakeAuthorizer::new(&[Mode::Sign]), fast_options());
    let mut conn = server.next_conn().await;
    conn.established("1.1", 30).await;
    conn.recv().await;
    conn.send(json!({
        "event": "pusher:subscription_error",
        "channel": CHANNEL,
        "data": {"type": "AuthError", "status": 403}
    }))
    .await;
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::SubscriptionFailed {
            channel: CHANNEL.into(),
            reason: SubscriptionFailure::Rejected { status: Some(403) }
        }
    );

    // Reverb's own refusal of a bad signature: pusher:error 4009.
    drop(conn);
    let mut conn = server.next_conn().await;
    conn.established("2.2", 30).await;
    conn.recv().await;
    conn.send(json!({"event": "pusher:error", "data": {"code": 4009, "message": "Connection is unauthorized"}}))
        .await;
    assert_eq!(
        next_event(&mut events).await,
        RealtimeEvent::SubscriptionFailed {
            channel: CHANNEL.into(),
            reason: SubscriptionFailure::Rejected { status: Some(4009) }
        }
    );
}

#[tokio::test]
async fn tls_transport_never_falls_back_to_plain() {
    let mut server = FakeServer::start().await;
    let mut params = server.params();
    params.scheme = Some("https".into());
    let config = RealtimeConfig::from_params(&params, "9.9.9", false)
        .unwrap()
        .unwrap();
    assert!(config.url().as_str().starts_with("wss://127.0.0.1:"));
    let (handle, _events) = keystone_realtime::start(
        config,
        vec![CHANNEL.into()],
        FakeAuthorizer::new(&[Mode::Sign]),
        1,
        fast_options(),
    )
    .unwrap();
    // The client opens with a TLS ClientHello, which the plain server
    // cannot upgrade; it keeps retrying over TLS.
    for _ in 0..2 {
        let refused = server
            .next_attempt()
            .await
            .err()
            .expect("upgraded without TLS");
        assert_eq!(
            refused.first_bytes[..2],
            [0x16, 0x03],
            "not a TLS handshake"
        );
    }
    assert_ne!(handle.state(), RealtimeState::Connected);
}

#[tokio::test]
async fn plain_transport_needs_the_dev_flag() {
    let server = FakeServer::start().await;
    assert_eq!(
        RealtimeConfig::from_params(&server.params(), "9.9.9", false),
        Err(ConfigError::PlainTransportRefused)
    );
    let mut remote = server.params();
    remote.host = Some("realtime.example.com".into());
    assert_eq!(
        RealtimeConfig::from_params(&remote, "9.9.9", true),
        Err(ConfigError::PlainTransportRefused)
    );
}

#[tokio::test]
async fn disabled_without_reverb_and_private_channels_only() {
    assert_eq!(
        RealtimeConfig::from_params(&ReverbParams::default(), "1", false),
        Ok(None)
    );
    assert_eq!(RealtimeHandle::disabled().state(), RealtimeState::Disabled);
    assert!(RealtimeHandle::disabled().is_finished());

    let server = FakeServer::start().await;
    let err = keystone_realtime::start(
        server.config(),
        vec!["presence-company.c1.online".into()],
        FakeAuthorizer::new(&[Mode::Sign]),
        1,
        fast_options(),
    )
    .unwrap_err();
    assert_eq!(err, ConfigError::InvalidChannel);
}
