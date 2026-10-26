//! `Retry-After`: delay-seconds or an IMF-fixdate (RFC 9110 10.2.3).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Delay until the client may retry, relative to `now`. A date in the past
/// gives zero; anything unparsable gives `None`.
pub fn parse_retry_after(value: &str, now: SystemTime) -> Option<Duration> {
    let value = value.trim();
    if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) {
        return value.parse::<u64>().ok().map(Duration::from_secs);
    }
    let at = parse_imf_fixdate(value)?;
    let now = now.duration_since(UNIX_EPOCH).ok()?.as_secs();
    Some(Duration::from_secs(at.saturating_sub(now)))
}

/// `Sun, 06 Nov 1994 08:49:37 GMT` to Unix seconds.
fn parse_imf_fixdate(value: &str) -> Option<u64> {
    let mut parts = value.split_ascii_whitespace();
    let weekday = parts.next()?;
    if weekday.len() != 4 || !weekday.ends_with(',') {
        return None;
    }
    let day: u64 = parts.next().filter(|d| d.len() == 2)?.parse().ok()?;
    let month = match parts.next()? {
        "Jan" => 1,
        "Feb" => 2,
        "Mar" => 3,
        "Apr" => 4,
        "May" => 5,
        "Jun" => 6,
        "Jul" => 7,
        "Aug" => 8,
        "Sep" => 9,
        "Oct" => 10,
        "Nov" => 11,
        "Dec" => 12,
        _ => return None,
    };
    let year: u64 = parts.next().filter(|y| y.len() == 4)?.parse().ok()?;
    let mut clock = parts.next()?.split(':');
    let mut field = |max: u64| -> Option<u64> {
        clock
            .next()
            .filter(|v| v.len() == 2)?
            .parse()
            .ok()
            .filter(|v| *v <= max)
    };
    let (hour, minute, second) = (field(23)?, field(59)?, field(60)?);
    if clock.next().is_some() || parts.next()? != "GMT" || parts.next().is_some() {
        return None;
    }
    if year < 1970 || !(1..=31).contains(&day) {
        return None;
    }
    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
}

/// Days since 1970-01-01 (Howard Hinnant's algorithm), for years >= 1970.
fn days_from_civil(year: u64, month: u64, day: u64) -> u64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year / 400;
    let year_of_era = year - era * 400;
    let month_index = (month + 9) % 12;
    let day_of_year = (153 * month_index + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seconds_and_dates() {
        let now = UNIX_EPOCH + Duration::from_secs(784_111_777); // Sun, 06 Nov 1994 08:49:37 GMT
        assert_eq!(
            parse_retry_after("120", now),
            Some(Duration::from_secs(120))
        );
        assert_eq!(
            parse_retry_after("Sun, 06 Nov 1994 08:50:37 GMT", now),
            Some(Duration::from_secs(60))
        );
        assert_eq!(
            parse_retry_after("Sun, 06 Nov 1994 08:00:00 GMT", now),
            Some(Duration::ZERO)
        );
        assert_eq!(
            parse_retry_after("Thu, 01 Jan 1970 00:00:00 GMT", UNIX_EPOCH),
            Some(Duration::ZERO)
        );
        assert_eq!(
            parse_retry_after("Mon, 26 Oct 2026 10:00:00 GMT", UNIX_EPOCH),
            Some(Duration::from_secs(1_793_008_800))
        );
        for bad in ["", "-1", "1.5", "soon", "Sun, 06 Nov 1994 08:49:37 UTC"] {
            assert_eq!(parse_retry_after(bad, now), None, "{bad}");
        }
    }
}
