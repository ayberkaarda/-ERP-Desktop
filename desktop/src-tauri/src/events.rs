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

use keystone_sync::engine::{ResourcesChanged, SyncHandle, SyncState, SyncStatus, Trigger};
use serde::Serialize;
use tokio::sync::{broadcast, watch};
use ts_rs::TS;

use crate::dto::profile::ProfileStateDto;
use crate::dto::status::StatusDto;
use crate::router::{Connectivity, ConnectivityChange};

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
    /// The profile's server became reachable (`online`) or unreachable, as
    /// a request through the shell found it. Sent on a change only.
    Connectivity { profile_id: String, online: bool },
}

/// Where the bridges deliver events (the Tauri app, or a test recorder).
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: EngineEvent);
    /// A change of [`ProfileStateDto`] ([`crate::PROFILE_STATE_EVENT`]).
    fn profile_state(&self, state: &ProfileStateDto);
}

/// Emits to every webview of the app as [`crate::ENGINE_EVENT`] and
/// [`crate::PROFILE_STATE_EVENT`].
pub struct TauriSink<R: tauri::Runtime>(pub tauri::AppHandle<R>);

impl<R: tauri::Runtime> EventSink for TauriSink<R> {
    fn emit(&self, event: EngineEvent) {
        use tauri::Emitter;
        if let Err(error) = self.0.emit(crate::ENGINE_EVENT, &event) {
            log::warn!("engine event not delivered: {error}");
        }
    }

    fn profile_state(&self, state: &ProfileStateDto) {
        use tauri::Emitter;
        if let Err(error) = self.0.emit(crate::PROFILE_STATE_EVENT, state) {
            log::warn!("profile state not delivered: {error}");
        }
    }
}

/// The engine side of a [`connectivity_bridge`]: its status, its finished
/// passes ([`keystone_sync::engine::SyncEngine::subscribe_passes`]) and the
/// view it feeds.
pub struct EngineView {
    pub status: watch::Receiver<SyncStatus>,
    pub passes: watch::Receiver<u64>,
    pub connectivity: Connectivity,
}

