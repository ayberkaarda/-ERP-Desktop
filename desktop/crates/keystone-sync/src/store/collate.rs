//! Sort keys and text folding of the `query` sections: values become byte
//! strings that compare (`memcmp`, SQLite `BLOB` order) the way the server's
//! PostgreSQL orders them.
//!
//! - [`collation_key`]: text in the server collation (`en_US.utf8`, glibc).
//!   Four levels, each compared only when the ones before are equal:
//!   1. letters and digits without accent or case, punctuation and spaces
//!      ignored (`ç`~`c`, `ğ`~`g`, `İ`/`I`~`i`, `ö`~`o`, `ş`~`s`, `ü`~`u`;
//!      dotless `ı` is its own letter between `i` and `j`; digits before
//!      letters);
//!   2. accents, letter by letter (none first);
//!   3. case, letter by letter (lower first);
//!   4. punctuation and spaces by position and code point.
//!
//!   Probed against PostgreSQL 18 (`ORDER BY` on `en_US.utf8`):
//!   `a.b < ab < aB < Ab < A&B < AB < AB.`, `ca < Ca < ça < Ça`,
//!   `i < I < İ < ij < ı < j`, `é < è < ê < ë`, `wh-1 < WH-1 < WH1 < WH-10`.
//!   Letters outside Latin compare by their lower-case code point.
//! - [`decimal_key`]: exact order of decimal strings of any size (no
//!   floating point).
//! - [`datetime_key`]: ISO 8601 instants in UTC.
//! - [`plain`]: lower-case without accents for substring matching.

use super::fold::fold;

/// Accent of a precomposed lower-case Latin letter: `(base, accent)`;
/// `accent` 0 is none. Weights follow the glibc order of the marks.
fn decompose(c: char) -> (char, u8) {
    const ACUTE: u8 = 1;
    const GRAVE: u8 = 2;
    const BREVE: u8 = 3;
    const CIRCUMFLEX: u8 = 4;
    const CARON: u8 = 5;
    const RING: u8 = 6;
    const DIAERESIS: u8 = 7;
    const DOUBLE_ACUTE: u8 = 8;
    const TILDE: u8 = 9;
    const DOT: u8 = 10;
    const CEDILLA: u8 = 11;
    const OGONEK: u8 = 12;
    const MACRON: u8 = 13;
    const STROKE: u8 = 14;
    match c {
        'á' => ('a', ACUTE),
        'à' => ('a', GRAVE),
        'ă' => ('a', BREVE),
        'â' => ('a', CIRCUMFLEX),
        'å' => ('a', RING),
        'ä' => ('a', DIAERESIS),
        'ã' => ('a', TILDE),
        'ą' => ('a', OGONEK),
        'ā' => ('a', MACRON),
        'ć' => ('c', ACUTE),
        'ĉ' => ('c', CIRCUMFLEX),
        'č' => ('c', CARON),
        'ċ' => ('c', DOT),
        'ç' => ('c', CEDILLA),
        'ď' => ('d', CARON),
        'đ' => ('d', STROKE),
        'é' => ('e', ACUTE),
        'è' => ('e', GRAVE),
        'ĕ' => ('e', BREVE),
        'ê' => ('e', CIRCUMFLEX),
        'ě' => ('e', CARON),
        'ë' => ('e', DIAERESIS),
        'ė' => ('e', DOT),
        'ę' => ('e', OGONEK),
        'ē' => ('e', MACRON),
        'ğ' => ('g', BREVE),
        'ĝ' => ('g', CIRCUMFLEX),
        'ġ' => ('g', DOT),
        'ģ' => ('g', CEDILLA),
        'ĥ' => ('h', CIRCUMFLEX),
        'ħ' => ('h', STROKE),
        'í' => ('i', ACUTE),
        'ì' => ('i', GRAVE),
        'ĭ' => ('i', BREVE),
        'î' => ('i', CIRCUMFLEX),
        'ï' => ('i', DIAERESIS),
        'ĩ' => ('i', TILDE),
        'į' => ('i', OGONEK),
        'ī' => ('i', MACRON),
        'ĵ' => ('j', CIRCUMFLEX),
        'ķ' => ('k', CEDILLA),
        'ĺ' => ('l', ACUTE),
        'ľ' => ('l', CARON),
        'ļ' => ('l', CEDILLA),
        'ł' => ('l', STROKE),
        'ń' => ('n', ACUTE),
        'ň' => ('n', CARON),
        'ñ' => ('n', TILDE),
        'ņ' => ('n', CEDILLA),
        'ó' => ('o', ACUTE),
        'ò' => ('o', GRAVE),
        'ŏ' => ('o', BREVE),
        'ô' => ('o', CIRCUMFLEX),
        'ö' => ('o', DIAERESIS),
        'ő' => ('o', DOUBLE_ACUTE),
        'õ' => ('o', TILDE),
        'ō' => ('o', MACRON),
        'ø' => ('o', STROKE),
        'ŕ' => ('r', ACUTE),
        'ř' => ('r', CARON),
        'ŗ' => ('r', CEDILLA),
        'ś' => ('s', ACUTE),
        'ŝ' => ('s', CIRCUMFLEX),
        'š' => ('s', CARON),
        'ş' => ('s', CEDILLA),
        'ť' => ('t', CARON),
        'ţ' => ('t', CEDILLA),
        'ú' => ('u', ACUTE),
        'ù' => ('u', GRAVE),
        'ŭ' => ('u', BREVE),
        'û' => ('u', CIRCUMFLEX),
        'ů' => ('u', RING),
        'ü' => ('u', DIAERESIS),
        'ű' => ('u', DOUBLE_ACUTE),
        'ũ' => ('u', TILDE),
        'ų' => ('u', OGONEK),
        'ū' => ('u', MACRON),
        'ŵ' => ('w', CIRCUMFLEX),
        'ý' => ('y', ACUTE),
        'ŷ' => ('y', CIRCUMFLEX),
        'ÿ' => ('y', DIAERESIS),
        'ź' => ('z', ACUTE),
        'ž' => ('z', CARON),
        'ż' => ('z', DOT),
        other => (other, 0),
    }
}

