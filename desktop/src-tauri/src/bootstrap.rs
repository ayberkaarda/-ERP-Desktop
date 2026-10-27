//! Start-up and life cycle of server profiles: [`Desktop`].
//!
//! Selecting a profile opens, in this order: the session record check
//! (keychain), the profile's HTTP clients, its encrypted store (key from
//! the keychain), the sync engine over the compiled offline manifest, the
//! sync loop on the engine runtime ([`crate::runtime`]) and the event
//! bridge ([`crate::events`]). The loop runs only once a company is chosen;
//! before that the engine exists for sign-out alone.
//!
//! Rules this module keeps:
//! - One profile is active at a time. Switching stops the old loop and
//!   bridge (aborted and awaited) before the new profile opens; profile
//!   switches, sign-in follow-ups, resets and removals are serialized.
//! - A database key is created only for a profile that has no database
//!   yet. When the database exists, a missing or unreadable key is
//!   `STORE_KEY_INVALID` / `PROFILE_RECORD_MALFORMED`: the user decides
//!   (`profile_reset`), nothing is deleted on its own.
//! - Removing or resetting a profile closes its engine and every session
//!   of it first, then deletes the keychain records and the database: a
//!   live session could otherwise write the token record back.
//! - Nothing here deletes local data because of a sign-in outcome (a stale
//!   `USER_DEACTIVATED` included): the engine alone decides that.
//! - `http://` server URLs are accepted only in debug builds with
//!   `KEYSTONE_DEV_ALLOW_HTTP=1` ([`allow_http`]).

use std::path::PathBuf;
use std::sync::{Arc, Weak};
use std::time::Duration;

use keystone_secrets::{DbKeyStore, Keychain, KeychainTokenStore, SecretSlot};
use keystone_sync::SyncError;
use keystone_sync::auth::{Session, SessionRecord, TokenStore};
use keystone_sync::client::{
    ApiConfig, ClientOptions, DeviceAuthApi, HttpClient, ProxyMethod, ProxyRequest, ProxyResponse,
    ServerUrl, fetch_server_meta, parse_retry_after,
};
use keystone_sync::engine::{SignOut, SyncEngine, Trigger, sync_loop};
use keystone_sync::store::{Store, offline_manifest};
use keystone_sync::wire::{DeviceLoginRequest, ErrorResponse, SCHEMA_VERSION};
use serde_json::Value;
use tokio::task::JoinHandle;
use uuid::Uuid;

use crate::commands::{CommandError, CommandResult};
use crate::dto::auth::{AuthStateDto, CompanyDto, LoginDto, SignOutDto, UserDto};
use crate::dto::profile::{ProfileDto, ProfilesDto};
use crate::events::{EventSink, bridge};
use crate::profiles::{MetaSnapshot, Profile, ProfileRegistry, compare_versions};
use crate::runtime::EngineRuntime;
use crate::state::{ActiveProfile, AppState, Engine};

/// Error codes of profile and sign-in commands (besides the crate's).
pub mod codes {
    /// No profile with this id.
    pub const PROFILE_NOT_FOUND: &str = "PROFILE_NOT_FOUND";
    /// `profiles.json` cannot be read or written; it is left as it is.
    pub const PROFILES_FILE_INVALID: &str = "PROFILES_FILE_INVALID";
    /// The server needs a newer desktop app (`meta.desktop.min_version`).
    pub const DESKTOP_UPDATE_REQUIRED: &str = "DESKTOP_UPDATE_REQUIRED";
    /// The server needs a newer sync schema (`meta.sync.min_schema_version`).
    pub const SYNC_SCHEMA_MISMATCH: &str = "SYNC_SCHEMA_MISMATCH";
    /// A keychain record of the profile (session record or database key)
    /// cannot be read back. UI action: reset the profile (`profile_reset`)
    /// or remove it (`profile_remove`).
    pub const PROFILE_RECORD_MALFORMED: &str = "PROFILE_RECORD_MALFORMED";
    /// The profile's database exists but its key is missing or wrong. UI
    /// action: with the user's consent, `profile_reset` (local data is
    /// downloaded again; unsent work is lost).
    pub const STORE_KEY_INVALID: &str = "STORE_KEY_INVALID";
    /// The profile has unsent work; call again with `force`.
    pub const PROFILE_HAS_PENDING_WORK: &str = "PROFILE_HAS_PENDING_WORK";
    /// A request of the profile is still running; try again.
    pub const PROFILE_BUSY: &str = "PROFILE_BUSY";
    /// The company is not one of the signed-in user's.
    pub const COMPANY_NOT_AVAILABLE: &str = "COMPANY_NOT_AVAILABLE";
    /// A background task of the command stopped.
    pub const TASK_FAILED: &str = "TASK_FAILED";
}

