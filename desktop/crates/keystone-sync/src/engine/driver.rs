//! The long-running loop around [`SyncEngine::run_once`].
//!
//! Runs at startup, then: every [`ONLINE_INTERVAL`] while online; offline
//! probes after 1/2/4/8/16/30 s ([`offline_probe_delay`]); after a failure
//! the backoff (1 s → 300 s, ±20%), never sooner than `Retry-After`; no
//! timer while sign-in is required. Triggers sent through [`SyncHandle`]
//! (network change, manual, realtime) run at once, except that no run
//! starts before the last `Retry-After` has passed (the engine waits it
//! out, see [`SyncEngine::run_once`]); triggers that queue up
//! while a run is busy collapse into one run, and a follow-up a cancelled
//! run owed to a coalesced caller runs here.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use uuid::Uuid;

use super::{SyncEngine, SyncState, Trigger};
use crate::backoff::{Backoff, ONLINE_INTERVAL, RETRY_AFTER_MAX, offline_probe_delay};
use crate::client::SyncApi;

/// Sends triggers to a [`SyncLoop`]. Dropping every handle stops the loop.
#[derive(Debug, Clone)]
pub struct SyncHandle {
    tx: mpsc::UnboundedSender<Trigger>,
}

impl SyncHandle {
    /// `false` when the loop has stopped.
    pub fn trigger(&self, trigger: Trigger) -> bool {
        self.tx.send(trigger).is_ok()
    }
}

pub struct SyncLoop<A> {
    engine: Arc<SyncEngine<A>>,
    rx: mpsc::UnboundedReceiver<Trigger>,
}

/// A loop over `engine` and the handle that drives it. Spawn
/// [`SyncLoop::run`] on the runtime.
pub fn sync_loop<A: SyncApi>(engine: Arc<SyncEngine<A>>) -> (SyncHandle, SyncLoop<A>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (SyncHandle { tx }, SyncLoop { engine, rx })
}

/// Delay before the next automatic run, `None` for "wait for a trigger".
/// `offline_attempt` is the 0-based probe number, `unit` a uniform sample
/// in `[0, 1]` for the jitter.
pub fn next_delay(
    state: &SyncState,
    failures: u32,
    offline_attempt: usize,
    retry_after: Option<Duration>,
    backoff: &Backoff,
    unit: f64,
) -> Option<Duration> {
    match state {
        SyncState::Idle | SyncState::Syncing => Some(ONLINE_INTERVAL),
        SyncState::Offline => Some(offline_probe_delay(offline_attempt)),
        SyncState::AuthRequired => None,
        SyncState::Failed(_) => {
            let delay = backoff.delay(failures.max(1), unit);
            Some(retry_after.map_or(delay, |r| r.min(RETRY_AFTER_MAX).max(delay)))
        }
    }
}

/// Uniform sample in `[0, 1]` from the random bits of a UUIDv7.
fn jitter_unit() -> f64 {
    let bits = (Uuid::now_v7().as_u128() & u128::from(u32::MAX)) as u32;
    f64::from(bits) / f64::from(u32::MAX)
}

impl<A: SyncApi> SyncLoop<A> {
    /// Runs until every [`SyncHandle`] is dropped.
    pub async fn run(mut self) {
        let mut trigger = Some(Trigger::Startup);
        let mut offline_attempt = 0usize;
        loop {
            if let Some(next) = trigger.take() {
                // Triggers that piled up are covered by this run.
                while self.rx.try_recv().is_ok() {}
                // The engine publishes the outcome in its status.
                let _ = self.engine.run_once(next).await;
            }
            let status = self.engine.status();
            if status.state == SyncState::Offline {
                offline_attempt += 1;
            } else {
                offline_attempt = 0;
            }
            let delay = next_delay(
                &status.state,
                status.failures,
                offline_attempt.saturating_sub(1),
                status.retry_after,
                self.engine.backoff(),
                jitter_unit(),
            );
            let timer_trigger = if status.state == SyncState::Offline {
                Trigger::Probe
            } else {
                Trigger::Timer
            };
            let sleep = async {
                match delay {
                    Some(delay) => tokio::time::sleep(delay).await,
                    None => std::future::pending::<()>().await,
                }
            };
            tokio::select! {
                received = self.rx.recv() => match received {
                    Some(next) => trigger = Some(next),
                    None => return,
                },
                // A run cancelled elsewhere owed a follow-up.
                () = self.engine.follow_up_requested() => trigger = Some(Trigger::Manual),
                () = sleep => trigger = Some(timer_trigger),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delays_follow_the_state() {
        let b = Backoff::default();
        assert_eq!(
            next_delay(&SyncState::Idle, 0, 0, None, &b, 0.5),
            Some(ONLINE_INTERVAL)
        );
        let probes: Vec<u64> = (0..7)
            .map(|n| {
                next_delay(&SyncState::Offline, 0, n, None, &b, 0.5).map_or(0, |d| d.as_secs())
            })
            .collect();
        assert_eq!(probes, [1, 2, 4, 8, 16, 30, 30]);
        assert_eq!(
            next_delay(&SyncState::AuthRequired, 3, 0, None, &b, 0.5),
            None
        );
        let failed = SyncState::Failed("SERVER_ERROR");
        assert_eq!(
            next_delay(&failed, 3, 0, None, &b, 0.5),
            Some(Duration::from_secs(4))
        );
        assert_eq!(
            next_delay(&failed, 3, 0, None, &b, 1.0),
            Some(Duration::from_millis(4800))
        );
        assert_eq!(
            next_delay(&failed, 20, 0, None, &b, 0.5),
            Some(Duration::from_secs(300))
        );
        assert_eq!(
            next_delay(&failed, 1, 0, Some(Duration::from_secs(60)), &b, 0.5),
            Some(Duration::from_secs(60))
        );
        assert_eq!(
            next_delay(&failed, 1, 0, Some(Duration::from_secs(36_000)), &b, 0.5),
            Some(RETRY_AFTER_MAX)
        );
        let unit = jitter_unit();
        assert!((0.0..=1.0).contains(&unit));
    }
}
