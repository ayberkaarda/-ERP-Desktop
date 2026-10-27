//! `DbKeyStore` and `SecretSlot` over the `keyring-core` mock store.

mod common;

use std::sync::Barrier;

use common::Fixture;
use keystone_secrets::{DbKeyStore, Error, SecretSlot};

fn is_hex64(bytes: &[u8]) -> bool {
    bytes.len() == 64
        && bytes
            .iter()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
}

#[test]
fn db_key_is_created_once_in_its_own_entry() {
    let fx = Fixture::new();
    let keys = DbKeyStore::new(&fx.keychain());
    assert!(keys.get("prod").unwrap().is_none());
    assert_eq!(fx.raw("db-key:prod"), None, "get does not create");
    let key = keys.get_or_create("prod").unwrap();
    let raw = fx.raw("db-key:prod").unwrap();
    assert!(is_hex64(&raw), "{}", String::from_utf8_lossy(&raw));
    assert_eq!(keys.get_or_create("prod").unwrap(), key);
    assert_eq!(keys.get("prod").unwrap(), Some(key.clone()));
    assert_ne!(keys.get_or_create("test").unwrap(), key);
    // The session entry of the profile is another one.
    assert_eq!(fx.raw("prod"), None);
    // A fresh state reads the same key back from the keychain.
    drop(keys);
    let again = DbKeyStore::new(&fx.keychain());
    assert_eq!(again.get("prod").unwrap(), Some(key));
}

#[test]
fn db_key_bytes_are_the_stored_hex() {
    let fx = Fixture::new();
    let hex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    fx.put_raw("db-key:prod", hex.as_bytes());
    let key = DbKeyStore::new(&fx.keychain())
        .get("prod")
        .unwrap()
        .unwrap();
    let expected: [u8; 32] = std::array::from_fn(|i| ((i % 16) as u8) * 0x11);
    assert_eq!(key.as_bytes(), &expected);
}

#[test]
fn concurrent_get_or_create_returns_one_key() {
    let fx = Fixture::new();
    let a = DbKeyStore::new(&fx.keychain());
    let b = DbKeyStore::new(&fx.keychain());
    for round in 0..200 {
        let profile = format!("p{round}");
        let barrier = Barrier::new(2);
        let (x, y) = std::thread::scope(|s| {
            let x = s.spawn(|| {
                barrier.wait();
                a.get_or_create(&profile).unwrap()
            });
            let y = s.spawn(|| {
                barrier.wait();
                b.get_or_create(&profile).unwrap()
            });
            (x.join().unwrap(), y.join().unwrap())
        });
        assert_eq!(x, y, "round {round}");
        assert_eq!(a.get(&profile).unwrap(), Some(x));
    }
}

#[test]
fn a_lost_or_damaged_key_is_never_replaced_silently() {
    let fx = Fixture::new();
    let keys = DbKeyStore::new(&fx.keychain());
    fx.put_raw("db-key:prod", b"not a key");
    assert!(matches!(keys.get("prod"), Err(Error::Malformed(_))));
    assert!(matches!(
        keys.get_or_create("prod"),
        Err(Error::Malformed(_))
    ));
    assert_eq!(fx.raw("db-key:prod").unwrap(), b"not a key");
}

#[test]
fn no_db_key_is_returned_when_the_keychain_refuses_it() {
    let fx = Fixture::new();
    let keys = DbKeyStore::new(&fx.keychain());
    fx.fail_writes(true);
    assert!(matches!(
        keys.get_or_create("prod"),
        Err(Error::Keychain(_))
    ));
    assert_eq!(fx.raw("db-key:prod"), None);
    fx.fail_writes(false);
    let key = keys.get_or_create("prod").unwrap();
    assert_eq!(keys.get("prod").unwrap(), Some(key));
}