/// Keychain service of the app (Credential Manager target prefix,
/// macOS keychain service, Secret Service attribute).
pub const KEYCHAIN_SERVICE: &str = "com.keystone.desktop";

/// Environment switch for `http://localhost` servers in debug builds.
pub const DEV_ALLOW_HTTP_ENV: &str = "KEYSTONE_DEV_ALLOW_HTTP";

/// Database file of a profile, inside its directory.
pub const DB_FILE: &str = "keystone.db";

/// The offline manifest compiled into the app (same file as the router's).
const OFFLINE_MANIFEST: &str = include_str!("../../../contracts/offline-manifest.json");

/// `http://` loopback servers: debug builds only, and only with
/// `KEYSTONE_DEV_ALLOW_HTTP=1`. A release build ignores the variable.
pub fn allow_http() -> bool {
    allow_http_with(
        cfg!(debug_assertions),
        std::env::var(DEV_ALLOW_HTTP_ENV).ok().as_deref(),
    )
}

fn allow_http_with(debug_build: bool, env: Option<&str>) -> bool {
    debug_build && env == Some("1")
}

/// Fixed settings of a [`Desktop`].
pub struct Config {
    /// App data directory: `profiles.json` and `profiles/<id>/`.
    pub data_dir: PathBuf,
    pub keychain: Keychain,
    pub options: ClientOptions,
    pub user_agent: String,
    /// Version of the running app, compared with `meta.desktop.min_version`.
    pub app_version: String,
    /// How long removal waits for requests of the profile still running.
    pub release_wait: Duration,
}

impl Config {
    /// The settings of the running app.
    pub fn for_app(data_dir: PathBuf, app_version: &str) -> Result<Self, keystone_secrets::Error> {
        Ok(Self {
            data_dir,
            keychain: Keychain::native(KEYCHAIN_SERVICE)?,
            options: ClientOptions {
                allow_http_localhost: allow_http(),
                ..ClientOptions::default()
            },
            user_agent: format!("Keystone-Desktop/{app_version} ({})", std::env::consts::OS),
            app_version: app_version.to_owned(),
            release_wait: Duration::from_secs(5),
        })
    }
}

/// Tasks of the active profile on the engine runtime.
struct Running {
    sync_loop: Option<JoinHandle<()>>,
    events: JoinHandle<()>,
}

/// What opening a profile produced.
struct Opened {
    engine: Arc<Engine>,
    store: Arc<Store>,
}

/// Profiles, keychain and the engine runtime of the app. Managed Tauri
/// state next to [`AppState`].
pub struct Desktop {
    profiles: Arc<ProfileRegistry>,
    keychain: Keychain,
    tokens: Arc<KeychainTokenStore>,
    db_keys: DbKeyStore,
    data_dir: PathBuf,
    options: ClientOptions,
    user_agent: String,
    app_version: String,
    release_wait: Duration,
    runtime: EngineRuntime,
    sink: Arc<dyn EventSink>,
    /// Session of every profile a client was made for, to see it closed
    /// before its records go (active or not, engine or not).
    sessions: std::sync::Mutex<std::collections::HashMap<String, Weak<Session>>>,
    /// The active profile's tasks; also serializes switches.
    running: tokio::sync::Mutex<Option<Running>>,
}