/// Weight of a combining mark (U+0300 block) on the letter before it.
fn mark_weight(c: char) -> Option<u8> {
    Some(match c {
        '\u{0301}' => 1,
        '\u{0300}' => 2,
        '\u{0306}' => 3,
        '\u{0302}' => 4,
        '\u{030C}' => 5,
        '\u{030A}' => 6,
        '\u{0308}' => 7,
        '\u{030B}' => 8,
        '\u{0303}' => 9,
        '\u{0307}' => 10,
        '\u{0327}' => 11,
        '\u{0328}' => 12,
        '\u{0304}' => 13,
        '\u{0300}'..='\u{036F}' => 20,
        _ => return None,
    })
}

/// One letter or digit: primary weight, accent, upper case.
struct Element {
    primary: u32,
    accent: u8,
    upper: bool,
}

fn element(c: char) -> Element {
    let upper = c.is_uppercase();
    let (base, accent, dotless) = match c {
        'İ' => ('i', 10, false),
        'I' | 'i' => ('i', 0, false),
        'ı' => ('i', 0, true),
        _ => {
            let lower = c.to_lowercase().next().unwrap_or(c);
            let (base, accent) = decompose(lower);
            (base, accent, false)
        }
    };
    Element {
        primary: 2 * u32::from(base) + u32::from(dotless),
        accent,
        upper,
    }
}

/// Sort key of `text` in the server collation (see the module notes).
pub fn collation_key(text: &str) -> Vec<u8> {
    let mut elements: Vec<Element> = Vec::new();
    let mut punctuation: Vec<u32> = Vec::new();
    for c in text.chars() {
        if let Some(weight) = mark_weight(c) {
            if let Some(last) = elements.last_mut() {
                last.accent = last.accent.max(weight);
            }
            continue;
        }
        if c.is_alphanumeric() {
            elements.push(element(c));
            punctuation.push(u32::MAX);
        } else {
            punctuation.push(u32::from(c) + 1);
        }
    }
    let mut key = Vec::with_capacity(elements.len() * 6 + punctuation.len() * 4 + 12);
    for e in &elements {
        key.extend_from_slice(&e.primary.to_be_bytes());
    }
    key.extend_from_slice(&[0; 4]);
    key.extend(elements.iter().map(|e| e.accent + 1));
    key.push(0);
    key.extend(elements.iter().map(|e| if e.upper { 2 } else { 1 }));
    key.push(0);
    for p in punctuation {
        key.extend_from_slice(&p.to_be_bytes());
    }
    key.extend_from_slice(&[0; 4]);
    key
}