#[test]
fn db_key_remove_deletes_only_the_key() {
    let fx = Fixture::new();
    let keys = DbKeyStore::new(&fx.keychain());
    let first = keys.get_or_create("prod").unwrap();
    keys.get_or_create("test").unwrap();
    keys.remove("prod").unwrap();
    keys.remove("prod").unwrap();
    assert!(keys.get("prod").unwrap().is_none());
    assert!(keys.get("test").unwrap().is_some());
    assert_ne!(keys.get_or_create("prod").unwrap(), first);
    assert!(keys.get("db-key:prod").is_err());
}

#[test]
fn db_key_store_debug_has_no_secret() {
    let fx = Fixture::new();
    let keys = DbKeyStore::new(&fx.keychain());
    keys.get_or_create("prod").unwrap();
    let hex = String::from_utf8(fx.raw("db-key:prod").unwrap()).unwrap();
    let text = format!("{keys:?} {:?}", keys.get("prod").unwrap());
    assert!(!text.contains(&hex), "{text}");
}

#[test]
fn device_fingerprint_is_made_once_per_installation() {
    let fx = Fixture::new();
    let slot = SecretSlot::device_fingerprint(&fx.keychain());
    assert!(slot.get().unwrap().is_none());
    assert_eq!(
        fx.raw("slot:device-fingerprint"),
        None,
        "get does not create"
    );
    let value = slot.get_or_create().unwrap();
    assert!(is_hex64(value.as_bytes()), "{}", value.as_str());
    assert_eq!(fx.raw("slot:device-fingerprint").unwrap(), value.as_bytes());
    assert_eq!(slot.get_or_create().unwrap(), value);
    let named = SecretSlot::new(&fx.keychain(), SecretSlot::DEVICE_FINGERPRINT).unwrap();
    assert_eq!(named.get().unwrap(), Some(value.clone()));
    let other = SecretSlot::new(&fx.keychain(), "other").unwrap();
    assert_ne!(other.get_or_create().unwrap(), value);
    assert!(!format!("{slot:?}").contains(value.as_str()));
    slot.remove().unwrap();
    slot.remove().unwrap();
    assert!(slot.get().unwrap().is_none());
}

#[test]
fn secret_slot_keeps_a_damaged_value_and_refuses_bad_names() {
    let fx = Fixture::new();
    let slot = SecretSlot::new(&fx.keychain(), "x").unwrap();
    fx.put_raw("slot:x", b"ABC");
    assert!(matches!(slot.get_or_create(), Err(Error::Malformed(_))));
    assert_eq!(fx.raw("slot:x").unwrap(), b"ABC");
    for bad in ["", "a:b", "tab\t"] {
        assert!(matches!(
            SecretSlot::new(&fx.keychain(), bad),
            Err(Error::InvalidName(_))
        ));
    }
}

#[test]
fn secret_slot_is_not_made_when_the_keychain_refuses_it() {
    let fx = Fixture::new();
    let slot = SecretSlot::device_fingerprint(&fx.keychain());
    fx.fail_writes(true);
    assert!(slot.get_or_create().is_err());
    fx.fail_writes(false);
    assert_eq!(fx.raw("slot:device-fingerprint"), None);
}

#[test]
fn concurrent_slot_get_or_create_returns_one_value() {
    let fx = Fixture::new();
    for round in 0..200 {
        let name = format!("s{round}");
        let a = SecretSlot::new(&fx.keychain(), &name).unwrap();
        let b = SecretSlot::new(&fx.keychain(), &name).unwrap();
        let barrier = Barrier::new(2);
        let (x, y) = std::thread::scope(|s| {
            let x = s.spawn(|| {
                barrier.wait();
                a.get_or_create().unwrap()
            });
            let y = s.spawn(|| {
                barrier.wait();
                b.get_or_create().unwrap()
            });
            (x.join().unwrap(), y.join().unwrap())
        });
        assert_eq!(x, y, "round {round}");
        assert_eq!(a.get().unwrap(), Some(x));
    }
}