impl std::fmt::Debug for Desktop {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Desktop")
            .field("data_dir", &self.data_dir)
            .field("keychain", &self.keychain)
            .finish_non_exhaustive()
    }
}

impl Desktop {
    pub fn new(config: Config, sink: Arc<dyn EventSink>) -> std::io::Result<Self> {
        Ok(Self {
            profiles: Arc::new(ProfileRegistry::new(&config.data_dir)),
            tokens: Arc::new(KeychainTokenStore::new(&config.keychain)),
            db_keys: DbKeyStore::new(&config.keychain),
            keychain: config.keychain,
            data_dir: config.data_dir,
            options: config.options,
            user_agent: config.user_agent,
            app_version: config.app_version,
            release_wait: config.release_wait,
            runtime: EngineRuntime::start()?,
            sink,
            sessions: std::sync::Mutex::default(),
            running: tokio::sync::Mutex::new(None),
        })
    }

    pub fn registry(&self) -> &ProfileRegistry {
        &self.profiles
    }

    pub fn runtime(&self) -> &EngineRuntime {
        &self.runtime
    }

    /// Directory of a profile's local data.
    pub fn profile_dir(&self, id: &str) -> PathBuf {
        self.data_dir.join("profiles").join(id)
    }

    // ---- profiles -------------------------------------------------------

    /// Reads `/api/v1/meta` of `url`, checks it and stores a new profile.
    /// The profile is not selected.
    pub async fn add_profile(&self, url: &str, name: Option<&str>) -> CommandResult<ProfileDto> {
        let server = ServerUrl::parse(url, self.options.allow_http_localhost)?;
        let base_url = server.origin();
        let meta = fetch_server_meta(&base_url, &self.user_agent, &self.options)
            .await?
            .data;
        if let Some(min) = meta.desktop.min_version.as_deref()
            && compare_versions(min, &self.app_version) == Some(std::cmp::Ordering::Greater)
        {
            return Err(CommandError::new(
                codes::DESKTOP_UPDATE_REQUIRED,
                format!(
                    "the server needs desktop version {min} or newer (this is {})",
                    self.app_version
                ),
            ));
        }
        if meta.sync.min_schema_version > SCHEMA_VERSION {
            return Err(CommandError::new(
                codes::SYNC_SCHEMA_MISMATCH,
                format!(
                    "the server needs sync schema {} or newer (this app speaks {SCHEMA_VERSION})",
                    meta.sync.min_schema_version
                ),
            ));
        }
        let name = name.map(str::trim).filter(|n| !n.is_empty());
        if name.is_some_and(|n| n.chars().count() > 100) {
            return Err(SyncError::InvalidRequest("the profile name is too long".into()).into());
        }
        let profile = Profile {
            id: Uuid::now_v7().to_string(),
            name: name.unwrap_or(&meta.name).to_owned(),
            base_url,
            meta_snapshot: MetaSnapshot::from(&meta),
            company_id: None,
            created_at: now(),
        };
        let registry = self.profiles_blocking();
        let stored = profile.clone();
        blocking(move || registry.add(stored)).await?;
        Ok(ProfileDto::from(&profile))
    }

    pub async fn list_profiles(&self) -> CommandResult<ProfilesDto> {
        let registry = self.profiles_blocking();
        let file = blocking(move || registry.load()).await?;
        Ok(ProfilesDto {
            active_id: file.active.clone(),
            profiles: file.profiles.iter().map(ProfileDto::from).collect(),
        })
    }

    /// Makes `id` the active profile (the previous one is closed first).
    ///
    /// Fails without changing anything when the profile's session record
    /// cannot be read (`PROFILE_RECORD_MALFORMED`). When its local store
    /// cannot be opened (`STORE_KEY_INVALID`, ...), the profile becomes
    /// active without an engine (online requests work) and the error is
    /// returned for the UI to offer `profile_reset`.
    pub async fn select(&self, state: &AppState, id: &str) -> CommandResult<ProfileDto> {
        let mut running = self.running.lock().await;
        let profile = self.profile(id).await?;
        self.check_record(id).await?;
        // A profile whose client cannot be built leaves the active one alone.
        drop(self.client(&profile)?);
        self.stop(state, &mut running).await;
        let registry = self.profiles_blocking();
        let active = id.to_owned();
        blocking(move || registry.set_active(Some(&active))).await?;
        self.start(state, &mut running, &profile).await?;
        Ok(ProfileDto::from(&profile))
    }

