//! Refresh of the `source: snapshot` resources of the active profile
//! (stock balances, ageing reports): their list `GET` every
//! `defaults.snapshot_refresh_minutes` of the offline manifest, kept for
//! the offline read like an answer `api_request` fetched.
//!
//! - One loop per active profile with a company, on the engine runtime; it
//!   ends with the profile (switch, company change, removal, sign-out
//!   closes it through [`super::Desktop`]'s stop).
//! - A round runs when the server is reachable ([`Connectivity`] and the
//!   engine), the engine does not ask for a sign-in and the session has
//!   tokens. A round that cannot run is skipped until the next period, or
//!   until the engine status moves (a run finished, the network came back).
//! - A round that stored nothing because the sign-in is not verified yet
//!   (or moved during the call) is tried again on the next status change.
//! - An answer is stored for the sign-in it was fetched in (the engine
//!   refuses another generation) and never after the profile started to
//!   close: the closing waits for a write in progress, and a write that has
//!   not started checks the stop flag first.
//! - Every call runs in its own task, like `api_request`: stopping never
//!   cuts a token refresh in half.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use keystone_sync::client::{HttpClient, ProxyMethod, ProxyRequest};
use keystone_sync::engine::{SyncState, SyncStatus};
use keystone_sync::wire::ResourceName;
use serde_json::Value;
use tokio::sync::watch;
use tokio::time::Instant;

use crate::router::{Connectivity, local_read};
use crate::state::Engine;

pub(super) type Boxed<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// A `source: snapshot` resource and its list path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SnapshotResource {
    pub resource: ResourceName,
    pub path: String,
}

/// The snapshot resources of an offline manifest.
pub(super) fn resources(manifest: &str) -> Vec<SnapshotResource> {
    let root: Value = serde_json::from_str(manifest).unwrap_or_default();
    root["resources"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|entry| entry["source"] == "snapshot")
        .filter_map(|entry| {
            Some(SnapshotResource {
                resource: ResourceName(entry["resource"].as_str()?.to_owned()),
                path: entry["path"].as_str()?.to_owned(),
            })
        })
        .collect()
}

/// `defaults.snapshot_refresh_minutes` of an offline manifest.
pub(super) fn period(manifest: &str) -> Option<Duration> {
    let root: Value = serde_json::from_str(manifest).ok()?;
    let minutes = root["defaults"]["snapshot_refresh_minutes"].as_u64()?;
    (minutes > 0).then(|| Duration::from_secs(minutes * 60))
}

/// The work of one round, apart from the schedule ([`refresh_loop`]).
pub(super) trait Refresh: Send + Sync + 'static {
    /// Whether a round may run now.
    fn ready(&self) -> Boxed<'_, bool>;
    /// One round. `true`: done until the next period; `false`: try again
    /// on the next status change. Gives up early once `stop` is set.
    fn round<'a>(&'a self, stop: &'a watch::Receiver<bool>) -> Boxed<'a, bool>;
}

/// Runs `work` now and every `period` after, until `stop` is set (or its
/// sender is gone). A round that is not ready or not done is tried again
/// when `status` moves.
pub(super) async fn refresh_loop<W: Refresh>(
    work: W,
    period: Duration,
    mut status: watch::Receiver<SyncStatus>,
    mut stop: watch::Receiver<bool>,
) {
    let mut next = Instant::now();
    let mut again_on_change = false;
    let mut status_open = true;
    loop {
        let on_time = tokio::select! {
            biased;
            _ = stop.changed() => return,
            () = tokio::time::sleep_until(next) => true,
            changed = status.changed(), if again_on_change && status_open => {
                if changed.is_err() {
                    status_open = false;
                    continue;
                }
                false
            }
        };
        if *stop.borrow() {
            return;
        }
        if on_time {
            next = Instant::now() + period;
        }
        status.borrow_and_update();
        let done = work.ready().await && work.round(&stop).await;
        if *stop.borrow() {
            return;
        }
        if done && !on_time {
            next = Instant::now() + period;
        }
        again_on_change = !done;
    }
}

/// The round of a live profile.
pub(super) struct Live {
    pub profile_id: String,
    pub client: Arc<HttpClient>,
    pub engine: Arc<Engine>,
    pub connectivity: Connectivity,
    pub resources: Vec<SnapshotResource>,
}

