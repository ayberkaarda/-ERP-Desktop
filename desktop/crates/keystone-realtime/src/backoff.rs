//! Reconnect timing: 1 s doubling to 60 s, ±20% jitter (same shape as the
//! sync loop backoff in keystone-sync).

use std::hash::{BuildHasher, RandomState};
use std::time::Duration;

/// Exponential backoff between reconnect attempts.
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
            max: Duration::from_secs(60),
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

/// Uniform sample in `[0, 1]` from the randomly keyed std hasher (no RNG
/// dependency; jitter needs spread, not cryptographic quality).
pub(crate) fn jitter_unit() -> f64 {
    let bits = RandomState::new().hash_one(std::time::Instant::now()) >> 11;
    bits as f64 / (1u64 << 53) as f64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn doubles_from_one_second_to_sixty() {
        let b = Backoff::default();
        let secs: Vec<u64> = (1..=8).map(|n| b.nominal(n).as_secs()).collect();
        assert_eq!(secs, [1, 2, 4, 8, 16, 32, 60, 60]);
        assert_eq!(b.nominal(0), Duration::from_secs(1));
        assert_eq!(b.nominal(u32::MAX), Duration::from_secs(60));
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
    fn jitter_unit_is_in_range_and_varies() {
        let samples: Vec<f64> = (0..64).map(|_| jitter_unit()).collect();
        assert!(samples.iter().all(|u| (0.0..=1.0).contains(u)));
        assert!(samples.windows(2).any(|w| w[0] != w[1]));
    }
}
