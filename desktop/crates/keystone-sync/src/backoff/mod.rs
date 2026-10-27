//! Retry timing for the sync loop (desktop/PLAN.md B5).

use std::time::Duration;

/// Sync interval while online.
pub const ONLINE_INTERVAL: Duration = Duration::from_secs(60);

/// Longest `Retry-After` honoured; a larger value waits this long.
pub const RETRY_AFTER_MAX: Duration = Duration::from_secs(3600);

/// Server probe delays while offline; the last one repeats.
pub const OFFLINE_PROBE_SECS: [u64; 6] = [1, 2, 4, 8, 16, 30];

/// Exponential backoff after failed sync runs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Backoff {
    pub initial: Duration,
    pub max: Duration,
    /// Relative spread around the nominal delay, e.g. 0.2 for ±20%.
    pub jitter: f64,
}

impl Default for Backoff {
    fn default() -> Self {
        Self {
            initial: Duration::from_secs(1),
            max: Duration::from_secs(300),
            jitter: 0.2,
        }
    }
}

impl Backoff {
    /// Nominal delay after `failures` consecutive failures (1 = first),
    /// doubling from `initial` and capped at `max`.
    pub fn nominal(&self, failures: u32) -> Duration {
        let doublings = failures.saturating_sub(1).min(31);
        self.initial
            .checked_mul(1 << doublings)
            .map_or(self.max, |d| d.min(self.max))
    }

    /// Nominal delay with jitter. `unit` is a uniform sample in `[0, 1]`
    /// supplied by the caller, which keeps this function deterministic.
    pub fn delay(&self, failures: u32, unit: f64) -> Duration {
        let unit = if unit.is_finite() {
            unit.clamp(0.0, 1.0)
        } else {
            0.5
        };
        let factor = 1.0 + self.jitter * (2.0 * unit - 1.0);
        self.nominal(failures).mul_f64(factor.max(0.0))
    }
}

/// Delay before offline probe number `attempt` (0-based).
pub fn offline_probe_delay(attempt: usize) -> Duration {
    let last = OFFLINE_PROBE_SECS.len() - 1;
    Duration::from_secs(OFFLINE_PROBE_SECS[attempt.min(last)])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_from_one_second_to_the_cap() {
        let b = Backoff::default();
        let secs: Vec<u64> = (1..=11).map(|n| b.nominal(n).as_secs()).collect();
        assert_eq!(secs, [1, 2, 4, 8, 16, 32, 64, 128, 256, 300, 300]);
        assert_eq!(b.nominal(0), Duration::from_secs(1));
        assert_eq!(b.nominal(u32::MAX), Duration::from_secs(300));
    }

    #[test]
    fn jitter_stays_within_twenty_percent() {
        let b = Backoff::default();
        assert_eq!(b.delay(3, 0.0), Duration::from_millis(3200));
        assert_eq!(b.delay(3, 0.5), Duration::from_secs(4));
        assert_eq!(b.delay(3, 1.0), Duration::from_millis(4800));
        assert_eq!(b.delay(3, f64::NAN), Duration::from_secs(4));
    }

    #[test]
    fn offline_probe_repeats_the_last_step() {
        let secs: Vec<u64> = (0..8).map(|n| offline_probe_delay(n).as_secs()).collect();
        assert_eq!(secs, [1, 2, 4, 8, 16, 30, 30, 30]);
    }
}
