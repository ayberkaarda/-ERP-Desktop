//! One round on the real Windows Credential Manager. Not run by default:
//! `cargo test -p keystone-secrets --test native_windows -- --ignored --nocapture`.
//! Every entry it writes is deleted at the end.

#![cfg(windows)]

use std::process::Command;
use std::sync::Arc;

use keystone_secrets::{DbKeyStore, Keychain, KeychainTokenStore, SecretSlot};
use keystone_sync::auth::{Secret, Session, StoredTokens, TokenStore};
use keystone_sync::wire::Timestamp;

fn cmdkey(target: &str) -> String {
    let out = Command::new("cmdkey")
        .arg(format!("/list:{target}"))
        .output()
        .unwrap();
    String::from_utf8_lossy(&out.stdout).trim().to_owned()
}

#[tokio::test]
#[ignore = "writes to the real Windows Credential Manager"]
async fn round_trip_on_the_credential_manager() {
    let service = format!("keystone-manual-{}", std::process::id());
    let profile = "0199f0a0-0000-7000-8000-000000000001";
    let tokens = StoredTokens {
        access_token: Secret::new(format!("12|{}", "a".repeat(48))),
        access_expires_at: Timestamp("2026-10-27T19:00:00+03:00".into()),
        refresh_token: Secret::new("r".repeat(64)),
        refresh_expires_at: Timestamp("2026-11-26T18:00:00+03:00".into()),
    };
    {
        let keychain = Keychain::native(&service).unwrap();
        let store = Arc::new(KeychainTokenStore::new(&keychain));
        let generation = Session::shared(profile, store.clone())
            .sign_in(&tokens)
            .await
            .unwrap();
        println!("sign_in -> generation {generation}");
        let key = DbKeyStore::new(&keychain).get_or_create(profile).unwrap();
        let fingerprint = SecretSlot::device_fingerprint(&keychain)
            .get_or_create()
            .unwrap();
        println!("db key: {key:?}, fingerprint length {}", fingerprint.len());
    }
    for account in [
        profile.to_owned(),
        format!("db-key:{profile}"),
        "slot:device-fingerprint".to_owned(),
    ] {
        println!(
            "--- cmdkey {account}.{service}\n{}",
            cmdkey(&format!("{account}.{service}"))
        );
    }
    // Every handle is gone: a new one reads the OS store again.
    let keychain = Keychain::native(&service).unwrap();
    let store = KeychainTokenStore::new(&keychain);
    let record = store.load_record(profile).unwrap();
    println!(
        "reloaded: generation {}, deactivated {}, tokens match {}",
        record.generation,
        record.deactivated,
        record.tokens.as_ref() == Some(&tokens)
    );
    assert_eq!(record.generation, 1);
    assert_eq!(record.tokens, Some(tokens));
    assert!(DbKeyStore::new(&keychain).get(profile).unwrap().is_some());

    store.remove_profile(profile).unwrap();
    DbKeyStore::new(&keychain).remove(profile).unwrap();
    SecretSlot::device_fingerprint(&keychain).remove().unwrap();
    for account in [
        profile.to_owned(),
        format!("db-key:{profile}"),
        "slot:device-fingerprint".to_owned(),
    ] {
        let listed = cmdkey(&format!("{account}.{service}"));
        println!("--- after cleanup {account}.{service}\n{listed}");
        assert!(listed.contains("* NONE *"), "{listed}");
    }
}
