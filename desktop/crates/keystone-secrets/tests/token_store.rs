//! The `TokenStore` contract of `keystone-sync` on `KeychainTokenStore`, over
//! the `keyring-core` mock store.

mod common;

use std::sync::{Arc, Barrier};

use common::{Fixture, tokens, unique, with_permit};
use keystone_secrets::keyring_core::mock;
use keystone_secrets::{Error, Keychain, KeychainTokenStore, MAX_RECORD_BYTES};
use keystone_sync::auth::{Secret, Session, StoredTokens, TokenStore};
use keystone_sync::wire::Timestamp;

const P: &str = "prod";

fn store(fx: &Fixture) -> KeychainTokenStore {
    KeychainTokenStore::new(&fx.keychain())
}

// The tests of `MemoryTokenStore`, on the keychain store.

#[test]
fn deactivate_is_a_compare_and_set_on_the_generation() {
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        let generation = store.sign_in(w, P, &tokens(1)).unwrap();
        assert!(!store.deactivate(w, P, generation - 1).unwrap());
        assert_eq!(store.load(P).unwrap(), Some(tokens(1)));
        assert!(store.deactivate(w, P, generation).unwrap());
        let record = store.load_record(P).unwrap();
        assert!(record.deactivated && record.tokens.is_none());
        // Only a sign-in clears the mark; a refresh save keeps it.
        store.save(w, P, &tokens(2)).unwrap();
        assert!(store.load_record(P).unwrap().deactivated);
        store.sign_in(w, P, &tokens(3)).unwrap();
        assert!(!store.load_record(P).unwrap().deactivated);
        assert_eq!(store.take(w, P).unwrap(), Some(tokens(3)));
        assert_eq!(store.take(w, P).unwrap(), None);
    });
}

#[test]
fn sign_out_is_a_compare_and_set_on_the_generation() {
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        let first = store.sign_in(w, P, &tokens(1)).unwrap();
        store.sign_in(w, P, &tokens(2)).unwrap();
        assert!(!store.sign_out(w, P, first).unwrap());
        assert_eq!(store.load(P).unwrap(), Some(tokens(2)));
        assert!(store.sign_out(w, P, first + 1).unwrap());
        assert_eq!(store.load(P).unwrap(), None);
    });
}

#[test]
fn keychain_store_saves_replaces_and_clears() {
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        assert_eq!(store.load(P).unwrap(), None);
        store.save(w, P, &tokens(1)).unwrap();
        store.save(w, P, &tokens(2)).unwrap();
        assert_eq!(store.load(P).unwrap(), Some(tokens(2)));
        assert_eq!(store.load("test").unwrap(), None);
        store.clear(w, P).unwrap();
        store.clear(w, P).unwrap();
        assert_eq!(store.load(P).unwrap(), None);
    });
}

#[test]
fn secrets_stay_out_of_debug() {
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        store.sign_in(w, P, &tokens(7)).unwrap();
        let text = format!(
            "{store:?} {:?} {:?}",
            fx.keychain(),
            store.load_record(P).unwrap()
        );
        assert!(text.contains(&fx.service), "{text}");
        assert!(
            !text.contains("access-7") && !text.contains("refresh-7"),
            "{text}"
        );
    });
}

// Keychain specifics.

#[test]
fn take_is_atomic_across_two_handles() {
    with_permit(|w| {
        let fx = Fixture::new();
        // Two handles from two `Keychain` objects of the same service.
        let a = KeychainTokenStore::new(&fx.keychain());
        let b = KeychainTokenStore::new(&fx.keychain());
        for round in 0..300 {
            a.sign_in(w, P, &tokens(round)).unwrap();
            let barrier = Barrier::new(2);
            let (x, y) = std::thread::scope(|s| {
                let x = s.spawn(|| {
                    barrier.wait();
                    a.take(w, P).unwrap()
                });
                let y = s.spawn(|| {
                    barrier.wait();
                    b.take(w, P).unwrap()
                });
                (x.join().unwrap(), y.join().unwrap())
            });
            let got: Vec<_> = [x, y].into_iter().flatten().collect();
            assert_eq!(got, vec![tokens(round)], "round {round}");
        }
    });
}

