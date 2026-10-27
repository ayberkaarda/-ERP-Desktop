//! Engine news for the webview: one ordered stream of [`EngineEvent`]s per
//! active profile, emitted as the Tauri event [`crate::ENGINE_EVENT`].
//!
//! [`bridge`] watches the engine's status (`subscribe`) and its changed
//! resources (`subscribe_changes`) and hands both, in the order they are
//! seen, to an [`EventSink`]. It runs on the engine runtime and ends when
//! the engine is gone or the task is aborted on a profile switch. Every
//! event names its profile, so the UI can drop news of a profile it has
//! already left.

use std::sync::Arc;

use keystone_sync::engine::{ResourcesChanged, SyncStatus};
use serde::Serialize;
use tokio::sync::{broadcast, watch};
use ts_rs::TS;

use crate::dto::status::StatusDto;

/// Payload of `engine-event`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/bridge/generated/")]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    /// The engine status changed (also sent once when the bridge starts).
    Status {
        profile_id: String,
        status: StatusDto,
    },
    /// Local data of these resources changed: refetch their queries.
    /// `all`: some notices were lost, refetch every query.
    ResourcesChanged {
        profile_id: String,
        resources: Vec<String>,
        all: bool,
    },
}

/// Where the bridge delivers events (the Tauri app, or a test recorder).
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: EngineEvent);
}

/// Emits to every webview of the app as [`crate::ENGINE_EVENT`].
pub struct TauriSink<R: tauri::Runtime>(pub tauri::AppHandle<R>);

impl<R: tauri::Runtime> EventSink for TauriSink<R> {
    fn emit(&self, event: EngineEvent) {
        use tauri::Emitter;
        if let Err(error) = self.0.emit(crate::ENGINE_EVENT, &event) {
            log::warn!("engine event not delivered: {error}");
        }
    }
}

/// Forwards engine news of `profile_id` to `sink` until the engine is gone.
pub async fn bridge(
    profile_id: String,
    mut status: watch::Receiver<SyncStatus>,
    mut changes: broadcast::Receiver<ResourcesChanged>,
    sink: Arc<dyn EventSink>,
) {
    let current = StatusDto::from(&*status.borrow_and_update());
    sink.emit(EngineEvent::Status {
        profile_id: profile_id.clone(),
        status: current,
    });
    let mut status_open = true;
    loop {
        tokio::select! {
            changed = status.changed(), if status_open => match changed {
                Ok(()) => {
                    let current = StatusDto::from(&*status.borrow_and_update());
                    sink.emit(EngineEvent::Status {
                        profile_id: profile_id.clone(),
                        status: current,
                    });
                }
                Err(_) => status_open = false,
            },
            received = changes.recv() => match received {
                Ok(changed) => sink.emit(EngineEvent::ResourcesChanged {
                    profile_id: profile_id.clone(),
                    resources: changed.resources.into_iter().map(|r| r.0).collect(),
                    all: false,
                }),
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    sink.emit(EngineEvent::ResourcesChanged {
                        profile_id: profile_id.clone(),
                        resources: Vec::new(),
                        all: true,
                    });
                }
                Err(broadcast::error::RecvError::Closed) => return,
            },
        }
    }
}

/// Records events (tests).
#[cfg(test)]
#[derive(Debug, Default)]
pub struct Recorder {
    events: std::sync::Mutex<Vec<EngineEvent>>,
    notify: tokio::sync::Notify,
}

#[cfg(test)]
impl Recorder {
    pub fn events(&self) -> Vec<EngineEvent> {
        self.events.lock().unwrap().clone()
    }

    /// Waits (up to 10 s) for an event that matches `want`.
    pub async fn wait_for(&self, want: impl Fn(&EngineEvent) -> bool) -> EngineEvent {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let notified = self.notify.notified();
            if let Some(found) = self.events().into_iter().find(|e| want(e)) {
                return found;
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                panic!("no matching engine event; got {:?}", self.events());
            }
        }
    }
}

#[cfg(test)]
impl EventSink for Recorder {
    fn emit(&self, event: EngineEvent) {
        self.events.lock().unwrap().push(event);
        self.notify.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keystone_sync::engine::SyncState;
    use keystone_sync::wire::ResourceName;

    #[tokio::test]
    async fn status_and_changes_reach_the_sink_in_order_with_the_profile() {
        let (status_tx, status_rx) = watch::channel(SyncStatus::default());
        let (changes_tx, changes_rx) = broadcast::channel(4);
        let recorder = Arc::new(Recorder::default());
        let task = tokio::spawn(bridge("p1".into(), status_rx, changes_rx, recorder.clone()));

        recorder
            .wait_for(|e| matches!(e, EngineEvent::Status { status, .. } if status.state == "idle"))
            .await;
        status_tx.send_modify(|s| s.state = SyncState::Syncing);
        recorder
            .wait_for(
                |e| matches!(e, EngineEvent::Status { status, .. } if status.state == "syncing"),
            )
            .await;
        changes_tx
            .send(ResourcesChanged {
                resources: vec![ResourceName("parties".into())],
            })
            .unwrap();
        let event = recorder
            .wait_for(|e| matches!(e, EngineEvent::ResourcesChanged { .. }))
            .await;
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "type": "resources_changed", "profile_id": "p1",
                "resources": ["parties"], "all": false
            })
        );

        // The engine is gone: the bridge ends.
        drop(status_tx);
        drop(changes_tx);
        tokio::time::timeout(std::time::Duration::from_secs(5), task)
            .await
            .expect("bridge ends")
            .unwrap();
        let status = serde_json::to_value(&recorder.events()[0]).unwrap();
        assert_eq!(status["type"], "status");
        assert_eq!(status["profile_id"], "p1");
    }

    #[tokio::test]
    async fn lost_notices_ask_for_a_full_refetch() {
        let (_status_tx, status_rx) = watch::channel(SyncStatus::default());
        let (changes_tx, changes_rx) = broadcast::channel(1);
        for name in ["a", "b", "c"] {
            changes_tx
                .send(ResourcesChanged {
                    resources: vec![ResourceName(name.into())],
                })
                .unwrap();
        }
        let recorder = Arc::new(Recorder::default());
        let task = tokio::spawn(bridge("p1".into(), status_rx, changes_rx, recorder.clone()));
        recorder
            .wait_for(|e| matches!(e, EngineEvent::ResourcesChanged { all: true, .. }))
            .await;
        task.abort();
    }
}