/// Forwards connectivity changes of `profile_id` to `sink` until aborted.
///
/// - A change the engine does not agree with yet (a request reached the
///   server while the engine is offline, or found it gone while the engine
///   is not) asks the sync loop for a run (`Trigger::NetworkChanged`), so
///   the engine finds out at once. Without `engine`, only a return does.
/// - With `engine`, the engine's own findings feed the view: leaving
///   `Offline` (the server answered it) counts as reachable, entering it as
///   unreachable. A pass that ends idle while the view says unreachable
///   counts as reachable too: a request that found the server gone for a
///   moment (the engine never went offline) does not keep the profile
///   offline until that finding expires. So a request after the engine
///   found the server again is not answered from the earlier failed one.
pub async fn connectivity_bridge(
    profile_id: String,
    mut changes: broadcast::Receiver<ConnectivityChange>,
    engine: Option<EngineView>,
    sync: Option<SyncHandle>,
    sink: Arc<dyn EventSink>,
) {
    let (mut status, mut passes, connectivity) = match engine {
        Some(view) => (
            Some(view.status),
            Some(view.passes),
            Some(view.connectivity),
        ),
        None => (None, None, None),
    };
    let mut engine_offline = status
        .as_mut()
        .is_some_and(|rx| rx.borrow_and_update().state == SyncState::Offline);
    loop {
        tokio::select! {
            received = changes.recv() => match received {
                Ok(change) if change.profile == profile_id => {
                    sink.emit(EngineEvent::Connectivity {
                        profile_id: profile_id.clone(),
                        online: change.online,
                    });
                    let disagrees = match &status {
                        Some(rx) => change.online == (rx.borrow().state == SyncState::Offline),
                        None => change.online,
                    };
                    if disagrees && let Some(sync) = &sync {
                        sync.trigger(Trigger::NetworkChanged);
                    }
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => return,
            },
            changed = async { status.as_mut()?.changed().await.ok() }, if status.is_some() => {
                let Some(rx) = status.as_mut().filter(|_| changed.is_some()) else {
                    // The engine is gone: connectivity news still goes on.
                    status = None;
                    continue;
                };
                let offline = rx.borrow_and_update().state == SyncState::Offline;
                if offline != engine_offline {
                    engine_offline = offline;
                    if let Some(connectivity) = &connectivity {
                        connectivity.observe(
                            &profile_id,
                            !offline,
                            tokio::time::Instant::now().into_std(),
                        );
                    }
                }
            }
            changed = async { passes.as_mut()?.changed().await.ok() }, if passes.is_some() => {
                if changed.is_none() {
                    passes = None;
                    continue;
                }
                let idle = status
                    .as_ref()
                    .is_some_and(|rx| rx.borrow().state == SyncState::Idle);
                let now = tokio::time::Instant::now().into_std();
                if idle
                    && let Some(connectivity) = &connectivity
                    && !connectivity.online(&profile_id, Some(false), now)
                {
                    connectivity.observe(&profile_id, true, now);
                }
            }
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
    states: std::sync::Mutex<Vec<ProfileStateDto>>,
    notify: tokio::sync::Notify,
}

#[cfg(test)]
impl Recorder {
    pub fn events(&self) -> Vec<EngineEvent> {
        self.events.lock().unwrap().clone()
    }

    /// Profile states in the order they were told.
    pub fn states(&self) -> Vec<ProfileStateDto> {
        self.states.lock().unwrap().clone()
    }

    pub fn clear_states(&self) {
        self.states.lock().unwrap().clear();
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

    fn profile_state(&self, state: &ProfileStateDto) {
        self.states.lock().unwrap().push(state.clone());
        self.notify.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keystone_sync::engine::SyncState;
    use keystone_sync::wire::ResourceName;
    use serde_json::Value;

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
    async fn connectivity_changes_of_the_profile_become_engine_events() {
        let connectivity = crate::router::Connectivity::default();
        let recorder = Arc::new(Recorder::default());
        let task = tokio::spawn(connectivity_bridge(
            "p1".into(),
            connectivity.subscribe(),
            None,
            None,
            recorder.clone(),
        ));
        let now = std::time::Instant::now();
        connectivity.observe("p2", false, now);
        connectivity.observe("p1", false, now);
        connectivity.observe("p1", true, now);
        recorder
            .wait_for(|e| matches!(e, EngineEvent::Connectivity { online: true, .. }))
            .await;
        let events: Vec<Value> = recorder
            .events()
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect();
        assert_eq!(
            events,
            [
                serde_json::json!({"type": "connectivity", "profile_id": "p1", "online": false}),
                serde_json::json!({"type": "connectivity", "profile_id": "p1", "online": true}),
            ]
        );
        task.abort();
    }

    /// The engine's own findings move the view: entering `Offline` makes the
    /// profile unreachable, leaving it reachable; other moves change nothing.
    #[tokio::test]
    async fn the_engine_leaving_or_entering_offline_moves_the_view() {
        let connectivity = crate::router::Connectivity::default();
        let recorder = Arc::new(Recorder::default());
        let (status, status_rx) = watch::channel(SyncStatus::default());
        let task = tokio::spawn(connectivity_bridge(
            "p1".into(),
            connectivity.subscribe(),
            Some(EngineView {
                status: status_rx,
                passes: tokio::sync::watch::channel(0).1,
                connectivity: connectivity.clone(),
            }),
            None,
            recorder.clone(),
        ));
        let set = |state: SyncState| status.send_modify(|s| s.state = state);
        // The bridge reads the engine's state as it starts: idle.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        set(SyncState::Syncing);
        set(SyncState::Idle);
        set(SyncState::Offline);
        recorder
            .wait_for(|e| matches!(e, EngineEvent::Connectivity { online: false, .. }))
            .await;
        let later = std::time::Instant::now() + std::time::Duration::from_secs(1);
        assert!(!connectivity.online("p1", Some(false), later));
        // Still offline: nothing new.
        status.send_modify(|s| s.failures += 1);
        set(SyncState::Syncing);
        recorder
            .wait_for(|e| matches!(e, EngineEvent::Connectivity { online: true, .. }))
            .await;
        assert!(connectivity.online("p1", Some(true), later));
        set(SyncState::Failed("SERVER_ERROR"));
        set(SyncState::Idle);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        let events: Vec<Value> = recorder
            .events()
            .iter()
            .map(|e| serde_json::to_value(e).unwrap())
            .collect();
        assert_eq!(
            events,
            [
                serde_json::json!({"type": "connectivity", "profile_id": "p1", "online": false}),
                serde_json::json!({"type": "connectivity", "profile_id": "p1", "online": true}),
            ]
        );
        // The engine gone, connectivity news still goes on.
        drop(status);
        connectivity.observe("p1", false, std::time::Instant::now());
        recorder.wait_for(|_| recorder.events().len() == 3).await;
        task.abort();
    }

    #[tokio::test]
    async fn the_connectivity_bridge_outlives_lost_news() {
        let connectivity = crate::router::Connectivity::default();
        let recorder = Arc::new(Recorder::default());
        let changes = connectivity.subscribe();
        let now = std::time::Instant::now();
        // Twenty changes before the bridge reads one: the channel keeps 16.
        for n in 0..20 {
            connectivity.observe("p1", n % 2 == 1, now);
        }
        let task = tokio::spawn(connectivity_bridge(
            "p1".into(),
            changes,
            None,
            None,
            recorder.clone(),
        ));
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        let wait_for = async |count: usize| {
            while recorder.events().len() < count {
                assert!(
                    tokio::time::Instant::now() < deadline,
                    "{:?}",
                    recorder.events()
                );
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        };
        // The 16 the channel kept, after the loss.
        wait_for(16).await;
        // And news after that.
        connectivity.observe("p1", false, now);
        wait_for(17).await;
        let events = recorder.events();
        assert_eq!(events.len(), 17);
        assert_eq!(
            events.last(),
            Some(&EngineEvent::Connectivity {
                profile_id: "p1".into(),
                online: false
            })
        );
        task.abort();
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