#[test]
fn handles_share_identity_and_state() {
    with_permit(|w| {
        let fx = Fixture::new();
        let a = KeychainTokenStore::new(&fx.keychain());
        let b = KeychainTokenStore::new(&fx.keychain());
        assert_eq!(a.identity(), format!("keychain:{}", fx.service));
        assert_eq!(a.identity(), b.identity());
        // `b` caches the empty record first; `a`'s sign-in must reach it.
        assert_eq!(b.load_record(P).unwrap().generation, 0);
        let generation = a.sign_in(w, P, &tokens(1)).unwrap();
        assert_eq!(b.load_record(P).unwrap().generation, generation);
        assert!(b.deactivate(w, P, generation).unwrap());
        assert!(a.load_record(P).unwrap().deactivated);
    });
}

#[test]
fn a_service_cannot_be_opened_over_another_store() {
    let fx = Fixture::new();
    let _open = fx.keychain();
    let other = mock::Store::new().unwrap();
    assert!(matches!(
        Keychain::with_store(&fx.service, other),
        Err(Error::ServiceInUse(_))
    ));
}

#[test]
fn generation_only_grows_and_survives_a_new_handle() {
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        assert_eq!(store.sign_in(w, P, &tokens(1)).unwrap(), 1);
        store.clear(w, P).unwrap();
        store.save(w, P, &tokens(2)).unwrap();
        assert_eq!(store.take(w, P).unwrap(), Some(tokens(2)));
        store.save(w, P, &tokens(3)).unwrap();
        assert!(store.sign_out(w, P, 1).unwrap());
        store.save(w, P, &tokens(4)).unwrap();
        assert!(store.deactivate(w, P, 1).unwrap());
        assert_eq!(store.load_record(P).unwrap().generation, 1);
        // The entry stays (only the tokens went) and keeps the generation.
        let raw = fx.raw_json(P);
        assert_eq!(raw["generation"], 1);
        assert!(raw.get("tokens").is_none(), "{raw}");
        assert_eq!(store.sign_in(w, P, &tokens(5)).unwrap(), 2);
        // A fresh state (every handle dropped) reads it back from the keychain.
        drop(store);
        let again = KeychainTokenStore::new(&fx.keychain());
        let record = again.load_record(P).unwrap();
        assert_eq!((record.generation, record.tokens), (2, Some(tokens(5))));
        assert_eq!(again.sign_in(w, P, &tokens(6)).unwrap(), 3);
    });
}

#[test]
fn sign_in_writes_tokens_generation_and_cleared_flag_in_one_record() {
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        let generation = store.sign_in(w, P, &tokens(1)).unwrap();
        assert!(store.deactivate(w, P, generation).unwrap());
        assert_eq!(fx.raw_json(P)["deactivated"], true);
        assert_eq!(store.sign_in(w, P, &tokens(2)).unwrap(), generation + 1);
        let raw = fx.raw_json(P);
        assert_eq!(raw["deactivated"], false);
        assert_eq!(raw["generation"], generation + 1);
        assert_eq!(raw["tokens"]["access_token"], "access-2");
        assert_eq!(raw["tokens"]["refresh_token"], "refresh-2");
        assert_eq!(
            raw["tokens"]["access_expires_at"],
            "2026-10-26T10:15:00+03:00"
        );
        assert_eq!(
            raw["tokens"]["refresh_expires_at"],
            "2026-11-25T09:15:00+03:00"
        );
        let record = store.load_record(P).unwrap();
        assert!(!record.deactivated);
        assert_eq!(record.tokens, Some(tokens(2)));
    });
}

fn long_tokens(access: usize, refresh: usize) -> StoredTokens {
    StoredTokens {
        access_token: Secret::new("a".repeat(access)),
        access_expires_at: Timestamp("2026-10-26T10:15:00.000000+03:00".into()),
        refresh_token: Secret::new("r".repeat(refresh)),
        refresh_expires_at: Timestamp("2026-11-25T09:15:00.000000+03:00".into()),
    }
}

