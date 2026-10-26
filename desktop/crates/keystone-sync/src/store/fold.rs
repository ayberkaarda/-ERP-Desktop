//! Turkish-aware text folding for FTS5.
//!
//! The FTS5 tokenizer is `unicode61 remove_diacritics 2`: it lower-cases and
//! strips the marks of precomposed letters (ş/ğ/ç/ö/ü), but leaves dotless
//! `ı` alone, has no Turkish casing, and treats a separate combining mark
//! (`s` + U+0327) as a separator. So both the indexed text and every query
//! go through [`fold`] first:
//! - combining marks are dropped, so decomposed text (NFD) folds like the
//!   precomposed form after diacritic removal (`s\u{0327}eker` = `şeker` =
//!   `seker`) without a normalization table;
//! - `İ`, `I`, `ı` become `i`, the rest is lower-cased.
//!
//! With that, "İSTANBUL", "Istanbul", "istanbul" and "ıstanbul" are one
//! token. Query words are split where the tokenizer splits (anything that
//! is not a letter, number or private-use character).

/// Folds `text` for indexing or matching.
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            'İ' | 'I' | 'ı' => out.push('i'),
            c if is_combining_mark(c) => {}
            other => out.extend(other.to_lowercase()),
        }
    }
    out
}

/// Combining diacritical mark blocks.
fn is_combining_mark(c: char) -> bool {
    matches!(
        c,
        '\u{0300}'..='\u{036F}'
            | '\u{1AB0}'..='\u{1AFF}'
            | '\u{1DC0}'..='\u{1DFF}'
            | '\u{20D0}'..='\u{20FF}'
            | '\u{FE20}'..='\u{FE2F}'
    )
}

/// Token character of the default `unicode61` categories (`L* N* Co`).
fn is_token_char(c: char) -> bool {
    c.is_alphanumeric()
        || matches!(
            c,
            '\u{E000}'..='\u{F8FF}' | '\u{F0000}'..='\u{FFFFD}' | '\u{100000}'..='\u{10FFFD}'
        )
}

/// FTS5 MATCH expression: every word of the folded input as a quoted prefix
/// term, all required. `None` when the input has no word characters.
pub fn match_expression(input: &str) -> Option<String> {
    let folded = fold(input);
    let terms: Vec<String> = folded
        .split(|c: char| !is_token_char(c))
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{t}\"*"))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_turkish_i_forms_together() {
        for s in [
            "İSTANBUL",
            "Istanbul",
            "istanbul",
            "ıstanbul",
            "i\u{0307}stanbul",
        ] {
            assert_eq!(fold(s), "istanbul", "{s}");
        }
        assert_eq!(fold("ŞİŞLİ Çağ"), "şişli çağ");
    }

    #[test]
    fn builds_quoted_prefix_terms() {
        assert_eq!(
            match_expression("Ist \"anb\" OR*").as_deref(),
            Some("\"ist\"* \"anb\"* \"or\"*")
        );
        assert_eq!(match_expression(" -- "), None);
    }
}