    /// Selects the stored active profile at start-up, if any.
    pub async fn restore(&self, state: &AppState) -> CommandResult<Option<ProfileDto>> {
        let registry = self.profiles_blocking();
        let file = blocking(move || registry.load()).await?;
        match file.active {
            Some(id) => self.select(state, &id).await.map(Some),
            None => Ok(None),
        }
    }

    /// Deletes the profile's tokens, database key and local data, keeps
    /// the profile (company cleared). Refused with unsent work unless
    /// `force`. When it was active it is opened again, signed out.
    pub async fn reset(
        &self,
        state: &AppState,
        id: &str,
        force: bool,
    ) -> CommandResult<ProfileDto> {
        let mut running = self.running.lock().await;
        let profile = self.profile(id).await?;
        let was_active = state.active_profile_id().as_deref() == Some(id);
        self.release(state, &mut running, id, force).await?;
        let registry = self.profiles_blocking();
        let reset_id = id.to_owned();
        let profile = blocking(move || registry.set_company(&reset_id, None))
            .await
            .unwrap_or(profile);
        if was_active {
            self.start(state, &mut running, &profile).await?;
        }
        Ok(ProfileDto::from(&profile))
    }

    /// [`Desktop::reset`] and then the profile itself.
    pub async fn remove(&self, state: &AppState, id: &str, force: bool) -> CommandResult<()> {
        let mut running = self.running.lock().await;
        self.profile(id).await?;
        self.release(state, &mut running, id, force).await?;
        let registry = self.profiles_blocking();
        let id = id.to_owned();
        blocking(move || registry.remove(&id)).await
    }

    /// Chooses the company of the active profile (one of the signed-in
    /// user's) and restarts it in that company.
    pub async fn select_company(&self, state: &AppState, company: Uuid) -> CommandResult<LoginDto> {
        let id = state.active_profile_id().ok_or_else(no_profile)?;
        let client = state.client()?;
        let me = fetch_me(&client).await?;
        if !me.companies.iter().any(|c| c.id == company) {
            return Err(CommandError::new(
                codes::COMPANY_NOT_AVAILABLE,
                "the signed-in user has no access to this company",
            ));
        }
        let generation = record(&client).await?.generation;
        self.settle_company(state, &id, Some(company), me, generation)
            .await
    }

    // ---- sign-in --------------------------------------------------------

    /// Device sign-in to the active profile, then its user and companies
    /// (`GET /api/v1/auth/me`). With one company (or the stored one still
    /// available) the profile restarts in it; with several the answer says
    /// `company_required`.
    pub async fn login(
        &self,
        state: &AppState,
        email: String,
        password: String,
        two_factor_code: Option<String>,
        device_name: String,
    ) -> CommandResult<LoginDto> {
        let id = state.active_profile_id().ok_or_else(no_profile)?;
        let client = state.client()?;
        let slot = SecretSlot::device_fingerprint(&self.keychain);
        let fingerprint = blocking(move || {
            let value = match slot.get_or_create() {
                // The slot is installation-wide, not part of a profile: no
                // profile reset reaches it. An unreadable one is made again;
                // the server then sees a new device on the next sign-in.
                Err(keystone_secrets::Error::Malformed(_)) => {
                    log::warn!("device fingerprint unreadable; making a new one");
                    slot.remove().and_then(|()| slot.get_or_create())
                }
                other => other,
            };
            value.map(|value| value.to_string()).map_err(secrets_error)
        })
        .await?;
        let request = DeviceLoginRequest {
            email,
            // Moved, not copied: the request zeroes it on drop.
            password,
            two_factor_code: two_factor_code.map(Some),
            device_name,
            fingerprint,
        };
        client.login(&request).await.map_err(token_error)?;
        let generation = record(&client).await?.generation;
        let me = fetch_me(&client).await?;
        let profile = self.profile(&id).await?;
        let company = match profile.company_id {
            Some(current) if me.companies.iter().any(|c| c.id == current) => Some(current),
            _ if me.companies.len() == 1 => Some(me.companies[0].id),
            _ => None,
        };
        self.settle_company(state, &id, company, me, generation)
            .await
    }