/// Lower case without accents, Turkish `İ`/`I`/`ı` as `i`: both sides of a
/// substring match go through it, so it finds at least what a
/// case-insensitive server match finds.
pub fn plain(text: &str) -> String {
    fold(text)
        .chars()
        .filter(|c| mark_weight(*c).is_none())
        .map(|c| decompose(c).0)
        .collect()
}

/// Sort key of a decimal (`-12.50`, `0.5`, `+3`): exact for any number of
/// digits. `None` when `text` is not a plain decimal.
pub fn decimal_key(text: &str) -> Option<Vec<u8>> {
    let (negative, digits) = match text.as_bytes().first()? {
        b'-' => (true, &text[1..]),
        b'+' => (false, &text[1..]),
        _ => (false, text),
    };
    let (int, frac) = digits.split_once('.').unwrap_or((digits, ""));
    let all_digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    if (int.is_empty() && frac.is_empty()) || !all_digits(int) || !all_digits(frac) {
        return None;
    }
    let int = int.trim_start_matches('0');
    let frac = frac.trim_end_matches('0');
    if int.is_empty() && frac.is_empty() {
        return Some(vec![2]);
    }
    let length = u32::try_from(int.len()).ok()?;
    let digits = int.bytes().chain(frac.bytes()).map(|b| b - b'0');
    let mut key = Vec::with_capacity(6 + int.len() + frac.len());
    if negative {
        key.push(1);
        key.extend_from_slice(&(u32::MAX - length).to_be_bytes());
        key.extend(digits.map(|d| 9 - d));
        key.push(0xFF);
    } else {
        key.push(3);
        key.extend_from_slice(&length.to_be_bytes());
        key.extend(digits);
    }
    Some(key)
}

/// Sort key of an ISO 8601 date-time (`2026-10-27T10:00:00.123456+03:00`,
/// `Z`, `+0300`, `+03`, or none for UTC; a bare date is midnight UTC):
/// microseconds since the epoch in UTC. `None` when it does not parse.
pub fn datetime_key(text: &str) -> Option<Vec<u8>> {
    let micros = parse_datetime(text)?;
    Some(((micros as u64) ^ (1 << 63)).to_be_bytes().to_vec())
}

fn number(text: &str, from: usize, len: usize) -> Option<i64> {
    let part = text.get(from..from + len)?;
    if part.bytes().all(|b| b.is_ascii_digit()) {
        part.parse().ok()
    } else {
        None
    }
}

/// `true` for `YYYY-MM-DD` with a month 1..=12 and a day 1..=31.
pub fn is_date(text: &str) -> bool {
    text.len() == 10 && date_parts(text).is_some()
}

fn date_parts(text: &str) -> Option<(i64, i64, i64)> {
    let bytes = text.as_bytes();
    if bytes.get(4) != Some(&b'-') || bytes.get(7) != Some(&b'-') {
        return None;
    }
    let (y, m, d) = (
        number(text, 0, 4)?,
        number(text, 5, 2)?,
        number(text, 8, 2)?,
    );
    ((1..=12).contains(&m) && (1..=31).contains(&d)).then_some((y, m, d))
}

