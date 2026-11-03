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

use keystone_sync::SyncError;
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

/// How a round ended. Ordered by what the loop does next: a round over
/// several resources ends as the worst of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Round {
    /// Done until the next period.
    Done,
    /// The proxy refused the call for the sign-in or account: the error it
    /// gives for a 401 (after one refresh) and for `UNAUTHENTICATED`,
    /// `USER_DEACTIVATED`, `PASSWORD_CHANGE_REQUIRED` and the two-factor
    /// codes. Asking again gets the same answer: not tried again until
    /// [`Refresh::ready`] says so (another sign-in). Every other answer,
    /// `COMPANY_FORBIDDEN`, other 403s, 429 and 5xx included, comes back as
    /// an answer and ends the round as [`Round::Done`]: asked again at the
    /// next period (a company change starts a new loop).
    Refused,
    /// A failure that may pass (no connection, a lost answer, a sign-in
    /// not verified yet): tried again after a growing delay
    /// ([`retry_delay`]).
    Again,
}

/// The work of one round, apart from the schedule ([`refresh_loop`]).
pub(super) trait Refresh: Send + Sync + 'static {
    /// Whether a round may run now.
    fn ready(&self) -> Boxed<'_, bool>;
    /// One round. Gives up early once `stop` is set.
    fn round<'a>(&'a self, stop: &'a watch::Receiver<bool>) -> Boxed<'a, Round>;
}

/// The delay before the `failures`-th retry of a round that ended
/// [`Round::Again`]: 1 s doubling to 5 min, ±20 % (`unit` in `[0, 1]`).
pub(super) fn retry_delay(failures: u32, unit: f64) -> Duration {
    keystone_sync::backoff::Backoff::default().delay(failures.max(1), unit)
}

/// Uniform sample in `[0, 1]` from the random bits of a UUIDv7.
fn jitter_unit() -> f64 {
    let bits = (uuid::Uuid::now_v7().as_u128() & u128::from(u32::MAX)) as u32;
    f64::from(bits) / f64::from(u32::MAX)
}

