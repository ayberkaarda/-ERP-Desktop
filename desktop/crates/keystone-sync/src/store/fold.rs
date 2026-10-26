//! Turkish-aware text folding for FTS5.
//!
//! The FTS5 tokenizer is `unicode61 remove_diacritics 2`: it lower-cases and
//! strips ş/ğ/ç/ö/ü marks, but leaves dotless `ı` alone and has no Turkish
//! casing. So both the indexed text and every query go through [`fold`]
//! first: `İ`, `I`, `ı` all become `i`, then the rest is lower-cased. With
//! that, "İSTANBUL", "Istanbul", "istanbul" and "ıstanbul" are one token.

/// Folds `text` for indexing or matching.
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            'İ' | 'I' | 'ı' => out.push('i'),
            // `i̇` (i + combining dot above), what plain lower-casing makes of İ.
            '\u{0307}' => {}
            other => out.extend(other.to_lowercase()),
        }
    }
    out
}

/// FTS5 MATCH expression: every word of the folded input as a quoted prefix
/// term, all required. `None` when the input has no word characters.
pub fn match_expression(input: &str) -> Option<String> {
    let folded = fold(input);
    let terms: Vec<String> = folded
        .split(|c: char| !c.is_alphanumeric())
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
