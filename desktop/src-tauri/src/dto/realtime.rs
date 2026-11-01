//! Payload of the `realtime-event` Tauri event and of `realtime_status`.

use keystone_realtime::{Notification, RealtimeState};
use serde::Serialize;
use serde_json::Value;
use ts_rs::TS;

/// Same names as the web `RealtimeState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(rename_all = "snake_case")]
pub enum RealtimeStateDto {
    /// The server has no Reverb (no key or host in its meta).
    Disabled,
    /// Configured but not connected (signed out, session ended, closed).
    Idle,
    Connecting,
    Connected,
    /// Connection lost (a retry follows) or refused for good.
    Unavailable,
}

impl From<RealtimeState> for RealtimeStateDto {
    fn from(state: RealtimeState) -> Self {
        match state {
            RealtimeState::Disabled => Self::Disabled,
            RealtimeState::Idle => Self::Idle,
            RealtimeState::Connecting => Self::Connecting,
            RealtimeState::Connected => Self::Connected,
            RealtimeState::Unavailable => Self::Unavailable,
        }
    }
}

/// Item of `GET /notifications`, as the server broadcast it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct NotificationDto {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[ts(type = "unknown")]
    pub data: Value,
    pub read_at: Option<String>,
    pub created_at: String,
}

impl From<Notification> for NotificationDto {
    fn from(notification: Notification) -> Self {
        Self {
            id: notification.id,
            kind: notification.kind,
            data: notification.data,
            read_at: notification.read_at,
            created_at: notification.created_at,
        }
    }
}

/// Payload of `realtime-event`. Every event names its profile, so the UI can
/// drop news of a profile it has already left.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RealtimeEventDto {
    /// The connection state changed (also sent when the bridge starts).
    State {
        profile_id: String,
        state: RealtimeStateDto,
    },
    /// The server ended the session: the tokens of this sign-in are gone,
    /// local data stays. UI: ask for a sign-in.
    SessionRevoked { profile_id: String, reason: String },
    /// The user lost a company. UI: read `/auth/me` again; a run of the
    /// sync loop has already been asked for.
    MembershipRevoked {
        profile_id: String,
        company_id: String,
    },
    NotificationCreated {
        profile_id: String,
        notification: NotificationDto,
    },
}

/// Answer of `realtime_status`: for a webview that starts listening after
/// the state events of the profile went out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
pub struct RealtimeStatusDto {
    /// The active profile; `None` when none is open.
    pub profile_id: Option<String>,
    pub state: RealtimeStateDto,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn events_have_the_documented_wire_shape() {
        let event = RealtimeEventDto::NotificationCreated {
            profile_id: "p1".into(),
            notification: NotificationDto::from(Notification {
                id: "n1".into(),
                kind: "approval".into(),
                data: json!({"x": 1}),
                read_at: None,
                created_at: "2026-10-27T10:00:00Z".into(),
            }),
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            json!({
                "type": "notification_created",
                "profile_id": "p1",
                "notification": {
                    "id": "n1", "type": "approval", "data": {"x": 1},
                    "read_at": null, "created_at": "2026-10-27T10:00:00Z"
                }
            })
        );
        let state = RealtimeEventDto::State {
            profile_id: "p1".into(),
            state: RealtimeState::Unavailable.into(),
        };
        assert_eq!(
            serde_json::to_value(&state).unwrap(),
            json!({"type": "state", "profile_id": "p1", "state": "unavailable"})
        );
    }

    #[test]
    fn state_names_are_the_crate_names() {
        for state in [
            RealtimeState::Disabled,
            RealtimeState::Idle,
            RealtimeState::Connecting,
            RealtimeState::Connected,
            RealtimeState::Unavailable,
        ] {
            assert_eq!(
                serde_json::to_value(RealtimeStateDto::from(state)).unwrap(),
                state.as_str()
            );
        }
    }
}