    /// The stored sign-in of the active profile (no network).
    pub async fn auth_state(&self, state: &AppState) -> CommandResult<AuthStateDto> {
        let id = state.active_profile_id().ok_or_else(no_profile)?;
        let client = state.client()?;
        let record = record(&client).await?;
        let profile = self.profile(&id).await?;
        Ok(AuthStateDto {
            profile_id: id,
            signed_in: record.tokens.is_some(),
            deactivated: record.deactivated,
            generation: record.generation,
            company_id: profile.company_id,
        })
    }

    /// Signs out of the active profile through its engine (tokens of the
    /// current sign-in, then local data). Unsent work refuses unless `force`.
    pub async fn sign_out(&self, state: &AppState, force: bool) -> CommandResult<SignOutDto> {
        let engine = state.engine()?;
        let outcome = self
            .runtime
            .spawn(async move { engine.sign_out(force).await })
            .await
            .map_err(|_| task_failed())?
            .map_err(token_error)?;
        Ok(match outcome {
            SignOut::Done => SignOutDto::Done,
            SignOut::PendingWork { outbox, conflicts } => {
                SignOutDto::PendingWork { outbox, conflicts }
            }
        })
    }

    // ---- internals ------------------------------------------------------

    async fn profile(&self, id: &str) -> CommandResult<Profile> {
        let registry = self.profiles_blocking();
        let id = id.to_owned();
        blocking(move || registry.get(&id)).await
    }

    fn profiles_blocking(&self) -> Arc<ProfileRegistry> {
        self.profiles.clone()
    }

    /// The session record must be readable before anything opens.
    async fn check_record(&self, id: &str) -> CommandResult<()> {
        let tokens = self.tokens.clone();
        let id = id.to_owned();
        blocking(move || tokens.load_record(&id).map(drop).map_err(token_error)).await
    }

    /// Opens `profile` and makes it active; starts its loop when it has a
    /// company. On a store failure the profile stays active without engine.
    async fn start(
        &self,
        state: &AppState,
        running: &mut Option<Running>,
        profile: &Profile,
    ) -> CommandResult<()> {
        let client = Arc::new(self.client(profile)?);
        state.activate(ActiveProfile {
            id: profile.id.clone(),
            client: client.clone(),
            engine: None,
        });
        let opened = match self.open(profile).await {
            Ok(opened) => opened,
            Err(error) => {
                log::warn!("profile store not opened: {}", error.code);
                return Err(error);
            }
        };
        let (sync, sync_loop) = if profile.company_id.is_some() {
            let (handle, run) = sync_loop(opened.engine.clone());
            (Some(handle), Some(self.runtime.spawn(run.run())))
        } else {
            (None, None)
        };
        let events = self.runtime.spawn(bridge(
            profile.id.clone(),
            opened.engine.subscribe(),
            opened.engine.subscribe_changes(),
            self.sink.clone(),
        ));
        let attached = state.attach(
            &profile.id,
            opened.engine.clone(),
            opened.store.clone(),
            sync.clone(),
        );
        *running = Some(Running { sync_loop, events });
        drop(sync);
        attached.map(drop)
    }

    /// Clients of `profile`: one for direct calls, one inside the engine;
    /// both over the same keychain medium and profile, so one session.
    fn client(&self, profile: &Profile) -> CommandResult<HttpClient> {
        let config = ApiConfig {
            base_url: profile.base_url.clone(),
            company_id: profile.company_id.unwrap_or(Uuid::nil()),
            user_agent: self.user_agent.clone(),
        };
        let client = HttpClient::new(
            &config,
            profile.id.clone(),
            self.tokens.clone(),
            &self.options,
        )?;
        let mut sessions = self
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        sessions.insert(profile.id.clone(), Arc::downgrade(client.session()));
        Ok(client)
    }