/// Days since 1970-01-01 of a proleptic Gregorian date.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn parse_datetime(text: &str) -> Option<i64> {
    let (y, m, d) = date_parts(text)?;
    let mut seconds = days_from_civil(y, m, d) * 86_400;
    let mut micros = 0;
    let rest = &text[10..];
    if rest.is_empty() {
        return Some(seconds * 1_000_000);
    }
    let rest = rest.strip_prefix(['T', 't', ' '])?;
    let (h, mi) = (number(rest, 0, 2)?, number(rest, 3, 2)?);
    if rest.as_bytes().get(2) != Some(&b':') || h > 23 || mi > 59 {
        return None;
    }
    seconds += h * 3600 + mi * 60;
    let mut rest = &rest[5..];
    if let Some(after) = rest.strip_prefix(':') {
        let s = number(after, 0, 2)?;
        if s > 60 {
            return None;
        }
        seconds += s;
        rest = &after[2..];
        if let Some(after) = rest.strip_prefix('.') {
            let digits = after.bytes().take_while(u8::is_ascii_digit).count();
            if digits == 0 {
                return None;
            }
            let mut frac: String = after[..digits].chars().take(6).collect();
            while frac.len() < 6 {
                frac.push('0');
            }
            micros = frac.parse().ok()?;
            rest = &after[digits..];
        }
    }
    let offset = match rest {
        "" | "Z" | "z" => 0,
        _ => {
            let sign = match rest.as_bytes()[0] {
                b'+' => 1,
                b'-' => -1,
                _ => return None,
            };
            let zone = &rest[1..];
            let (oh, om) = match zone.len() {
                2 => (number(zone, 0, 2)?, 0),
                4 => (number(zone, 0, 2)?, number(zone, 2, 2)?),
                5 if zone.as_bytes()[2] == b':' => (number(zone, 0, 2)?, number(zone, 3, 2)?),
                _ => return None,
            };
            sign * (oh * 3600 + om * 60)
        }
    };
    Some((seconds - offset) * 1_000_000 + micros)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted(values: &[&str], key: impl Fn(&str) -> Vec<u8>) -> Vec<String> {
        let mut out: Vec<&str> = values.to_vec();
        out.sort_by_key(|v| key(v));
        out.into_iter().map(str::to_owned).collect()
    }

    /// Orders read from PostgreSQL 18, `en_US.utf8` (`ORDER BY v`).
    #[test]
    fn text_follows_the_server_collation() {
        let server = [
            "10",
            "9",
            "a",
            "A",
            "A-01",
            "a b",
            "a-b",
            "a_b",
            "ab",
            "b",
            "B",
            "B-01",
            "ca",
            "Ca",
            "ça",
            "Ça",
            "cag",
            "Çağ",
            "Cam",
            "e",
            "E",
            "é",
            "f",
            "g",
            "Ğ",
            "ğa",
            "gz",
            "ilik",
            "Işık",
            "Istanbul",
            "İstanbul",
            "ılık",
            "Ömer",
            "Oya",
            "ozan",
            "P000007",
            "P-BRAVO",
            "P-CHARLIE",
            "Sabun",
            "şeker",
            "Ural",
            "Üzüm",
            "uzun",
            "Zeytin",
        ];
        let mut shuffled = server.to_vec();
        shuffled.reverse();
        assert_eq!(sorted(&shuffled, collation_key), server);

        let server = [
            "a.b", "ab", "aB", "Ab", "A&B", "A(B", "A+B", "A.B", "A/B", "AB", "AB.", "ç", "d", "é",
            "è", "ê", "ë", "ée", "ef", "i", "I", "İ", "ia", "Ia", "İa", "ij", "ı", "ıa", "j", "ja",
            "Net 15", "Net15", "Net 30", "ö", "p", "ş", "t", "ü", "v", "wh-1", "WH-1", "WH1",
            "WH-10", "WH-2", "x 1", "x-1", "x1",
        ];
        let mut shuffled = server.to_vec();
        shuffled.reverse();
        assert_eq!(sorted(&shuffled, collation_key), server);

        let server = [
            "Acme",
            "ACME A.Ş.",
            "Acme Ltd",
            "alpha",
            "Alpha",
            "ALPHA",
            "Alpha 2",
            "Alpha2",
            "Alpha Ltd",
            "Alpha-Ltd",
            "AlphaLtd",
            "Bayi",
            "Bravo Tedarik",
            "Cevrimdisi",
            "Çevrimdışı Cari A.Ş.",
            "Charlie Ortak",
        ];
        let mut shuffled = server.to_vec();
        shuffled.reverse();
        assert_eq!(sorted(&shuffled, collation_key), server);
    }

    #[test]
    fn a_combining_mark_is_the_accent_of_its_letter() {
        assert_eq!(collation_key("s\u{0327}eker"), collation_key("şeker"));
        assert_eq!(collation_key("C\u{0327}a"), collation_key("Ça"));
        // A mark outside the named ones (dot below) is an accent too:
        // PostgreSQL gives `a-b < ab < aB < Ab < áb < ạb`.
        let dot_below = collation_key("a\u{0323}b");
        for before in ["a-b", "ab", "aB", "Ab", "áb"] {
            assert!(collation_key(before) < dot_below, "{before}");
        }
    }

    #[test]
    fn decimals_order_exactly_at_any_size() {
        let ordered = [
            "-100000000000000000000.01",
            "-100000000000000000000",
            "-10",
            "-9.99",
            "-9.9",
            "-6",
            "-5.5",
            "-5",
            "-0.5",
            "0",
            "0.05",
            "0.5",
            "0.51",
            "5",
            "5.01",
            "9.50",
            "10",
            "96.00",
            "240.00",
            "288.00",
            "9007199254740993",
            "9007199254740993.01",
            "100000000000000000000",
        ];
        let mut shuffled = ordered.to_vec();
        shuffled.reverse();
        assert_eq!(
            sorted(&shuffled, |v| decimal_key(v).unwrap()),
            ordered.map(str::to_owned)
        );
        assert_eq!(decimal_key("5.0"), decimal_key("5"));
        assert_eq!(decimal_key("+5"), decimal_key("005.000"));
        assert_eq!(decimal_key("-0.00"), decimal_key("0"));
        for bad in ["", "-", ".", "1e5", "1.2.3", "a", "1,5", " 1"] {
            assert_eq!(decimal_key(bad), None, "{bad}");
        }
    }

    #[test]
    fn datetimes_compare_as_instants() {
        let a = datetime_key("2026-10-27T10:00:00+03:00").unwrap();
        let b = datetime_key("2026-10-27T07:00:00Z").unwrap();
        let c = datetime_key("2026-10-27T07:00:00.000001Z").unwrap();
        let d = datetime_key("2026-10-27T08:30:00+0200").unwrap();
        assert_eq!(a, b);
        assert!(b < c);
        assert!(d < c);
        assert!(datetime_key("1969-12-31T23:59:59Z") < datetime_key("1970-01-01"));
        assert_eq!(
            datetime_key("2026-10-27"),
            datetime_key("2026-10-27T00:00:00Z")
        );
        assert!(datetime_key("2026-10-27 09:00:00+03") < datetime_key("2026-10-27T06:30:00Z"));
        // Offsets with minutes, and seconds, count.
        let utc = datetime_key("2026-10-27T07:00:00Z");
        for same in [
            "2026-10-27T12:30:00+05:30",
            "2026-10-27T12:30:00+0530",
            "2026-10-27T06:30:00-00:30",
        ] {
            assert_eq!(datetime_key(same), utc, "{same}");
        }
        assert!(datetime_key("2026-10-27T07:00:00.999999Z") < datetime_key("2026-10-27T07:00:01Z"));
        assert!(datetime_key("2026-10-27T07:00:59Z") > datetime_key("2026-10-27T07:00:01Z"));
        for bad in [
            "",
            "2026-13-01",
            "2026-10-27T25:00",
            "x",
            "2026-10-27T10:00+3",
        ] {
            assert_eq!(datetime_key(bad), None, "{bad}");
        }
    }

    #[test]
    fn plain_text_drops_case_and_accents() {
        assert_eq!(plain("İSTANBUL Şişli Çağ"), "istanbul sisli cag");
        assert_eq!(plain("ılık ÖZÜ"), "ilik ozu");
        assert_eq!(plain("s\u{0327}eker"), "seker");
        assert!(is_date("2026-10-01"));
        for bad in [
            "#invalid-date",
            "2026-1-01",
            "2026-10-01T00:00",
            "2026-00-10",
            "",
        ] {
            assert!(!is_date(bad), "{bad}");
        }
    }
}
