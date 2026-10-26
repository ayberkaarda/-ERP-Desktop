//! Serde helpers for shapes the schemas use but serde does not cover directly.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// For a property that is optional *and* nullable: `None` = absent,
/// `Some(None)` = explicit `null`, `Some(Some(v))` = value.
///
/// Use with
/// `#[serde(default, skip_serializing_if = "Option::is_none", with = "crate::wire::serde_util::double_option")]`.
pub mod double_option {
    use super::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<T: Serialize, S: Serializer>(
        value: &Option<Option<T>>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        match value {
            Some(inner) => inner.serialize(serializer),
            None => serializer.serialize_none(),
        }
    }

    pub fn deserialize<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Option<T>>, D::Error> {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}

/// Serializes a `u64` as a decimal string and accepts only canonical decimal
/// strings (no sign, no leading zeros), as the `xid8` pattern requires.
pub(crate) fn decimal_u64<S: Serializer>(value: &u64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_str(value)
}

pub(crate) fn parse_decimal_u64<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<u64, D::Error> {
    let text = String::deserialize(deserializer)?;
    let canonical = !text.is_empty()
        && text.bytes().all(|b| b.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'));
    if !canonical {
        return Err(serde::de::Error::custom(format!(
            "expected a canonical decimal xid8 string, got {text:?}"
        )));
    }
    text.parse().map_err(serde::de::Error::custom)
}
