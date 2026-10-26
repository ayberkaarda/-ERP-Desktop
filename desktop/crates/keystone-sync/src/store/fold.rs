//! Turkish-aware text folding for FTS5.
//!
//! The FTS5 tokenizer is `unicode61 remove_diacritics 2`. It lower-cases,
//! keeps a combining mark inside its token and removes diacritics the way
//! SQLite defines (precomposed Latin letters lose theirs: ş/ğ/ç/ö/ü → s/g/c/o/u;
//! Greek `ά` keeps its tonos). It has no Turkish casing and leaves dotless `ı`
//! alone. Index text and queries both go through the same [`fold`], which adds
//! only the Turkish rule: `İ`, `I`, `ı` become `i`, the rest is lower-cased.
//! No general Unicode normalization (out of scope).
//!
//! With that, "İSTANBUL", "Istanbul", "istanbul" and "ıstanbul" are one
//! token. Query words are split where the tokenizer splits: a combining mark
//! stays in its word (`s\u{0327}eker` is one term, as in the index).

/// Folds `text` for indexing or matching.
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            'İ' | 'I' | 'ı' => out.push('i'),
            other => out.extend(other.to_lowercase()),
        }
    }
    out
}

/// Combining Diacritical Marks: part of a token for unicode61.
/// Known limitation: rare marks unicode61 splits on (e.g. U+034F) stay in the word.
fn is_combining_mark(c: char) -> bool {
    matches!(c, '\u{0300}'..='\u{036F}')
}

/// Token character of the default `unicode61` categories (`L* N* Co`).
fn is_token_char(c: char) -> bool {
    c.is_alphanumeric()
        || is_combining_mark(c)
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
        for s in ["İSTANBUL", "Istanbul", "istanbul", "ıstanbul"] {
            assert_eq!(fold(s), "istanbul", "{s}");
        }
        assert_eq!(fold("ŞİŞLİ Çağ"), "şişli çağ");
    }

    #[test]
    fn leaves_other_scripts_and_marks_to_the_tokenizer() {
        assert_eq!(fold("α\u{0301}"), "α\u{0301}");
        assert_eq!(fold("Ά"), "ά");
        assert_eq!(fold("É"), "é");
        assert_eq!(fold("s\u{0327}eker"), "s\u{0327}eker");
    }

    #[test]
    fn builds_quoted_prefix_terms() {
        assert_eq!(
            match_expression("Ist \"anb\" OR*").as_deref(),
            Some("\"ist\"* \"anb\"* \"or\"*")
        );
        assert_eq!(match_expression(" -- "), None);
        // A combining mark stays inside its word, as unicode61 does.
        assert_eq!(
            match_expression("S\u{0327}EKER ψα\u{0301}ρι").as_deref(),
            Some("\"s\u{0327}eker\"* \"ψα\u{0301}ρι\"*")
        );
    }
}
