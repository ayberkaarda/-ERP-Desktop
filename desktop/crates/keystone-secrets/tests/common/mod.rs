#![allow(dead_code)]

use std::any::Any;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use keystone_secrets::Keychain;
use keystone_secrets::keyring_core::api::{CredentialApi, CredentialStoreApi};
use keystone_secrets::keyring_core::{self, Credential, CredentialStore, Entry, mock};
use keystone_sync::auth::{Secret, Session, SessionRecord, StoredTokens, TokenStore, TokenWrite};
use keystone_sync::wire::Timestamp;

pub fn unique(prefix: &str) -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!(
        "{prefix}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn tokens(n: u32) -> StoredTokens {
    StoredTokens {
        access_token: Secret::new(format!("access-{n}")),
        access_expires_at: Timestamp("2026-10-26T10:15:00+03:00".into()),
        refresh_token: Secret::new(format!("refresh-{n}")),
        refresh_expires_at: Timestamp("2026-11-25T09:15:00+03:00".into()),
    }
}

/// The `keyring-core` mock store with a switch that makes every write and
/// delete fail (a keychain that is locked, full or denies access) and one
/// that makes every read fail as unreadable stored data.
pub struct Flaky {
    mock: Arc<mock::Store>,
    fail: Arc<AtomicBool>,
    unreadable: Arc<AtomicBool>,
}

struct FlakyCred {
    entry: Entry,
    fail: Arc<AtomicBool>,
    unreadable: Arc<AtomicBool>,
}

fn injected() -> keyring_core::Error {
    keyring_core::Error::PlatformFailure("injected keychain failure".into())
}

impl CredentialApi for FlakyCred {
    fn set_secret(&self, secret: &[u8]) -> keyring_core::Result<()> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(injected());
        }
        self.entry.set_secret(secret)
    }

    fn get_secret(&self) -> keyring_core::Result<Vec<u8>> {
        if self.unreadable.load(Ordering::SeqCst) {
            return Err(keyring_core::Error::BadEncoding(b"unreadable".to_vec()));
        }
        self.entry.get_secret()
    }

    fn delete_credential(&self) -> keyring_core::Result<()> {
        if self.fail.load(Ordering::SeqCst) {
            return Err(injected());
        }
        self.entry.delete_credential()
    }

    fn get_credential(&self) -> keyring_core::Result<Option<Arc<Credential>>> {
        Ok(None)
    }

    fn get_specifiers(&self) -> Option<(String, String)> {
        self.entry.get_specifiers()
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

impl CredentialStoreApi for Flaky {
    fn vendor(&self) -> String {
        "flaky mock".to_owned()
    }

    fn id(&self) -> String {
        self.mock.id()
    }

    fn build(
        &self,
        service: &str,
        user: &str,
        modifiers: Option<&HashMap<&str, &str>>,
    ) -> keyring_core::Result<Entry> {
        let entry = self.mock.build(service, user, modifiers)?;
        Ok(Entry::new_with_credential(Arc::new(FlakyCred {
            entry,
            fail: self.fail.clone(),
            unreadable: self.unreadable.clone(),
        })))
    }

    fn as_any(&self) -> &dyn Any {
        self
    }
}

pub struct Fixture {
    pub service: String,
    pub store: Arc<CredentialStore>,
    mock: Arc<mock::Store>,
    fail: Arc<AtomicBool>,
    unreadable: Arc<AtomicBool>,
}

impl Fixture {
    pub fn new() -> Self {
        let mock = mock::Store::new().unwrap();
        let fail = Arc::new(AtomicBool::new(false));
        let unreadable = Arc::new(AtomicBool::new(false));
        let store: Arc<CredentialStore> = Arc::new(Flaky {
            mock: mock.clone(),
            fail: fail.clone(),
            unreadable: unreadable.clone(),
        });
        Self {
            service: unique("keystone-test"),
            store,
            mock,
            fail,
            unreadable,
        }
    }

    /// A keychain handle of the fixture's service (the same shared state for
    /// every call while one is alive).
    pub fn keychain(&self) -> Keychain {
        Keychain::with_store(&self.service, self.store.clone()).unwrap()
    }

    /// What the credential store holds for `account`, bypassing the crate.
    pub fn raw(&self, account: &str) -> Option<Vec<u8>> {
        let entry = self.mock.build(&self.service, account, None).unwrap();
        match entry.get_secret() {
            Ok(bytes) => Some(bytes),
            Err(keyring_core::Error::NoEntry) => None,
            Err(e) => panic!("{e}"),
        }
    }

    pub fn raw_json(&self, account: &str) -> serde_json::Value {
        serde_json::from_slice(&self.raw(account).expect("an entry")).unwrap()
    }

    pub fn put_raw(&self, account: &str, bytes: &[u8]) {
        let entry = self.mock.build(&self.service, account, None).unwrap();
        entry.set_secret(bytes).unwrap();
    }

    pub fn fail_writes(&self, on: bool) {
        self.fail.store(on, Ordering::SeqCst);
    }

    /// Reads through the crate fail as unreadable stored data; `raw` and
    /// `put_raw` still reach the entry.
    pub fn unreadable(&self, on: bool) {
        self.unreadable.store(on, Ordering::SeqCst);
    }
}

type Job = Box<dyn FnOnce(&TokenWrite) + Send>;

/// Hands `job` the write permit the way `keystone-sync` hands it to a store:
/// `Session::sign_in` calls the store's `sign_in` with its `TokenWrite`.
struct Permit {
    id: String,
    job: Mutex<Option<Job>>,
}

impl TokenStore for Permit {
    fn identity(&self) -> String {
        self.id.clone()
    }

    fn load_record(&self, _: &str) -> keystone_sync::Result<SessionRecord> {
        Ok(SessionRecord::default())
    }

    fn load(&self, _: &str) -> keystone_sync::Result<Option<StoredTokens>> {
        Ok(None)
    }

    fn save(&self, _: &TokenWrite, _: &str, _: &StoredTokens) -> keystone_sync::Result<()> {
        unreachable!()
    }

    fn clear(&self, _: &TokenWrite, _: &str) -> keystone_sync::Result<()> {
        unreachable!()
    }

    fn take(&self, _: &TokenWrite, _: &str) -> keystone_sync::Result<Option<StoredTokens>> {
        unreachable!()
    }

    fn sign_in(&self, write: &TokenWrite, _: &str, _: &StoredTokens) -> keystone_sync::Result<u64> {
        let job = self.job.lock().unwrap().take().expect("one job");
        job(write);
        Ok(1)
    }

    fn deactivate(&self, _: &TokenWrite, _: &str, _: u64) -> keystone_sync::Result<bool> {
        unreachable!()
    }
}

/// Runs `job` with a write permit; a panic in `job` fails the caller.
pub fn with_permit(job: impl FnOnce(&TokenWrite) + Send + 'static) {
    let permit = Arc::new(Permit {
        id: unique("permit"),
        job: Mutex::new(Some(Box::new(job))),
    });
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    runtime
        .block_on(Session::shared("permit", permit.clone()).sign_in(&tokens(0)))
        .unwrap();
    assert!(permit.job.lock().unwrap().is_none(), "the job ran");
}