#[test]
fn record_json_stays_under_the_windows_blob_limit() {
    assert_eq!(MAX_RECORD_BYTES, 2560);
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        // A Sanctum access token is about 50 bytes; the contract caps the
        // refresh token at 512. Far larger tokens still fit.
        store.sign_in(w, P, &long_tokens(1500, 512)).unwrap();
        assert!(store.deactivate(w, P, 1).unwrap());
        store.save(w, P, &long_tokens(1500, 512)).unwrap();
        let len = fx.raw(P).unwrap().len();
        assert!(len <= MAX_RECORD_BYTES, "{len}");
        assert_eq!(store.load(P).unwrap(), Some(long_tokens(1500, 512)));
    });
}

#[test]
fn an_oversized_record_is_refused_before_any_write() {
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        store.sign_in(w, P, &tokens(1)).unwrap();
        let before = fx.raw(P);
        let err = store.sign_in(w, P, &long_tokens(2100, 512)).unwrap_err();
        assert!(err.to_string().contains("2560"), "{err}");
        assert_eq!(fx.raw(P), before);
        let record = store.load_record(P).unwrap();
        assert_eq!((record.generation, record.tokens), (1, Some(tokens(1))));
    });
}

#[test]
fn a_failed_keychain_write_leaves_the_cache_unchanged() {
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        assert_eq!(store.sign_in(w, P, &tokens(1)).unwrap(), 1);
        let before = fx.raw(P);
        fx.fail_writes(true);
        let err = store.sign_in(w, P, &tokens(2)).unwrap_err();
        assert!(err.to_string().contains("injected"), "{err}");
        assert!(store.save(w, P, &tokens(3)).is_err());
        assert!(store.take(w, P).is_err());
        assert!(store.clear(w, P).is_err());
        assert!(store.deactivate(w, P, 1).is_err());
        assert!(store.sign_out(w, P, 1).is_err());
        let record = store.load_record(P).unwrap();
        assert_eq!(record.generation, 1);
        assert_eq!(record.tokens, Some(tokens(1)));
        assert!(!record.deactivated);
        assert_eq!(fx.raw(P), before);
        fx.fail_writes(false);
        // The failed sign-in used no generation.
        assert_eq!(store.sign_in(w, P, &tokens(4)).unwrap(), 2);
    });
}

#[test]
fn a_malformed_entry_fails_without_leaking_or_deleting_it() {
    let fx = Fixture::new();
    fx.put_raw(
        P,
        br#"{"generation":1,"deactivated":false,"tokens":"leaked-secret"}"#,
    );
    let store = store(&fx);
    let err = store.load_record(P).unwrap_err().to_string();
    assert!(
        err.contains("malformed") && !err.contains("leaked-secret"),
        "{err}"
    );
    assert!(fx.raw(P).is_some());
}

#[test]
fn profile_ids_cannot_reach_other_accounts() {
    let fx = Fixture::new();
    let store = store(&fx);
    for bad in ["", "db-key:prod", "slot:device-fingerprint", "a\nb"] {
        assert!(store.load_record(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn remove_profile_deletes_the_entry_but_the_process_keeps_the_generation() {
    with_permit(|w| {
        let fx = Fixture::new();
        let store = store(&fx);
        store.sign_in(w, P, &tokens(1)).unwrap();
        store.sign_in(w, P, &tokens(2)).unwrap();
        store.remove_profile(P).unwrap();
        assert_eq!(fx.raw(P), None);
        let record = store.load_record(P).unwrap();
        assert_eq!((record.generation, record.tokens), (2, None));
        assert_eq!(store.sign_in(w, P, &tokens(3)).unwrap(), 3);
        store.remove_profile("never-signed-in").unwrap();
    });
}

#[tokio::test]
async fn session_sign_in_is_the_way_in() {
    let fx = Fixture::new();
    let store = Arc::new(store(&fx));
    let profile = unique("profile");
    let session = Session::shared(&profile, store.clone());
    assert_eq!(session.sign_in(&tokens(1)).await.unwrap(), 1);
    assert_eq!(session.record().unwrap().tokens, Some(tokens(1)));
    // Another handle of the same service is the same session.
    let other = Arc::new(KeychainTokenStore::new(&fx.keychain()));
    assert!(Arc::ptr_eq(&session, &Session::shared(&profile, other)));
    assert_eq!(fx.raw_json(&profile)["generation"], 1);
}