/// Runs `work` now and every `period` after, until `stop` is set (or its
/// sender is gone).
///
/// - A round that is not ready, or was refused, runs again when `status`
///   moves and it is ready then (ready is checked without a request).
/// - A round that failed for a passing reason runs again after
///   [`retry_delay`], growing with each failure in a row; status news does
///   not bring it forward, so a failing server is not asked every second.
pub(super) async fn refresh_loop<W: Refresh>(
    work: W,
    period: Duration,
    mut status: watch::Receiver<SyncStatus>,
    mut stop: watch::Receiver<bool>,
) {
    let mut next = Instant::now();
    let mut again_on_change = false;
    let mut retry_at: Option<Instant> = None;
    let mut failures = 0u32;
    let mut status_open = true;
    loop {
        let on_time = tokio::select! {
            biased;
            _ = stop.changed() => return,
            () = tokio::time::sleep_until(next) => true,
            () = tokio::time::sleep_until(retry_at.unwrap_or(next)), if retry_at.is_some() => false,
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
        let outcome = if work.ready().await {
            Some(work.round(&stop).await)
        } else {
            None
        };
        if *stop.borrow() {
            return;
        }
        retry_at = None;
        again_on_change = false;
        match outcome {
            None | Some(Round::Refused) => {
                failures = 0;
                again_on_change = true;
            }
            Some(Round::Done) => {
                failures = 0;
                if !on_time {
                    next = Instant::now() + period;
                }
            }
            Some(Round::Again) => {
                failures = failures.saturating_add(1);
                retry_at = Some(Instant::now() + retry_delay(failures, jitter_unit()));
            }
        }
    }
}

/// The round of a live profile.
pub(super) struct Live {
    pub profile_id: String,
    pub client: Arc<HttpClient>,
    pub engine: Arc<Engine>,
    pub connectivity: Connectivity,
    pub resources: Vec<SnapshotResource>,
    /// The sign-in whose snapshot request the server refused for the
    /// account ([`Round::Refused`]): no round runs while it is current.
    pub refused: std::sync::Mutex<Option<u64>>,
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

    fn refused(&self) -> std::sync::MutexGuard<'_, Option<u64>> {
        self.refused
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Fetches and keeps one resource.
    async fn refresh(&self, item: &SnapshotResource, stop: &watch::Receiver<bool>) -> Round {
        let Some(generation) = self.signed_in().await else {
            return Round::Again;
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
            _ = stopping.wait_for(|stopped| *stopped) => return Round::Again,
            joined = call => match joined {
                Ok(sent) => sent,
                Err(_) => return Round::Again,
            },
        };
        let response = match sent {
            Ok(response) => response,
            // The proxy gives an error only for a refused sign-in or
            // account: the same request gets the same answer.
            Err(error @ SyncError::Api { .. }) => {
                log::debug!(
                    "snapshot of {} refused: {}; not asked again for this sign-in",
                    item.resource.0,
                    error.code()
                );
                *self.refused() = Some(generation);
                return Round::Refused;
            }
            Err(error) => {
                log::debug!(
                    "snapshot of {} not fetched: {}",
                    item.resource.0,
                    error.code()
                );
                return Round::Again;
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
            return Round::Done;
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
            Ok(Ok(())) => Round::Done,
            Ok(Err(error)) => {
                log::debug!("snapshot of {} not kept: {}", item.resource.0, error.code);
                // Not verified yet, or another sign-in meanwhile: soon again.
                if matches!(
                    error.code.as_str(),
                    "OFFLINE_UNAVAILABLE" | "UNAUTHENTICATED"
                ) {
                    Round::Again
                } else {
                    Round::Done
                }
            }
            Err(_) => Round::Again,
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
                tokio::time::Instant::now().into_std(),
            );
            if !online {
                return false;
            }
            match self.signed_in().await {
                Some(generation) => *self.refused() != Some(generation),
                None => false,
            }
        })
    }

    fn round<'a>(&'a self, stop: &'a watch::Receiver<bool>) -> Boxed<'a, Round> {
        Box::pin(async move {
            let mut outcome = Round::Done;
            for item in &self.resources {
                if *stop.borrow() {
                    return Round::Again;
                }
                let round = self.refresh(item, stop).await;
                outcome = outcome.max(round);
                if round == Round::Refused {
                    // The account is refused for every resource alike.
                    break;
                }
            }
            outcome
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;

    const PERIOD: Duration = Duration::from_secs(15 * 60);

    struct Fake {
        ready: AtomicBool,
        /// What a round answers.
        outcome: std::sync::Mutex<Round>,
        rounds: AtomicUsize,
    }

    impl Fake {
        fn answer(&self, outcome: Round) {
            *self.outcome.lock().unwrap() = outcome;
        }
    }

    impl Refresh for Arc<Fake> {
        fn ready(&self) -> Boxed<'_, bool> {
            Box::pin(async move { self.ready.load(Ordering::SeqCst) })
        }

        fn round<'a>(&'a self, _: &'a watch::Receiver<bool>) -> Boxed<'a, Round> {
            Box::pin(async move {
                self.rounds.fetch_add(1, Ordering::SeqCst);
                *self.outcome.lock().unwrap()
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
        let fake = Arc::new(Fake {
            ready: AtomicBool::new(ready),
            outcome: std::sync::Mutex::new(Round::Done),
            rounds: AtomicUsize::new(0),
        });
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
    async fn the_period_counts_from_a_round_that_status_news_ran() {
        let run = start_loop(false);
        settle().await;
        assert_eq!(run.after(PERIOD / 2).await, 0);
        // Half a period late, ready: the status news runs the round.
        run.fake.ready.store(true, Ordering::SeqCst);
        run.move_status();
        settle().await;
        assert_eq!(run.rounds(), 1);
        // Not when the first plan's period ends ...
        assert_eq!(run.after(PERIOD / 2).await, 1);
        // ... but one period after the round.
        assert_eq!(run.after(PERIOD / 2).await, 2);
    }

    /// A round that failed for a passing reason runs again after a delay
    /// that grows with each failure (1, 2, 4, ... s, ±20 %), and status
    /// news does not bring it forward.
    #[tokio::test(start_paused = true)]
    async fn a_failing_round_backs_off_and_ignores_status_news() {
        let run = start_loop(true);
        run.fake.answer(Round::Again);
        settle().await;
        assert_eq!(run.rounds(), 1);
        // Status news (the engine's runs) asks nothing.
        for _ in 0..5 {
            run.move_status();
            settle().await;
        }
        assert_eq!(run.rounds(), 1);
        // The n-th retry comes at most 1.2 * 2^(n-1) s after the previous.
        let mut rounds = 1;
        for n in 1..=8u32 {
            let longest = Duration::from_millis(1200 * (1u64 << (n - 1)));
            let shortest = Duration::from_millis(800 * (1u64 << (n - 1)));
            assert_eq!(run.after(shortest - Duration::from_millis(1)).await, rounds);
            run.move_status();
            settle().await;
            assert_eq!(run.rounds(), rounds, "retry {n} came early");
            assert_eq!(
                run.after(longest - shortest + Duration::from_millis(1))
                    .await,
                rounds + 1,
                "retry {n}"
            );
            rounds += 1;
        }
        // The delay stops growing at 5 minutes (jitter on top).
        assert_eq!(retry_delay(30, 0.5), Duration::from_secs(300));
        assert_eq!(retry_delay(30, 1.0), Duration::from_secs(360));
        assert_eq!(retry_delay(0, 0.5), Duration::from_secs(1));
        // Done again: back to the period; status news asks nothing.
        run.fake.answer(Round::Done);
        assert_eq!(run.after(Duration::from_secs(400)).await, rounds + 1);
        run.move_status();
        settle().await;
        assert_eq!(run.rounds(), rounds + 1);
        assert_eq!(run.after(PERIOD).await, rounds + 2);
    }

    /// A failure in a row after a success starts the delays from 1 s again.
    #[tokio::test(start_paused = true)]
    async fn a_success_resets_the_backoff() {
        let run = start_loop(true);
        run.fake.answer(Round::Again);
        settle().await;
        // Four failures: the next delay would be 8 s or more.
        assert_eq!(run.after(Duration::from_millis(1200)).await, 2);
        assert_eq!(run.after(Duration::from_millis(2400)).await, 3);
        assert_eq!(run.after(Duration::from_millis(4800)).await, 4);
        run.fake.answer(Round::Done);
        assert_eq!(run.after(Duration::from_millis(9600)).await, 5);
        // The period round fails: its first retry is about 1 s later.
        run.fake.answer(Round::Again);
        assert_eq!(run.after(PERIOD).await, 6);
        assert_eq!(run.after(Duration::from_millis(1200)).await, 7);
    }

    /// A refused round (the account) is not asked again on its own: it
    /// waits until it is ready on status news, without a timer.
    #[tokio::test(start_paused = true)]
    async fn a_refused_round_waits_until_it_is_ready_again() {
        let run = start_loop(true);
        run.fake.answer(Round::Refused);
        settle().await;
        assert_eq!(run.rounds(), 1);
        // What the live round's `ready` says for the refused sign-in.
        run.fake.ready.store(false, Ordering::SeqCst);
        assert_eq!(run.after(Duration::from_secs(600)).await, 1);
        for _ in 0..10 {
            run.move_status();
            settle().await;
        }
        assert_eq!(run.rounds(), 1);
        assert_eq!(run.after(PERIOD).await, 1);
        // Another sign-in: ready, and the next status news runs it.
        run.fake.ready.store(true, Ordering::SeqCst);
        run.fake.answer(Round::Done);
        run.move_status();
        settle().await;
        assert_eq!(run.rounds(), 2);
    }

    struct AlwaysAgain {
        at: std::sync::Mutex<Vec<Instant>>,
    }

    impl Refresh for Arc<AlwaysAgain> {
        fn ready(&self) -> Boxed<'_, bool> {
            Box::pin(async { true })
        }

        fn round<'a>(&'a self, _: &'a watch::Receiver<bool>) -> Boxed<'a, Round> {
            Box::pin(async move {
                self.at.lock().unwrap().push(Instant::now());
                Round::Again
            })
        }
    }

    /// The first retry of 24 loops lands within 0.8..1.2 s (jitter), some
    /// above 1 s and some below: the delays are spread, not all the same.
    #[tokio::test(start_paused = true)]
    async fn retries_are_spread_by_jitter() {
        let mut loops = Vec::new();
        let mut keep = Vec::new();
        for _ in 0..24 {
            let fake = Arc::new(AlwaysAgain {
                at: std::sync::Mutex::default(),
            });
            let (status, status_rx) = watch::channel(SyncStatus::default());
            let (stop, stop_rx) = watch::channel(false);
            tokio::spawn(refresh_loop(fake.clone(), PERIOD, status_rx, stop_rx));
            keep.push((status, stop));
            loops.push(fake);
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
        let delays: Vec<u128> = loops
            .iter()
            .map(|fake| {
                let at = fake.at.lock().unwrap();
                (at[1] - at[0]).as_millis()
            })
            .collect();
        assert!(
            delays.iter().all(|d| (800..=1200).contains(d)),
            "{delays:?}"
        );
        assert!(delays.iter().any(|d| *d > 1000), "{delays:?}");
        assert!(delays.iter().any(|d| *d < 1000), "{delays:?}");
    }

    /// Four failures in a row, then a time the round could not run (not
    /// ready): the next failures start again from about 1 s.
    #[tokio::test(start_paused = true)]
    async fn a_round_that_could_not_run_resets_the_backoff() {
        let run = start_loop(true);
        run.fake.answer(Round::Again);
        // Rounds at 0, ~1, ~3, ~7 s: four failures (the paused clock moves
        // from timer to timer while the test sleeps).
        tokio::time::sleep(Duration::from_millis(9500)).await;
        assert_eq!(run.rounds(), 4);
        // The fifth try (~15 s) finds it not ready.
        run.fake.ready.store(false, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(20)).await;
        assert_eq!(run.rounds(), 4);
        // Ready again on status news: it runs and fails; the retry is ~1 s later.
        run.fake.ready.store(true, Ordering::SeqCst);
        run.move_status();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(run.rounds(), 5);
        tokio::time::sleep(Duration::from_millis(1300)).await;
        assert_eq!(run.rounds(), 6);
    }

    #[test]
    fn a_round_ends_as_the_worst_of_its_resources() {
        assert!(Round::Done < Round::Refused && Round::Refused < Round::Again);
        assert_eq!(Round::Done.max(Round::Again), Round::Again);
        assert_eq!(Round::Refused.max(Round::Done), Round::Refused);
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
