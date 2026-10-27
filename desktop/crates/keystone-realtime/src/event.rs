//! Connection state and the typed events handed to the shell.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Same names as the web `RealtimeState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeState {
    /// No Reverb key/host in the server meta.
    Disabled,
    /// Configured but not connected (not started, closed, session ended).
    Idle,
    Connecting,
    Connected,
    /// Connection lost (waiting to reconnect) or refused for good.
    Unavailable,
}

impl RealtimeState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Idle => "idle",
            Self::Connecting => "connecting",
            Self::Connected => "connected",
            Self::Unavailable => "unavailable",
        }
    }
}

/// Item of `GET /notifications`, as broadcast by `notification.created`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub data: Value,
    #[serde(default)]
    pub read_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubscriptionFailure {
    /// The authorizer refused to sign (HTTP 403); not retried on this socket.
    Denied,
    /// The server refused the subscription (`pusher:subscription_error`, or
    /// `pusher:error` 4009 while the subscription was pending).
    Rejected { status: Option<u16> },
}

/// Why the connection task stopped on its own (no reconnect follows).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    /// `session.revoked` was received.
    SessionRevoked,
    /// The authorizer reported that the session has no valid token.
    SessionEnded,
    /// Pusher error 4000-4099 (app unknown, disabled, over quota, ...).
    Fatal { code: u16 },
}

#[derive(Debug, Clone, PartialEq)]
pub enum RealtimeEvent {
    /// `session.revoked` on the user channel: the shell treats the session
    /// as ended (engine `AuthRequired`, local sign-out). The connection is
    /// closed by the crate right after this event.
    SessionRevoked { reason: String },
    /// `membership.revoked`: the shell re-reads the manifest
    /// (`Trigger::Manual`).
    MembershipRevoked { company_id: String },
    /// `notification.created`: forwarded to the webview.
    NotificationCreated(Notification),
    /// `pusher_internal:subscription_succeeded` (again after each reconnect).
    Subscribed { channel: String },
    SubscriptionFailed {
        channel: String,
        reason: SubscriptionFailure,
    },
    /// The task ended without being asked to; it does not reconnect.
    Stopped(StopReason),
}

pub(crate) const SESSION_REVOKED: &str = "session.revoked";
pub(crate) const MEMBERSHIP_REVOKED: &str = "membership.revoked";
pub(crate) const NOTIFICATION_CREATED: &str = "notification.created";

#[derive(Deserialize)]
struct SessionRevokedData {
    #[serde(default)]
    reason: String,
}

#[derive(Deserialize)]
struct MembershipRevokedData {
    company_id: String,
}

/// Typed user event, `None` for events this client does not handle and for
/// payloads that do not match (dropped, logged by name only).
pub(crate) fn user_event(event: &str, data: Value) -> Option<Result<RealtimeEvent, ()>> {
    let parsed = match event {
        SESSION_REVOKED => serde_json::from_value::<SessionRevokedData>(data)
            .map(|d| RealtimeEvent::SessionRevoked { reason: d.reason }),
        MEMBERSHIP_REVOKED => serde_json::from_value::<MembershipRevokedData>(data).map(|d| {
            RealtimeEvent::MembershipRevoked {
                company_id: d.company_id,
            }
        }),
        NOTIFICATION_CREATED => {
            serde_json::from_value::<Notification>(data).map(RealtimeEvent::NotificationCreated)
        }
        _ => return None,
    };
    Some(parsed.map_err(|_| ()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn state_names_match_the_web() {
        let names: Vec<_> = [
            RealtimeState::Disabled,
            RealtimeState::Idle,
            RealtimeState::Connecting,
            RealtimeState::Connected,
            RealtimeState::Unavailable,
        ]
        .iter()
        .map(|s| (s.as_str(), serde_json::to_value(s).unwrap()))
        .collect();
        for (name, json) in names {
            assert_eq!(json, Value::String(name.into()));
        }
    }

    #[test]
    fn parses_the_three_user_events() {
        assert_eq!(
            user_event("session.revoked", json!({"reason": "deactivated"})),
            Some(Ok(RealtimeEvent::SessionRevoked {
                reason: "deactivated".into()
            }))
        );
        assert_eq!(
            user_event("membership.revoked", json!({"company_id": "c1"})),
            Some(Ok(RealtimeEvent::MembershipRevoked {
                company_id: "c1".into()
            }))
        );
        let n = json!({"id": "n1", "type": "approval", "data": {"x": 1},
                       "read_at": null, "created_at": "2026-10-27T10:00:00Z"});
        let Some(Ok(RealtimeEvent::NotificationCreated(n))) = user_event("notification.created", n)
        else {
            panic!("notification not parsed");
        };
        assert_eq!(n.id, "n1");
        assert_eq!(n.kind, "approval");
        assert_eq!(n.data, json!({"x": 1}));
        assert_eq!(n.read_at, None);
    }

    #[test]
    fn unknown_and_malformed_events() {
        assert_eq!(user_event("something.else", json!({})), None);
        assert_eq!(
            user_event("membership.revoked", json!({"company": 1})),
            Some(Err(()))
        );
        assert_eq!(
            user_event("notification.created", json!("text")),
            Some(Err(()))
        );
    }
}