impl Live {
    /// Generation of a sign-in that can make calls.
    async fn signed_in(&self) -> Option<u64> {
        let session = self.client.session().clone();
        let record = tauri::async_runtime::spawn_blocking(move || session.record())
            .await
            .ok()?
            .ok()?;
        (record.tokens.is_some() && !record.deactivated).then_some(record.generation)
    }

    /// Fetches and keeps one resource; `false` when it is worth another try
    /// before the next period.
    async fn refresh(&self, item: &SnapshotResource, stop: &watch::Receiver<bool>) -> bool {
        let Some(generation) = self.signed_in().await else {
            return false;
        };
        let request = ProxyRequest {
            method: ProxyMethod::Get,
            path: item.path.clone(),
            query: Vec::new(),
            headers: Vec::new(),
            body: None,
        };
        let client = self.client.clone();
        let call =
            tauri::async_runtime::spawn(async move { client.proxy_in(&request, generation).await });
        let mut stopping = stop.clone();
        let sent = tokio::select! {
            _ = stopping.wait_for(|stopped| *stopped) => return false,
            joined = call => match joined {
                Ok(sent) => sent,
                Err(_) => return false,
            },
        };
        let response = match sent {
            Ok(response) => response,
            Err(error) => {
                log::debug!(
                    "snapshot of {} not fetched: {}",
                    item.resource.0,
                    error.code()
                );
                return false;
            }
        };
        let body = serde_json::from_slice::<Value>(&response.body)
            .ok()
            .filter(|body| body.get("data").is_some());
        let (200, Some(body)) = (response.status, body) else {
            // The server answered: nothing to keep until the next period.
            log::debug!(
                "snapshot of {} answered {}",
                item.resource.0,
                response.status
            );
            return true;
        };
        let (engine, resource, stop) = (self.engine.clone(), item.resource.clone(), stop.clone());
        let saved = tauri::async_runtime::spawn_blocking(move || {
            if *stop.borrow() {
                // The profile is closing: another company may share the store.
                return Ok(());
            }
            local_read::save_snapshot(&engine, &resource, &body, generation)
        })
        .await;
        match saved {
            Ok(Ok(())) => true,
            Ok(Err(error)) => {
                log::debug!("snapshot of {} not kept: {}", item.resource.0, error.code);
                // Not verified yet, or another sign-in meanwhile: soon again.
                !matches!(
                    error.code.as_str(),
                    "OFFLINE_UNAVAILABLE" | "UNAUTHENTICATED"
                )
            }
            Err(_) => false,
        }
    }
}

