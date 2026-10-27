//! Pusher protocol 7 frames used by this client.
//!
//! Every frame is `{"event", "channel"?, "data"?}`; `data` is usually a JSON
//! encoded string, sometimes an object. Both are accepted.

use serde::Deserialize;
use serde_json::{Value, json};

use crate::auth::ChannelAuth;

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Incoming {
    Established {
        socket_id: String,
        activity_timeout: Option<u64>,
    },
    Ping,
    Pong,
    Error {
        code: Option<u16>,
    },
    SubscriptionSucceeded {
        channel: String,
    },
    SubscriptionError {
        channel: String,
        status: Option<u16>,
    },
    ChannelEvent {
        channel: String,
        event: String,
        data: Value,
    },
    /// Protocol event this client ignores (named for debug logs only).
    Other {
        event: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Malformed;

#[derive(Deserialize)]
struct Frame {
    event: String,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    data: Value,
}

pub(crate) fn parse(text: &str) -> Result<Incoming, Malformed> {
    let frame: Frame = serde_json::from_str(text).map_err(|_| Malformed)?;
    let data = match frame.data {
        Value::String(s) => serde_json::from_str(&s).unwrap_or(Value::String(s)),
        other => other,
    };
    let incoming = match frame.event.as_str() {
        "pusher:connection_established" => Incoming::Established {
            socket_id: data
                .get("socket_id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or(Malformed)?
                .to_owned(),
            activity_timeout: data.get("activity_timeout").and_then(Value::as_u64),
        },
        "pusher:ping" => Incoming::Ping,
        "pusher:pong" => Incoming::Pong,
        "pusher:error" => Incoming::Error {
            code: data
                .get("code")
                .and_then(Value::as_u64)
                .and_then(|c| u16::try_from(c).ok()),
        },
        "pusher_internal:subscription_succeeded" => Incoming::SubscriptionSucceeded {
            channel: frame.channel.ok_or(Malformed)?,
        },
        "pusher:subscription_error" => Incoming::SubscriptionError {
            channel: frame.channel.ok_or(Malformed)?,
            status: data
                .get("status")
                .and_then(Value::as_u64)
                .and_then(|c| u16::try_from(c).ok()),
        },
        name if name.starts_with("pusher:") || name.starts_with("pusher_internal:") => {
            Incoming::Other { event: frame.event }
        }
        _ => match frame.channel {
            Some(channel) => Incoming::ChannelEvent {
                channel,
                event: frame.event,
                data,
            },
            None => Incoming::Other { event: frame.event },
        },
    };
    Ok(incoming)
}

pub(crate) fn subscribe(channel: &str, auth: &ChannelAuth) -> String {
    let mut data = json!({ "channel": channel, "auth": auth.auth() });
    if let Some(channel_data) = auth.channel_data() {
        data["channel_data"] = Value::String(channel_data.to_owned());
    }
    json!({ "event": "pusher:subscribe", "data": data }).to_string()
}

pub(crate) fn ping() -> String {
    json!({ "event": "pusher:ping", "data": {} }).to_string()
}

pub(crate) fn pong() -> String {
    json!({ "event": "pusher:pong", "data": {} }).to_string()
}

/// What a Pusher error / close code asks the client to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CodeAction {
    /// 4000-4099: do not reconnect.
    Stop,
    /// 4200-4299: reconnect at once.
    ReconnectNow,
    /// 4100-4199 and anything else: reconnect with backoff.
    Backoff,
}

pub(crate) fn code_action(code: u16) -> CodeAction {
    match code {
        4000..=4099 => CodeAction::Stop,
        4200..=4299 => CodeAction::ReconnectNow,
        _ => CodeAction::Backoff,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_established_with_string_data() {
        let text = r#"{"event":"pusher:connection_established","data":"{\"socket_id\":\"123.456\",\"activity_timeout\":30}"}"#;
        assert_eq!(
            parse(text),
            Ok(Incoming::Established {
                socket_id: "123.456".into(),
                activity_timeout: Some(30)
            })
        );
    }

    #[test]
    fn connection_established_needs_a_socket_id() {
        assert_eq!(
            parse(r#"{"event":"pusher:connection_established","data":"{}"}"#),
            Err(Malformed)
        );
        assert_eq!(parse("not json"), Err(Malformed));
    }

    #[test]
    fn control_frames() {
        assert_eq!(
            parse(r#"{"event":"pusher:ping","data":{}}"#),
            Ok(Incoming::Ping)
        );
        assert_eq!(parse(r#"{"event":"pusher:pong"}"#), Ok(Incoming::Pong));
        assert_eq!(
            parse(r#"{"event":"pusher:error","data":{"code":4009,"message":"x"}}"#),
            Ok(Incoming::Error { code: Some(4009) })
        );
        assert_eq!(
            parse(
                r#"{"event":"pusher_internal:subscription_succeeded","channel":"private-user.1","data":"{}"}"#
            ),
            Ok(Incoming::SubscriptionSucceeded {
                channel: "private-user.1".into()
            })
        );
        assert_eq!(
            parse(
                r#"{"event":"pusher:subscription_error","channel":"private-user.1","data":{"status":403}}"#
            ),
            Ok(Incoming::SubscriptionError {
                channel: "private-user.1".into(),
                status: Some(403)
            })
        );
        assert_eq!(
            parse(r#"{"event":"pusher:cache_miss","channel":"c"}"#),
            Ok(Incoming::Other {
                event: "pusher:cache_miss".into()
            })
        );
    }

    #[test]
    fn channel_event_data_string_or_object() {
        for text in [
            r#"{"event":"membership.revoked","channel":"private-user.1","data":"{\"company_id\":\"c\"}"}"#,
            r#"{"event":"membership.revoked","channel":"private-user.1","data":{"company_id":"c"}}"#,
        ] {
            assert_eq!(
                parse(text),
                Ok(Incoming::ChannelEvent {
                    channel: "private-user.1".into(),
                    event: "membership.revoked".into(),
                    data: json!({"company_id": "c"})
                })
            );
        }
    }

    #[test]
    fn outgoing_frames() {
        let sub: Value =
            serde_json::from_str(&subscribe("private-user.1", &ChannelAuth::new("k:sig"))).unwrap();
        assert_eq!(
            sub,
            json!({"event": "pusher:subscribe", "data": {"channel": "private-user.1", "auth": "k:sig"}})
        );
        let ping: Value = serde_json::from_str(&ping()).unwrap();
        assert_eq!(ping["event"], "pusher:ping");
        let pong: Value = serde_json::from_str(&pong()).unwrap();
        assert_eq!(pong["event"], "pusher:pong");
    }

    #[test]
    fn code_ranges() {
        assert_eq!(code_action(4001), CodeAction::Stop);
        assert_eq!(code_action(4099), CodeAction::Stop);
        assert_eq!(code_action(4100), CodeAction::Backoff);
        assert_eq!(code_action(4201), CodeAction::ReconnectNow);
        assert_eq!(code_action(1006), CodeAction::Backoff);
    }
}
