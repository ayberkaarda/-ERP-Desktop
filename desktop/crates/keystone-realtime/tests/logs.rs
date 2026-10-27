//! Logs never carry channel signatures or event payloads. Own test binary:
//! the capturing logger is process global.
//!
//! This crate is captured at every level. Dependencies are captured up to
//! `Debug`, the most the shell ever enables (`logging::level_for_build`):
//! tungstenite dumps whole frames, signatures included, at `Trace`.

mod common;

use std::sync::Mutex;
use std::time::Duration;

use common::*;
use keystone_realtime::RealtimeEvent;
use log::{Level, LevelFilter, Log, Metadata, Record};
use serde_json::json;

static LINES: Mutex<Vec<String>> = Mutex::new(Vec::new());

struct Capture;

impl Log for Capture {
    fn enabled(&self, _: &Metadata<'_>) -> bool {
        true
    }

    fn log(&self, record: &Record<'_>) {
        if !record.target().starts_with("keystone_realtime") && record.level() > Level::Debug {
            return;
        }
        LINES
            .lock()
            .unwrap()
            .push(format!("{} {}", record.target(), record.args()));
    }

    fn flush(&self) {}
}

#[tokio::test]
async fn no_signature_or_payload_in_logs() {
    log::set_logger(&Capture).unwrap();
    log::set_max_level(LevelFilter::Trace);

    let mut server = FakeServer::start().await;
    let authorizer = FakeAuthorizer::new(&[Mode::Sign, Mode::Unavailable, Mode::Sign]);
    let (handle, mut events) = start(&server, authorizer, fast_options());

    let mut first = server.next_conn().await;
    first.accept_client("1.1").await;
    next_event(&mut events).await;
    first
        .event(
            CHANNEL,
            "notification.created",
            json!({"id": "n1", "type": "t", "data": {"secret": "PAYLOAD-MARK"},
                   "read_at": null, "created_at": "2026-10-27T10:00:00Z"}),
        )
        .await;
    first
        .event(
            CHANNEL,
            "membership.revoked",
            json!({"bad": "PAYLOAD-MARK"}),
        )
        .await;
    first
        .event(CHANNEL, "unknown.event", json!({"x": "PAYLOAD-MARK"}))
        .await;
    first
        .send(json!({"event": "pusher:error", "data": {"code": 4100, "message": "PAYLOAD-MARK"}}))
        .await;
    // Server-chosen event names cannot forge log lines.
    first
        .send(json!({"event": "odd\nFORGED-LINE", "data": "{}"}))
        .await;
    first.event(CHANNEL, "odd\nFORGED-LINE", json!({})).await;
    assert!(matches!(
        next_event(&mut events).await,
        RealtimeEvent::NotificationCreated(_)
    ));
    // Drop: reconnect, authorization unavailable once, reconnect again.
    drop(first);
    let mut second = server.next_conn().await;
    second.established("2.2", 30).await;
    let mut third = server.next_conn().await;
    third.accept_client("3.3").await;
    next_event(&mut events).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    handle.close().await;

    let lines = LINES.lock().unwrap().clone();
    let ours: Vec<_> = lines
        .iter()
        .filter(|l| l.starts_with("keystone_realtime"))
        .collect();
    assert!(
        ours.iter()
            .any(|l| l.contains("subscribed to private-user.u1")),
        "{ours:#?}"
    );
    assert!(ours.iter().any(|l| l.contains("reconnecting")), "{ours:#?}");
    // Logged, but escaped.
    assert!(
        ours.iter().any(|l| l.contains(r"odd\nFORGED-LINE")),
        "{ours:#?}"
    );
    for line in &lines {
        assert!(!line.contains("SECRETSIG"), "signature in log: {line}");
        assert!(!line.contains("PAYLOAD-MARK"), "payload in log: {line}");
        assert!(!line.contains("pusher:subscribe"), "frame in log: {line}");
        assert!(
            !line.contains("\nFORGED-LINE"),
            "raw event name in log: {line}"
        );
    }
}
