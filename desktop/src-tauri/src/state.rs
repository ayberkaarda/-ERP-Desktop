//! Process state shared by every command: the active server profile, its
//! HTTP client and its sync engine.
//!
//! One slot holds the whole profile (id, client, engine, local store and
//! the handle of its sync loop), so a command can never get the client of
//! one profile and the engine of another. The slot is a `std::sync::RwLock`
//! and every accessor clones an `Arc` out and drops the guard before
//! returning: no guard is ever held across an `.await`. Replacing the
//! profile returns the previous one, so the caller shuts it down (sync
//! loop, store) outside the lock.

use std::sync::{Arc, PoisonError, RwLock};

use keystone_sync::client::HttpClient;
use keystone_sync::engine::{SyncEngine, SyncHandle, Trigger};
use keystone_sync::store::Store;

use crate::commands::{CommandError, CommandResult, codes};

/// Sync engine of a profile, over the profile's own HTTP client.
pub type Engine = SyncEngine<HttpClient>;

/// The server profile the shell currently works in.
///
/// `client` and the client inside `engine` are two clients of the same
/// profile; they share one `Session` (token store handle and token lock),
/// see `HttpClient::new`.
pub struct ActiveProfile {
    /// Profile id (also the `TokenStore` key of the profile).
    pub id: String,
    /// Client for direct calls (proxy, device list, meta).
    pub client: Arc<HttpClient>,
    /// `None` until the profile's local store is open.
    pub engine: Option<Arc<Engine>>,
}

impl std::fmt::Debug for ActiveProfile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ActiveProfile")
            .field("id", &self.id)
            .field("engine", &self.engine.is_some())
            .finish_non_exhaustive()
    }
}

/// What the bootstrap adds to an [`ActiveProfile`] once its local store is
/// open: the store itself (local copy checks) and the handle of the
/// profile's sync loop (`None` while the loop does not run, e.g. before a
/// company is chosen).
#[derive(Debug, Default)]
struct Attached {
    store: Option<Arc<Store>>,
    sync: Option<SyncHandle>,
}

#[derive(Debug)]
struct Slot {
    profile: ActiveProfile,
    attached: Attached,
}

#[derive(Debug, Default)]
pub struct AppState {
    active: RwLock<Option<Slot>>,
}

impl AppState {
    /// HTTP client of the active profile.
    pub fn client(&self) -> CommandResult<Arc<HttpClient>> {
        let slot = self.read();
        let slot = slot.as_ref().ok_or_else(no_profile)?;
        Ok(slot.profile.client.clone())
    }

    /// Sync engine of the active profile.
    pub fn engine(&self) -> CommandResult<Arc<Engine>> {
        let slot = self.read();
        let slot = slot.as_ref().ok_or_else(no_profile)?;
        slot.profile.engine.clone().ok_or_else(no_engine)
    }

    /// Local store of the active profile (the one its engine works on).
    pub fn store(&self) -> CommandResult<Arc<Store>> {
        let slot = self.read();
        let slot = slot.as_ref().ok_or_else(no_profile)?;
        slot.attached.store.clone().ok_or_else(no_engine)
    }

    /// Id of the active profile, if any.
    pub fn active_profile_id(&self) -> Option<String> {
        self.read().as_ref().map(|slot| slot.profile.id.clone())
    }

    /// Sends `trigger` to the sync loop of the active profile when it is
    /// still `profile_id`. `Ok(false)`: the profile has no running loop.
    pub fn trigger(&self, profile_id: &str, trigger: Trigger) -> CommandResult<bool> {
        let slot = self.read();
        match slot.as_ref() {
            Some(slot) if slot.profile.id == profile_id => Ok(slot
                .attached
                .sync
                .as_ref()
                .is_some_and(|sync| sync.trigger(trigger))),
            _ => Err(no_profile()),
        }
    }

    /// Makes `profile` the active one and returns the previous profile.
    pub fn activate(&self, profile: ActiveProfile) -> Option<ActiveProfile> {
        self.write()
            .replace(Slot {
                profile,
                attached: Attached::default(),
            })
            .map(|slot| slot.profile)
    }

    /// Clears the active profile and returns it.
    pub fn deactivate(&self) -> Option<ActiveProfile> {
        self.write().take().map(|slot| slot.profile)
    }

    /// Sets the engine of the active profile when it is still `profile_id`;
    /// returns the engine it replaced. Fails when another profile (or none)
    /// became active meanwhile, so a late engine never lands on the wrong
    /// profile.
    pub fn set_engine(
        &self,
        profile_id: &str,
        engine: Arc<Engine>,
    ) -> CommandResult<Option<Arc<Engine>>> {
        let mut slot = self.write();
        match slot.as_mut() {
            Some(slot) if slot.profile.id == profile_id => Ok(slot.profile.engine.replace(engine)),
            _ => Err(no_profile()),
        }
    }

    /// [`AppState::set_engine`] together with the engine's store and the
    /// handle of its sync loop, in one step.
    pub fn attach(
        &self,
        profile_id: &str,
        engine: Arc<Engine>,
        store: Arc<Store>,
        sync: Option<SyncHandle>,
    ) -> CommandResult<Option<Arc<Engine>>> {
        let mut slot = self.write();
        match slot.as_mut() {
            Some(slot) if slot.profile.id == profile_id => {
                slot.attached = Attached {
                    store: Some(store),
                    sync,
                };
                Ok(slot.profile.engine.replace(engine))
            }
            _ => Err(no_profile()),
        }
    }