    /// The profile's store and engine (blocking work off the async thread).
    async fn open(&self, profile: &Profile) -> CommandResult<Opened> {
        let engine_client = self.client(profile)?;
        let path = self.profile_dir(&profile.id).join(DB_FILE);
        let db_keys = self.db_keys.clone();
        let id = profile.id.clone();
        let (store, engine) = blocking(move || {
            let key = if path.exists() {
                db_keys.get(&id).map_err(secrets_error)?.ok_or_else(|| {
                    CommandError::new(
                        codes::STORE_KEY_INVALID,
                        "the profile's database key is missing from the keychain",
                    )
                })?
            } else {
                if let Some(dir) = path.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| {
                        CommandError::new("STORE_ERROR", format!("profile directory: {}", e.kind()))
                    })?;
                }
                db_keys.get_or_create(&id).map_err(secrets_error)?
            };
            let store = Arc::new(Store::open(&path, &key)?);
            let manifest = offline_manifest(OFFLINE_MANIFEST)?;
            let engine =
                SyncEngine::new(engine_client, store.clone()).with_offline_manifest(manifest);
            // Counts and a stored manifest mismatch show before any run.
            engine.refresh_status()?;
            Ok((store, Arc::new(engine)))
        })
        .await?;
        Ok(Opened { engine, store })
    }

    /// Stops the active profile: out of the state first (no new command
    /// gets it), then its loop and bridge, aborted and awaited.
    async fn stop(&self, state: &AppState, running: &mut Option<Running>) {
        state.deactivate();
        if let Some(tasks) = running.take() {
            if let Some(task) = tasks.sync_loop {
                task.abort();
                let _ = task.await;
            }
            tasks.events.abort();
            let _ = tasks.events.await;
        }
    }

    /// Unsent-work check, close, then delete the keychain records and the
    /// local data of `id`.
    async fn release(
        &self,
        state: &AppState,
        running: &mut Option<Running>,
        id: &str,
        force: bool,
    ) -> CommandResult<()> {
        let active = state.active_profile_id().as_deref() == Some(id);
        if !force {
            let (outbox, conflicts) = if active {
                match state.engine() {
                    Ok(engine) => {
                        let status = blocking(move || Ok(engine.refresh_status()?)).await?;
                        (
                            status.pending + status.rejected + status.quarantined,
                            status.conflicts,
                        )
                    }
                    Err(_) => (0, 0),
                }
            } else {
                self.pending_work_of(id).await
            };
            if outbox + conflicts > 0 {
                return Err(CommandError::new(
                    codes::PROFILE_HAS_PENDING_WORK,
                    format!("{outbox} unsent changes and {conflicts} open conflicts"),
                ));
            }
        }
        if active {
            self.stop(state, running).await;
        }
        // Every client of the profile, active or not, with or without an
        // engine, must be gone: a live session could write its record back.
        let session = self
            .sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(id)
            .cloned();
        if let Some(session) = session
            && let Err(busy) = self.wait_released(&session).await
        {
            // Nothing was deleted: open the profile again, as the file says.
            if active {
                let profile = self.profile(id).await?;
                if let Err(error) = self.start(state, running, &profile).await {
                    log::warn!("profile not reopened: {}", error.code);
                }
            }
            return Err(busy);
        }
        let tokens = self.tokens.clone();
        let db_keys = self.db_keys.clone();
        let dir = self.profile_dir(id);
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(id);
        let id = id.to_owned();
        blocking(move || {
            tokens.remove_profile(&id).map_err(secrets_error)?;
            db_keys.remove(&id).map_err(secrets_error)?;
            match std::fs::remove_dir_all(&dir) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(CommandError::new(
                    "STORE_ERROR",
                    format!("cannot delete the profile data: {}", e.kind()),
                )),
            }
        })
        .await
    }

    /// Unsent work of a profile that is not active (its store opened
    /// briefly). A store that cannot be opened has nothing it can send.
    async fn pending_work_of(&self, id: &str) -> (usize, usize) {
        let Ok(profile) = self.profile(id).await else {
            return (0, 0);
        };
        let path = self.profile_dir(id).join(DB_FILE);
        if !path.exists() {
            return (0, 0);
        }
        let Ok(client) = self.client(&profile) else {
            return (0, 0);
        };
        let db_keys = self.db_keys.clone();
        let id = id.to_owned();
        blocking(move || {
            let key = db_keys.get(&id).ok().flatten();
            let counts = key
                .and_then(|key| Store::open(&path, &key).ok())
                .and_then(|store| {
                    let engine = SyncEngine::new(client, Arc::new(store));
                    engine.refresh_status().ok()
                })
                .map_or((0, 0), |s| {
                    (s.pending + s.rejected + s.quarantined, s.conflicts)
                });
            Ok(counts)
        })
        .await
        .unwrap_or((0, 0))
    }

    /// Waits until no session of the profile is alive (requests still
    /// running hold its client). `PROFILE_BUSY` after `release_wait`.
    async fn wait_released(&self, session: &Weak<Session>) -> CommandResult<()> {
        let deadline = tokio::time::Instant::now() + self.release_wait;
        while session.strong_count() > 0 {
            if tokio::time::Instant::now() >= deadline {
                return Err(CommandError::new(
                    codes::PROFILE_BUSY,
                    "a request of this profile is still running; try again",
                ));
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        Ok(())
    }

    /// Stores `company` for `id` when it changed and restarts the profile
    /// in it; otherwise asks the running loop for a run of the new sign-in.
    async fn settle_company(
        &self,
        state: &AppState,
        id: &str,
        company: Option<Uuid>,
        me: Me,
        generation: u64,
    ) -> CommandResult<LoginDto> {
        let mut running = self.running.lock().await;
        let mut profile = self.profile(id).await?;
        if state.active_profile_id().as_deref() != Some(id) {
            return Err(CommandError::new(
                crate::commands::codes::NO_ACTIVE_PROFILE,
                "the server profile changed during the sign-in",
            ));
        }
        if profile.company_id != company {
            // The new client must build before anything is stopped.
            let candidate = Profile {
                company_id: company,
                ..profile.clone()
            };
            drop(self.client(&candidate)?);
            let registry = self.profiles_blocking();
            let changed_id = id.to_owned();
            profile = blocking(move || registry.set_company(&changed_id, company)).await?;
            self.stop(state, &mut running).await;
            self.start(state, &mut running, &profile).await?;
        } else {
            state.trigger(id, Trigger::Manual)?;
        }
        Ok(LoginDto {
            profile: ProfileDto::from(&profile),
            generation,
            company_required: company.is_none() && !me.companies.is_empty(),
            user: me.user,
            companies: me.companies,
        })
    }
}

/// `GET /api/v1/auth/me`, reduced to what the shell uses.
#[derive(Debug, Clone)]
struct Me {
    user: UserDto,
    companies: Vec<CompanyDto>,
}

async fn fetch_me(client: &HttpClient) -> CommandResult<Me> {
    let body = proxy_json(client, ProxyMethod::Get, "/api/v1/auth/me").await?;
    let data = &body["data"];
    let user: UserDto = serde_json::from_value(data["user"].clone())
        .map_err(|_| CommandError::new("DECODE_ERROR", "unexpected /auth/me answer"))?;
    let companies: Vec<CompanyDto> = serde_json::from_value(data["companies"].clone())
        .map_err(|_| CommandError::new("DECODE_ERROR", "unexpected /auth/me answer"))?;
    Ok(Me { user, companies })
}

/// A proxy call whose answer is JSON on success; an error envelope becomes
/// the server's error (redacted like every other server error).
pub(crate) async fn proxy_json(
    client: &HttpClient,
    method: ProxyMethod,
    path: &str,
) -> CommandResult<Value> {
    let request = ProxyRequest {
        method,
        path: path.to_owned(),
        query: Vec::new(),
        headers: Vec::new(),
        body: None,
    };
    let response = client.proxy(&request).await.map_err(token_error)?;
    answer_json(&response)
}

fn answer_json(response: &ProxyResponse) -> CommandResult<Value> {
    if (200..300).contains(&response.status) {
        if response.body.is_empty() {
            return Ok(Value::Null);
        }
        return serde_json::from_slice(&response.body)
            .map_err(|_| CommandError::new("DECODE_ERROR", "the server answer is not JSON"));
    }
    let retry_after = response
        .header("retry-after")
        .and_then(|value| parse_retry_after(value, std::time::SystemTime::now()));
    match serde_json::from_slice::<ErrorResponse>(&response.body) {
        Ok(body) => Err(SyncError::from_api(response.status, body.errors, retry_after).into()),
        Err(_) => Err(CommandError::new(
            "SERVER_ERROR",
            format!("the server answered {}", response.status),
        )),
    }
}

async fn record(client: &HttpClient) -> CommandResult<SessionRecord> {
    let session = client.session().clone();
    blocking(move || session.record().map_err(token_error)).await
}

/// Crate error to command error, with an unreadable keychain record told
/// apart (`PROFILE_RECORD_MALFORMED`).
pub fn token_error(error: SyncError) -> CommandError {
    if let SyncError::TokenStore(text) = &error
        && is_malformed_text(text)
    {
        return malformed();
    }
    error.into()
}

fn is_malformed_text(text: &str) -> bool {
    ["session record", "db key"].iter().any(|what| {
        text == keystone_secrets::Error::Malformed(what).to_string()
            || text.ends_with(&keystone_secrets::Error::Malformed(what).to_string())
    })
}

fn secrets_error(error: keystone_secrets::Error) -> CommandError {
    match error {
        keystone_secrets::Error::Malformed(_) => malformed(),
        other => SyncError::from(other).into(),
    }
}

fn malformed() -> CommandError {
    CommandError::new(
        codes::PROFILE_RECORD_MALFORMED,
        "a keychain record of this profile cannot be read; reset or remove the profile",
    )
}

fn no_profile() -> CommandError {
    CommandError::new(
        crate::commands::codes::NO_ACTIVE_PROFILE,
        "no server profile is selected",
    )
}

fn task_failed() -> CommandError {
    CommandError::new(codes::TASK_FAILED, "the background task stopped")
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .unwrap_or_else(|_| Err(task_failed()))
}

fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Tauri `setup`: builds the [`Desktop`] (app data directory, native
/// keychain, engine runtime, `engine-event` sink) and selects the stored
/// active profile in the background.
pub fn setup<R: tauri::Runtime>(app: &mut tauri::App<R>) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    let data_dir = app.path().app_data_dir()?;
    let version = app.package_info().version.to_string();
    let config = Config::for_app(data_dir, &version)?;
    let sink = Arc::new(crate::events::TauriSink(app.handle().clone()));
    app.manage(Desktop::new(config, sink)?);
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let desktop = handle.state::<Desktop>();
        let state = handle.state::<AppState>();
        if let Err(error) = desktop.restore(&state).await {
            log::warn!("active profile not restored: {}", error.code);
        }
    });
    Ok(())
}

/// Sends `trigger` to the active profile's sync loop; `Ok(false)` when it
/// has none. The door for other parts of the shell (a proxy call that
/// finds the server again, the realtime bridge).
///
/// Realtime bridge input point: on `.session.revoked` the bridge calls
/// this with `Trigger::Manual` and emits a UI event; it never signs out
/// and never wipes local data (the next run meets the revoked token and
/// the engine turns to `AuthRequired` by itself). A generation-bound
/// token drop (`forget_tokens(generation)`) comes later in the crate.
pub fn trigger(state: &AppState, trigger: Trigger) -> CommandResult<bool> {
    let id = state.active_profile_id().ok_or_else(no_profile)?;
    state.trigger(&id, trigger)
}

#[cfg(test)]
mod tests;
