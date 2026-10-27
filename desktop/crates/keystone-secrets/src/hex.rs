use zeroize::Zeroizing;

const DIGITS: &[u8; 16] = b"0123456789abcdef";

/// Lowercase hex of 32 bytes, built in place (no reallocation leaves an
/// unwiped copy behind).
pub(crate) fn encode(bytes: &[u8; 32]) -> Zeroizing<String> {
    let mut text = Zeroizing::new(String::with_capacity(64));
    for b in bytes {
        text.push(char::from(DIGITS[usize::from(b >> 4)]));
        text.push(char::from(DIGITS[usize::from(b & 0x0f)]));
    }
    text
}

/// Exactly 64 lowercase hex digits back to 32 bytes.
pub(crate) fn decode(text: &[u8]) -> Option<Zeroizing<[u8; 32]>> {
    fn digit(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            _ => None,
        }
    }
    if text.len() != 64 {
        return None;
    }
    let mut out = Zeroizing::new([0u8; 32]);
    for (slot, [hi, lo]) in out.iter_mut().zip(text.as_chunks::<2>().0) {
        *slot = (digit(*hi)? << 4) | digit(*lo)?;
    }
    Some(out)
}

/// 32 bytes from the OS CSPRNG.
pub(crate) fn random() -> Result<Zeroizing<[u8; 32]>, crate::Error> {
    let mut bytes = Zeroizing::new([0u8; 32]);
    getrandom::fill(bytes.as_mut()).map_err(|e| crate::Error::Random(e.to_string()))?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_rejects_anything_else() {
        let bytes: [u8; 32] = std::array::from_fn(|i| (i * 37) as u8);
        let text = encode(&bytes);
        assert_eq!(text.len(), 64);
        assert_eq!(&text[..6], "00254a");
        assert_eq!(*decode(text.as_bytes()).unwrap(), bytes);
        assert!(decode(&text.as_bytes()[..62]).is_none());
        assert!(decode(text.to_uppercase().as_bytes()).is_none());
        assert!(decode(&[b'g'; 64]).is_none());
    }

    #[test]
    fn random_bytes_differ() {
        assert_ne!(*random().unwrap(), *random().unwrap());
    }
}