    // A panic while holding the guard leaves either the old or the new
    // profile in the slot, both valid: the poison flag carries no meaning.
    fn read(&self) -> std::sync::RwLockReadGuard<'_, Option<Slot>> {
        self.active.read().unwrap_or_else(PoisonError::into_inner)
    }

    fn write(&self) -> std::sync::RwLockWriteGuard<'_, Option<Slot>> {
        self.active.write().unwrap_or_else(PoisonError::into_inner)
    }
}

fn no_profile() -> CommandError {
    CommandError::new(codes::NO_ACTIVE_PROFILE, "no server profile is selected")
}

fn no_engine() -> CommandError {
    CommandError::new(
        codes::ENGINE_UNAVAILABLE,
        "the active profile has no open local store",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use keystone_sync::auth::MemoryTokenStore;
    use keystone_sync::client::{ApiConfig, ClientOptions};
    use keystone_sync::store::{DbKey, Store};

    fn client(profile: &str) -> HttpClient {
        let config = ApiConfig {
            base_url: "https://erp.example.com".into(),
            company_id: uuid::Uuid::nil(),
            user_agent: "keystone-desktop-test".into(),
        };
        HttpClient::new(
            &config,
            profile,
            Arc::new(MemoryTokenStore::default()),
            &ClientOptions::default(),
        )
        .expect("client")
    }

    fn engine(profile: &str, dir: &tempfile::TempDir) -> Arc<Engine> {
        let store = Store::open(
            dir.path().join(format!("{profile}.db")),
            &DbKey::from_bytes([7; 32]),
        )
        .expect("store");
        Arc::new(SyncEngine::new(client(profile), Arc::new(store)))
    }

    fn profile(id: &str) -> ActiveProfile {
        ActiveProfile {
            id: id.into(),
            client: Arc::new(client(id)),
            engine: None,
        }
    }

    #[test]
    fn empty_state_reports_no_active_profile() {
        let state = AppState::default();
        assert_eq!(state.client().unwrap_err().code, codes::NO_ACTIVE_PROFILE);
        assert_eq!(state.engine().unwrap_err().code, codes::NO_ACTIVE_PROFILE);
        assert_eq!(state.active_profile_id(), None);
    }

    #[test]
    fn profile_without_engine_has_client_but_no_engine() {
        let state = AppState::default();
        let active = profile("p1");
        let client = active.client.clone();
        assert!(state.activate(active).is_none());

        assert!(Arc::ptr_eq(&state.client().unwrap(), &client));
        assert_eq!(state.engine().unwrap_err().code, codes::ENGINE_UNAVAILABLE);
        assert_eq!(state.active_profile_id().as_deref(), Some("p1"));
    }

    #[test]
    fn engine_is_set_only_on_the_profile_it_was_built_for() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::default();
        state.activate(profile("p1"));

        let stale = engine("p0", &dir);
        assert_eq!(
            state.set_engine("p0", stale).unwrap_err().code,
            codes::NO_ACTIVE_PROFILE
        );
        assert_eq!(state.engine().unwrap_err().code, codes::ENGINE_UNAVAILABLE);

        let fresh = engine("p1", &dir);
        assert!(state.set_engine("p1", fresh.clone()).unwrap().is_none());
        assert!(Arc::ptr_eq(&state.engine().unwrap(), &fresh));
    }

    #[test]
    fn switching_profiles_returns_the_previous_one() {
        let state = AppState::default();
        state.activate(profile("p1"));
        let previous = state.activate(profile("p2")).expect("previous profile");
        assert_eq!(previous.id, "p1");
        assert_eq!(state.active_profile_id().as_deref(), Some("p2"));

        let cleared = state.deactivate().expect("active profile");
        assert_eq!(cleared.id, "p2");
        assert_eq!(state.client().unwrap_err().code, codes::NO_ACTIVE_PROFILE);
    }

    #[test]
    fn poisoned_slot_still_answers() {
        let state = Arc::new(AppState::default());
        state.activate(profile("p1"));
        let poisoner = state.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.active.write().unwrap();
            panic!("poison the slot");
        })
        .join();
        assert!(state.active.is_poisoned());
        assert_eq!(state.active_profile_id().as_deref(), Some("p1"));
    }

    #[test]
    fn attach_sets_engine_store_and_loop_of_the_same_profile_only() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::default();
        state.activate(profile("p1"));
        assert_eq!(state.store().unwrap_err().code, codes::ENGINE_UNAVAILABLE);
        assert_eq!(state.trigger("p1", Trigger::Manual), Ok(false));

        let engine = engine("p1", &dir);
        let store = Arc::new(
            Store::open(dir.path().join("attach.db"), &DbKey::from_bytes([7; 32])).unwrap(),
        );
        let (handle, sync_loop) = keystone_sync::engine::sync_loop(engine.clone());
        let stale = state.attach("p0", engine.clone(), store.clone(), Some(handle.clone()));
        assert_eq!(stale.unwrap_err().code, codes::NO_ACTIVE_PROFILE);
        assert!(state.store().is_err());

        state
            .attach("p1", engine.clone(), store.clone(), Some(handle))
            .unwrap();
        assert!(Arc::ptr_eq(&state.engine().unwrap(), &engine));
        assert!(Arc::ptr_eq(&state.store().unwrap(), &store));
        assert_eq!(state.trigger("p1", Trigger::Manual), Ok(true));
        let other = state.trigger("p2", Trigger::Manual);
        assert_eq!(other.unwrap_err().code, codes::NO_ACTIVE_PROFILE);
        // The loop is gone: the trigger says so.
        drop(sync_loop);
        assert_eq!(state.trigger("p1", Trigger::Manual), Ok(false));

        // A new profile starts without the parts of the previous one.
        state.activate(profile("p2"));
        assert!(state.store().is_err());
        assert_eq!(state.trigger("p2", Trigger::Manual), Ok(false));
    }
}