impl Refresh for Live {
    fn ready(&self) -> Boxed<'_, bool> {
        Box::pin(async move {
            let status = self.engine.status();
            if status.state == SyncState::AuthRequired {
                return false;
            }
            let online = self.connectivity.online(
                &self.profile_id,
                Some(status.state == SyncState::Offline),
                std::time::Instant::now(),
            );
            online && self.signed_in().await.is_some()
        })
    }

    fn round<'a>(&'a self, stop: &'a watch::Receiver<bool>) -> Boxed<'a, bool> {
        Box::pin(async move {
            let mut done = true;
            for item in &self.resources {
                if *stop.borrow() {
                    return false;
                }
                done &= self.refresh(item, stop).await;
            }
            done
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;

    const PERIOD: Duration = Duration::from_secs(15 * 60);

    #[derive(Default)]
    struct Fake {
        ready: AtomicBool,
        /// What a round answers.
        done: AtomicBool,
        rounds: AtomicUsize,
    }

    impl Refresh for Arc<Fake> {
        fn ready(&self) -> Boxed<'_, bool> {
            Box::pin(async move { self.ready.load(Ordering::SeqCst) })
        }

        fn round<'a>(&'a self, _: &'a watch::Receiver<bool>) -> Boxed<'a, bool> {
            Box::pin(async move {
                self.rounds.fetch_add(1, Ordering::SeqCst);
                self.done.load(Ordering::SeqCst)
            })
        }
    }

    struct Run {
        fake: Arc<Fake>,
        status: watch::Sender<SyncStatus>,
        stop: watch::Sender<bool>,
        task: tokio::task::JoinHandle<()>,
    }

    fn start_loop(ready: bool) -> Run {
        let fake = Arc::new(Fake::default());
        fake.ready.store(ready, Ordering::SeqCst);
        fake.done.store(true, Ordering::SeqCst);
        let (status, status_rx) = watch::channel(SyncStatus::default());
        let (stop, stop_rx) = watch::channel(false);
        let task = tokio::spawn(refresh_loop(fake.clone(), PERIOD, status_rx, stop_rx));
        Run {
            fake,
            status,
            stop,
            task,
        }
    }

    impl Run {
        fn rounds(&self) -> usize {
            self.fake.rounds.load(Ordering::SeqCst)
        }

        async fn after(&self, wait: Duration) -> usize {
            tokio::time::advance(wait).await;
            settle().await;
            self.rounds()
        }

        fn move_status(&self) {
            self.status.send_modify(|s| s.failures += 1);
        }
    }

    async fn settle() {
        for _ in 0..20 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_round_now_and_one_every_period() {
        let run = start_loop(true);
        settle().await;
        assert_eq!(run.rounds(), 1);
        assert_eq!(run.after(PERIOD - Duration::from_secs(1)).await, 1);
        assert_eq!(run.after(Duration::from_secs(1)).await, 2);
        assert_eq!(run.after(PERIOD / 2).await, 2);
        // Status news between rounds that were done change nothing.
        run.move_status();
        settle().await;
        assert_eq!(run.rounds(), 2);
        assert_eq!(run.after(PERIOD / 2).await, 3);
    }

    #[tokio::test(start_paused = true)]
    async fn a_round_that_is_not_ready_is_skipped() {
        let run = start_loop(false);
        settle().await;
        assert_eq!(run.rounds(), 0);
        assert_eq!(run.after(PERIOD).await, 0);
        // Ready again (online): the next status news runs it.
        run.fake.ready.store(true, Ordering::SeqCst);
        run.move_status();
        settle().await;
        assert_eq!(run.rounds(), 1);
        // Then one period after that round.
        assert_eq!(run.after(PERIOD - Duration::from_secs(1)).await, 1);
        assert_eq!(run.after(Duration::from_secs(1)).await, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_round_that_is_not_done_runs_again_on_status_news() {
        let run = start_loop(true);
        run.fake.done.store(false, Ordering::SeqCst);
        settle().await;
        assert_eq!(run.rounds(), 1);
        assert_eq!(run.after(Duration::from_secs(60)).await, 1);
        run.fake.done.store(true, Ordering::SeqCst);
        run.move_status();
        settle().await;
        assert_eq!(run.rounds(), 2);
        // Done now: status news waits for the period again.
        run.move_status();
        settle().await;
        assert_eq!(run.rounds(), 2);
        assert_eq!(run.after(PERIOD).await, 3);
    }

    #[tokio::test(start_paused = true)]
    async fn the_loop_ends_when_stopped() {
        let run = start_loop(true);
        settle().await;
        run.stop.send_replace(true);
        settle().await;
        assert!(run.task.is_finished());
        assert_eq!(run.after(PERIOD * 3).await, 1);

        // A dropped owner stops it too.
        let other = start_loop(true);
        settle().await;
        let Run { task, stop, .. } = other;
        drop(stop);
        settle().await;
        assert!(task.is_finished());
    }

    #[test]
    fn the_compiled_manifest_names_the_snapshots_and_their_period() {
        let manifest = include_str!("../../../../contracts/offline-manifest.json");
        assert_eq!(period(manifest), Some(PERIOD));
        let names: Vec<(String, String)> = resources(manifest)
            .into_iter()
            .map(|r| (r.resource.0, r.path))
            .collect();
        assert_eq!(
            names,
            [
                (
                    "stock-balances".to_owned(),
                    "/api/v1/stock-balances".to_owned()
                ),
                (
                    "treasury-reports.receivables-ageing".to_owned(),
                    "/api/v1/treasury-reports/receivables-ageing".to_owned()
                ),
                (
                    "treasury-reports.payables-ageing".to_owned(),
                    "/api/v1/treasury-reports/payables-ageing".to_owned()
                ),
            ]
        );
        assert_eq!(period(r#"{"defaults": {}}"#), None);
        assert_eq!(
            period(r#"{"defaults": {"snapshot_refresh_minutes": 0}}"#),
            None
        );
    }
}
