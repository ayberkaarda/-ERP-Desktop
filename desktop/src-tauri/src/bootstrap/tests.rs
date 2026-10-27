//! Profiles, start-up and sign-in against wiremock servers and the
//! in-memory keychain of `keyring-core`.

use std::sync::atomic::{AtomicU64, Ordering};

use keystone_secrets::keyring_core::api::CredentialStoreApi;
use keystone_secrets::keyring_core::{CredentialStore, mock};
use keystone_sync::engine::SyncState;
use keystone_sync::outbox::NewMutation;
use keystone_sync::store::ListQuery;
use keystone_sync::wire::{MutationOp, ResourceName, Timestamp};
use serde_json::{Map, json};
use wiremock::matchers::{body_partial_json, method, path};
use wiremock::{Mock, MockServer, Request, ResponseTemplate};

use super::*;
use crate::events::{EngineEvent, Recorder};

const COMPANY: &str = "0192f5a0-0000-7000-8000-000000000001";
const COMPANY_2: &str = "0192f5a0-0000-7000-8000-000000000002";
const USER: &str = "0192f5a0-0000-7000-8000-00000000000a";
const ROW: &str = "0192f5a0-0000-7000-8000-0000000000f1";
const EMAIL: &str = "user@example.com";

fn unique(prefix: &str) -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!(
        "{prefix}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

struct Fx {
    dir: tempfile::TempDir,
    mock: Arc<mock::Store>,
    service: String,
    desktop: Desktop,
    state: AppState,
    events: Arc<Recorder>,
}

fn options() -> ClientOptions {
    ClientOptions {
        connect_timeout: Duration::from_secs(2),
        request_timeout: Duration::from_secs(10),
        allow_http_localhost: true,
    }
}

fn fx() -> Fx {
    fx_with(options())
}

fn fx_with(options: ClientOptions) -> Fx {
    let dir = tempfile::tempdir().unwrap();
    let mock = mock::Store::new().unwrap();
    let service = unique("keystone-desktop-test");
    let (desktop, events) = desktop_over(dir.path(), &service, &mock, options);
    Fx {
        dir,
        mock,
        service,
        desktop,
        state: AppState::default(),
        events,
    }
}

fn desktop_over(
    dir: &Path,
    service: &str,
    mock: &Arc<mock::Store>,
    options: ClientOptions,
) -> (Desktop, Arc<Recorder>) {
    let store: Arc<CredentialStore> = mock.clone();
    let config = Config {
        data_dir: dir.to_path_buf(),
        keychain: Keychain::with_store(service, store).unwrap(),
        options,
        user_agent: "keystone-desktop-test".into(),
        app_version: "0.1.0".into(),
        release_wait: Duration::from_millis(300),
    };
    let events = Arc::new(Recorder::default());
    (Desktop::new(config, events.clone()).unwrap(), events)
}

use std::path::Path;

impl Fx {
    /// The credential store's entry for `account`, past the crate.
    fn raw(&self, account: &str) -> Option<Vec<u8>> {
        let entry = self.mock.build(&self.service, account, None).unwrap();
        entry.get_secret().ok()
    }

    fn put_raw(&self, account: &str, value: &[u8]) {
        let entry = self.mock.build(&self.service, account, None).unwrap();
        entry.set_secret(value).unwrap();
    }

    async fn add(&self, server: &MockServer) -> ProfileDto {
        self.desktop.add_profile(&server.uri(), None).await.unwrap()
    }

    async fn login(&self) -> CommandResult<LoginDto> {
        self.login_as(EMAIL).await
    }

    async fn login_as(&self, email: &str) -> CommandResult<LoginDto> {
        self.desktop
            .login(
                &self.state,
                email.into(),
                "secret".into(),
                None,
                "OFFICE-PC".into(),
            )
            .await
    }

    fn record(&self) -> SessionRecord {
        self.state.client().unwrap().session().record().unwrap()
    }
}

fn meta(min_version: &str, min_schema: u32) -> Value {
    json!({"data": {
        "name": "Keystone Test", "version": "1.4.0", "api_version": "v1",
        "reverb": {"host": "ws.example.com", "port": 443, "scheme": "https", "key": "public-key"},
        "desktop": {"min_version": min_version, "update_channel": null},
        "sync": {"schema_version": 1, "min_schema_version": min_schema}
    }})
}

fn token_body(n: u32) -> Value {
    json!({"data": {
        "token": format!("access-{n}-0123456789abcdef"),
        "expires_at": "2026-10-27T10:15:00+03:00",
        "refresh_token": format!("refresh-{n}-0123456789abcdef"),
        "refresh_expires_at": "2026-11-26T09:15:00+03:00"
    }})
}

fn me_body(companies: &[(&str, &str)]) -> Value {
    let companies: Vec<Value> = companies
        .iter()
        .map(|(id, name)| json!({"id": id, "name": name, "role_names": []}))
        .collect();
    json!({"data": {
        "user": {"id": USER, "name": "Ayşe", "email": EMAIL, "locale": "tr",
                 "is_super_admin": false, "must_change_password": false,
                 "two_factor_enabled": false},
        "companies": companies,
        "permissions": {}
    }})
}

fn manifest() -> Value {
    json!({"data": {
        "schema_version": 1, "min_schema_version": 1, "offline_manifest_version": 2,
        "server_time": "2026-10-27T09:15:00+03:00",
        "company_id": COMPANY, "user_id": USER,
        "device_id": "0192f5a0-0000-7000-8000-0000000000d1",
        "permissions": [],
        "resources": [{
            "resource": "parties", "scope": "company", "visibility_generation": 0,
            "read": "local-first", "source": "pull", "window_days": null,
            "writable": ["create", "update", "delete"]
        }],
        "online_only": [],
        "limits": {"pull_resources_max": 10, "pull_page_default": 200, "pull_page_max": 1000,
                   "push_batch_max": 100, "tombstone_retention_days": 90,
                   "idempotency_retention_days": 7}
    }, "meta": {}})
}

fn pull(request: &Request) -> ResponseTemplate {
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    let pages: Vec<Value> = body["resources"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|r| {
            json!({
                "resource": r["resource"],
                "rows": [{"id": ROW, "version": 1, "name": "Acme"}],
                "tombstones": [],
                "next_cursor": {"txid": "1000", "after_id": null, "gen": 0, "session": null},
                "has_more": false,
                "reset": false
            })
        })
        .collect();
    ResponseTemplate::new(200).set_body_json(json!({
        "data": {"horizon": "1000", "server_time": "2026-10-27T09:15:00+03:00", "resources": pages},
        "meta": {}
    }))
}

/// A server that answers meta, sign-in (token `n` per sign-in), `/auth/me`
/// with `companies`, the manifest and pulls.
async fn server(companies: &[(&str, &str)]) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/meta"))
        .respond_with(ResponseTemplate::new(200).set_body_json(meta("0.1.0", 1)))
        .mount(&server)
        .await;
    let next = Arc::new(AtomicU64::new(1));
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/device"))
        .and(body_partial_json(json!({"email": EMAIL})))
        .respond_with(move |_: &Request| {
            let n = next.fetch_add(1, Ordering::SeqCst);
            ResponseTemplate::new(200).set_body_json(token_body(u32::try_from(n).unwrap()))
        })
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_body(companies)))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/sync/manifest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(manifest()))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/v1/sync/pull"))
        .respond_with(pull)
        .mount(&server)
        .await;
    server
}

async fn requests(server: &MockServer, p: &str) -> Vec<Request> {
    server
        .received_requests()
        .await
        .unwrap_or_default()
        .into_iter()
        .filter(|r| r.url.path() == p)
        .collect()
}

async fn eventually(what: &str, mut check: impl AsyncFnMut() -> bool) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while !check().await {
        assert!(tokio::time::Instant::now() < deadline, "timed out: {what}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn parties() -> ResourceName {
    ResourceName("parties".into())
}

/// Added, selected, signed in (one company), first run pulled `ROW`.
async fn synced(fx: &Fx, server: &MockServer) -> ProfileDto {
    let profile = fx.add(server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    fx.login().await.unwrap();
    let id = profile.id.clone();
    fx.events
        .wait_for(|e| {
            matches!(e, EngineEvent::ResourcesChanged { profile_id, resources, .. }
                if *profile_id == id && resources.iter().any(|r| r == "parties"))
        })
        .await;
    profile
}

fn rows(fx: &Fx) -> usize {
    fx.state
        .engine()
        .unwrap()
        .list(&parties(), &ListQuery::default())
        .map(|page| page.rows.len())
        .unwrap_or(0)
}

fn draft() -> NewMutation {
    let mut payload = Map::new();
    payload.insert("name".into(), json!("Draft Ltd"));
    NewMutation {
        op: MutationOp::Create,
        action: None,
        resource: parties(),
        id: Uuid::now_v7(),
        parent_id: None,
        base_version: None,
        payload,
        depends_on: vec![],
        occurred_at: Timestamp("2026-10-27T09:10:00+03:00".into()),
        resolution: None,
    }
}

// ---- profile_add ----------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn adding_a_profile_stores_the_server_meta_without_secrets() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;

    assert_eq!(profile.name, "Keystone Test");
    assert_eq!(profile.base_url, server.uri());
    assert!(profile.realtime);
    assert_eq!(profile.company_id, None);
    assert!(Uuid::parse_str(&profile.id).unwrap().get_version_num() == 7);

    let file = fx.desktop.registry().load().unwrap();
    let stored = file.get(&profile.id).unwrap();
    assert_eq!(
        stored.meta_snapshot.reverb.key.as_deref(),
        Some("public-key")
    );
    assert_eq!(stored.meta_snapshot.sync.min_schema_version, 1);
    assert_eq!(file.active, None);
    // Adding opens nothing: no keychain record, no database.
    assert_eq!(fx.raw(&profile.id), None);
    assert!(!fx.desktop.profile_dir(&profile.id).exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_that_needs_a_newer_app_is_refused() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/meta"))
        .respond_with(ResponseTemplate::new(200).set_body_json(meta("0.2.0", 1)))
        .mount(&server)
        .await;
    let fx = fx();
    let error = fx
        .desktop
        .add_profile(&server.uri(), None)
        .await
        .unwrap_err();
    assert_eq!(error.code, codes::DESKTOP_UPDATE_REQUIRED);
    assert!(fx.desktop.registry().load().unwrap().profiles.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_that_needs_a_newer_sync_schema_is_refused() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/api/v1/meta"))
        .respond_with(ResponseTemplate::new(200).set_body_json(meta("0.1.0", SCHEMA_VERSION + 1)))
        .mount(&server)
        .await;
    let fx = fx();
    let error = fx
        .desktop
        .add_profile(&server.uri(), None)
        .await
        .unwrap_err();
    assert_eq!(error.code, codes::SYNC_SCHEMA_MISMATCH);
    assert!(fx.desktop.registry().load().unwrap().profiles.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn plain_http_needs_the_debug_opt_in() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx_with(ClientOptions {
        allow_http_localhost: false,
        ..options()
    });
    let error = fx
        .desktop
        .add_profile(&server.uri(), None)
        .await
        .unwrap_err();
    assert_eq!(error.code, "INVALID_SERVER_URL");
    assert!(requests(&server, "/api/v1/meta").await.is_empty());
}

#[test]
fn http_is_allowed_only_in_debug_builds_with_the_variable() {
    assert!(allow_http_with(true, Some("1")));
    assert!(!allow_http_with(true, None));
    assert!(!allow_http_with(true, Some("true")));
    assert!(!allow_http_with(false, Some("1")));
    assert_eq!(
        allow_http(),
        cfg!(debug_assertions) && std::env::var(DEV_ALLOW_HTTP_ENV).as_deref() == Ok("1")
    );
}

// ---- start-up, sign-in, loop ---------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn start_up_signs_in_then_pulls_through_the_manifest() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;

    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    // No company yet: the engine exists, the loop does not run.
    assert!(fx.state.engine().is_ok());
    assert_eq!(fx.state.trigger(&profile.id, Trigger::Manual), Ok(false));
    assert!(fx.desktop.profile_dir(&profile.id).join(DB_FILE).exists());
    assert!(fx.raw(&format!("db-key:{}", profile.id)).is_some());

    let login = fx.login().await.unwrap();
    assert_eq!(login.generation, 1);
    assert_eq!(login.profile.company_id, Some(COMPANY.parse().unwrap()));
    assert!(!login.company_required);
    assert_eq!(login.user.email, EMAIL);

    let id = profile.id.clone();
    fx.events
        .wait_for(|e| {
            matches!(e, EngineEvent::ResourcesChanged { profile_id, resources, .. }
                if *profile_id == id && resources == &["parties".to_owned()])
        })
        .await;
    assert_eq!(rows(&fx), 1);
    assert_eq!(requests(&server, "/api/v1/sync/manifest").await.len(), 1);
    let manifest = &requests(&server, "/api/v1/sync/manifest").await[0];
    assert_eq!(
        manifest
            .headers
            .get("x-company-id")
            .unwrap()
            .to_str()
            .unwrap(),
        COMPANY
    );
    assert_eq!(
        manifest
            .headers
            .get("authorization")
            .unwrap()
            .to_str()
            .unwrap(),
        "Bearer access-1-0123456789abcdef"
    );
    let device: Value =
        serde_json::from_slice(&requests(&server, "/api/v1/auth/device").await[0].body).unwrap();
    assert_eq!(device["device_name"], "OFFICE-PC");
    assert_eq!(device["fingerprint"].as_str().unwrap().len(), 64);
    // The company is stored with the profile.
    let stored = fx.desktop.registry().get(&profile.id).unwrap();
    assert_eq!(stored.company_id, Some(COMPANY.parse().unwrap()));
    assert_eq!(
        fx.desktop.registry().load().unwrap().active.as_deref(),
        Some(id.as_str())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn every_sign_in_starts_a_new_generation_with_the_same_fingerprint() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    synced(&fx, &server).await;
    assert_eq!(fx.record().generation, 1);

    let again = fx.login().await.unwrap();
    assert_eq!(again.generation, 2);
    assert_eq!(fx.record().generation, 2);
    let bodies: Vec<Value> = requests(&server, "/api/v1/auth/device")
        .await
        .iter()
        .map(|r| serde_json::from_slice(&r.body).unwrap())
        .collect();
    assert_eq!(bodies[0]["fingerprint"], bodies[1]["fingerprint"]);
    // The same company: the loop is asked for a run of the new sign-in.
    eventually("a run with the new token", async || {
        requests(&server, "/api/v1/sync/manifest")
            .await
            .iter()
            .any(|r| r.headers.get("authorization").unwrap() == "Bearer access-2-0123456789abcdef")
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn several_companies_wait_for_a_choice() {
    let server = server(&[(COMPANY, "Acme"), (COMPANY_2, "Beta")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();

    let login = fx.login().await.unwrap();
    assert!(login.company_required);
    assert_eq!(login.companies.len(), 2);
    assert_eq!(login.profile.company_id, None);
    assert_eq!(fx.state.trigger(&profile.id, Trigger::Manual), Ok(false));

    let unknown = fx
        .desktop
        .select_company(&fx.state, Uuid::now_v7())
        .await
        .unwrap_err();
    assert_eq!(unknown.code, codes::COMPANY_NOT_AVAILABLE);

    let chosen = fx
        .desktop
        .select_company(&fx.state, COMPANY_2.parse().unwrap())
        .await
        .unwrap();
    assert_eq!(chosen.profile.company_id, Some(COMPANY_2.parse().unwrap()));
    assert!(!chosen.company_required);
    eventually("a manifest in the chosen company", async || {
        requests(&server, "/api/v1/sync/manifest")
            .await
            .iter()
            .any(|r| r.headers.get("x-company-id").unwrap() == COMPANY_2)
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn the_loop_and_sign_out_run_on_the_engine_runtime() {
    let fx = fx();
    let name = fx
        .desktop
        .runtime()
        .spawn(async { std::thread::current().name().map(str::to_owned) })
        .await
        .unwrap();
    assert_eq!(name.as_deref(), Some(crate::runtime::THREAD_NAME));
}

#[tokio::test(flavor = "multi_thread")]
async fn switching_profiles_switches_session_server_and_loop() {
    let a = server(&[(COMPANY, "Acme")]).await;
    let b = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let pa = synced(&fx, &a).await;
    let pb = synced(&fx, &b).await;

    // B is active: its client, its session, its server.
    let client = fx.state.client().unwrap();
    assert_eq!(client.session().profile(), pb.id);
    assert_eq!(
        client.session().store().identity(),
        format!("keychain:{}", fx.service)
    );
    assert_eq!(
        fx.state.active_profile_id().as_deref(),
        Some(pb.id.as_str())
    );

    fx.desktop.select(&fx.state, &pa.id).await.unwrap();
    let client = fx.state.client().unwrap();
    assert_eq!(client.session().profile(), pa.id);
    assert_eq!(client.server().origin(), a.uri());
    let record = fx.record();
    assert_eq!(record.generation, 1);
    assert!(record.tokens.is_some());

    // Only A's loop runs now: a manual run reaches A, B hears nothing.
    let b_before = requests(&b, "/api/v1/sync/manifest").await.len();
    let a_before = requests(&a, "/api/v1/sync/manifest").await.len();
    crate::commands::sync::now(&fx.state).unwrap();
    eventually("a run on A", async || {
        requests(&a, "/api/v1/sync/manifest").await.len() > a_before
    })
    .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(requests(&b, "/api/v1/sync/manifest").await.len(), b_before);
    assert_eq!(rows(&fx), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_stored_active_profile_is_selected_at_start_up() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;

    let (again, _events) = desktop_over(fx.dir.path(), &fx.service, &fx.mock, options());
    // The first desktop's loop is stopped as the app would on exit.
    fx.desktop
        .stop(&fx.state, &mut *fx.desktop.running.lock().await)
        .await;
    let state = AppState::default();
    let restored = again.restore(&state).await.unwrap().unwrap();
    assert_eq!(restored.id, profile.id);
    assert_eq!(
        state.active_profile_id().as_deref(),
        Some(profile.id.as_str())
    );
    let record = state.client().unwrap().session().record().unwrap();
    assert!(record.tokens.is_some());
}

// ---- sign-out --------------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn sign_out_refuses_pending_work_unless_forced() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    synced(&fx, &server).await;
    fx.state.engine().unwrap().enqueue(draft()).unwrap();

    let refused = fx.desktop.sign_out(&fx.state, false).await.unwrap();
    assert_eq!(
        refused,
        SignOutDto::PendingWork {
            outbox: 1,
            conflicts: 0
        }
    );
    assert!(fx.record().tokens.is_some());
    // The mirror row and the draft laid over the list.
    assert_eq!(rows(&fx), 2);

    let done = fx.desktop.sign_out(&fx.state, true).await.unwrap();
    assert_eq!(done, SignOutDto::Done);
    let record = fx.record();
    assert!(record.tokens.is_none());
    assert_eq!(record.generation, 1);
    assert_eq!(
        fx.state.engine().unwrap().status().state,
        SyncState::AuthRequired
    );
    let state = fx.desktop.auth_state(&fx.state).await.unwrap();
    assert!(!state.signed_in);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stale_deactivation_keeps_the_new_sign_in_and_the_local_data() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let late = "late@example.com";
    Mock::given(method("POST"))
        .and(path("/api/v1/auth/device"))
        .and(body_partial_json(json!({"email": late})))
        .respond_with(
            ResponseTemplate::new(403)
                .set_body_json(json!({"errors": {"code": "USER_DEACTIVATED", "message": "x"}}))
                .set_delay(Duration::from_millis(600)),
        )
        .mount(&server)
        .await;
    let fx = fx();
    let profile = synced(&fx, &server).await;

    // The late answer belongs to generation 1; a sign-in completes meanwhile.
    let (stale, fresh) = tokio::join!(fx.login_as(late), async {
        tokio::time::sleep(Duration::from_millis(150)).await;
        fx.login().await
    });
    assert_eq!(stale.unwrap_err().code, "USER_DEACTIVATED");
    assert_eq!(fresh.unwrap().generation, 2);

    let record = fx.record();
    assert!(!record.deactivated);
    assert!(record.tokens.is_some());
    assert!(fx.desktop.profile_dir(&profile.id).join(DB_FILE).exists());
    eventually("the new sign-in reads local data", async || rows(&fx) == 1).await;
}

// ---- remove and reset --------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn removing_a_profile_waits_for_its_session_then_clears_keychain_and_data() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let id = profile.id.clone();
    assert!(fx.raw(&id).is_some());
    assert!(fx.raw(&format!("db-key:{id}")).is_some());

    // A request still holds the profile's client: nothing is deleted.
    let in_flight = fx.state.client().unwrap();
    let busy = fx.desktop.remove(&fx.state, &id, false).await.unwrap_err();
    assert_eq!(busy.code, codes::PROFILE_BUSY);
    assert!(fx.raw(&id).is_some());
    assert!(fx.desktop.registry().get(&id).is_ok());
    drop(in_flight);

    fx.desktop.remove(&fx.state, &id, false).await.unwrap();
    assert_eq!(fx.raw(&id), None);
    assert_eq!(fx.raw(&format!("db-key:{id}")), None);
    assert!(!fx.desktop.profile_dir(&id).exists());
    assert_eq!(
        fx.desktop.registry().get(&id).unwrap_err().code,
        codes::PROFILE_NOT_FOUND
    );
    assert_eq!(fx.desktop.registry().load().unwrap().active, None);
    assert_eq!(fx.state.active_profile_id(), None);
    // Nothing of the profile is left to write its record back.
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(fx.raw(&id), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_a_profile_with_unsent_work_needs_force() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    fx.state.engine().unwrap().enqueue(draft()).unwrap();

    let refused = fx
        .desktop
        .remove(&fx.state, &profile.id, false)
        .await
        .unwrap_err();
    assert_eq!(refused.code, codes::PROFILE_HAS_PENDING_WORK);
    assert!(fx.raw(&profile.id).is_some());
    assert_eq!(
        fx.state.active_profile_id().as_deref(),
        Some(profile.id.as_str())
    );

    fx.desktop
        .remove(&fx.state, &profile.id, true)
        .await
        .unwrap();
    assert_eq!(fx.raw(&profile.id), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_inactive_profile_with_unsent_work_needs_force_too() {
    let a = server(&[(COMPANY, "Acme")]).await;
    let b = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let pa = synced(&fx, &a).await;
    fx.state.engine().unwrap().enqueue(draft()).unwrap();
    synced(&fx, &b).await;

    let refused = fx
        .desktop
        .remove(&fx.state, &pa.id, false)
        .await
        .unwrap_err();
    assert_eq!(refused.code, codes::PROFILE_HAS_PENDING_WORK);
    fx.desktop.remove(&fx.state, &pa.id, true).await.unwrap();
    assert_eq!(fx.raw(&pa.id), None);
    assert_eq!(fx.raw(&format!("db-key:{}", pa.id)), None);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_malformed_session_record_is_reported_and_reset_clears_it() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let first = synced(&fx, &server).await;
    let second = fx.add(&server).await;
    fx.put_raw(&second.id, b"{\"generation\": \"x\", \"tokens\": 3}");

    let error = fx.desktop.select(&fx.state, &second.id).await.unwrap_err();
    assert_eq!(error.code, codes::PROFILE_RECORD_MALFORMED);
    // Nothing changed: the first profile is still active and syncing.
    assert_eq!(
        fx.state.active_profile_id().as_deref(),
        Some(first.id.as_str())
    );
    assert!(fx.state.engine().is_ok());

    fx.desktop
        .reset(&fx.state, &second.id, false)
        .await
        .unwrap();
    assert_eq!(fx.raw(&second.id), None);
    fx.desktop.select(&fx.state, &second.id).await.unwrap();
    let state = fx.desktop.auth_state(&fx.state).await.unwrap();
    assert!(!state.signed_in);
    assert_eq!(state.profile_id, second.id);
}

#[test]
fn malformed_keychain_records_have_their_own_code() {
    for what in ["session record", "db key", "secret slot"] {
        let error = keystone_secrets::Error::Malformed(what);
        let through_sync = token_error(SyncError::from(keystone_secrets::Error::Malformed(what)));
        assert_eq!(through_sync.code, codes::PROFILE_RECORD_MALFORMED, "{what}");
        assert_eq!(secrets_error(error).code, codes::PROFILE_RECORD_MALFORMED);
    }
    assert!(malformed().message.contains("reset or remove"));
    let other = token_error(SyncError::TokenStore("keychain: locked".into()));
    assert_eq!(other.code, "TOKEN_STORE_ERROR");
    let other = secrets_error(keystone_secrets::Error::Keychain("locked".into()));
    assert_eq!(other.code, "TOKEN_STORE_ERROR");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_existing_database_without_its_key_is_never_given_a_new_key() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    let dir = fx.desktop.profile_dir(&profile.id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(DB_FILE), b"an encrypted database").unwrap();

    let error = fx.desktop.select(&fx.state, &profile.id).await.unwrap_err();
    assert_eq!(error.code, codes::STORE_KEY_INVALID);
    assert_eq!(fx.raw(&format!("db-key:{}", profile.id)), None);
    assert!(dir.join(DB_FILE).exists());
    // Active without engine: online requests still work.
    assert!(fx.state.client().is_ok());
    assert_eq!(
        fx.state.engine().unwrap_err().code,
        crate::commands::codes::ENGINE_UNAVAILABLE
    );

    fx.desktop
        .reset(&fx.state, &profile.id, false)
        .await
        .unwrap();
    assert!(fx.state.engine().is_ok());
    assert!(fx.raw(&format!("db-key:{}", profile.id)).is_some());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_malformed_database_key_asks_for_a_reset() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let other = fx.add(&server).await;
    fx.desktop.select(&fx.state, &other.id).await.unwrap();
    fx.put_raw(&format!("db-key:{}", profile.id), b"zz");

    let error = fx.desktop.select(&fx.state, &profile.id).await.unwrap_err();
    assert_eq!(error.code, codes::PROFILE_RECORD_MALFORMED);
    assert_eq!(
        fx.raw(&format!("db-key:{}", profile.id)).as_deref(),
        Some(&b"zz"[..])
    );
}

// ---- devices ------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn devices_are_listed_and_revoked_through_the_proxy() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let device = "0192f5a0-0000-7000-8000-0000000000d1";
    Mock::given(method("GET"))
        .and(path("/api/v1/me/devices"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"data": [{
            "id": device, "name": "OFFICE-PC", "ip_address": "10.0.0.1",
            "user_agent": "Keystone-Desktop/0.1.0", "last_used_at": null,
            "expires_at": "2026-11-26T09:15:00+03:00", "created_at": "2026-10-27T09:15:00+03:00"
        }]})))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(format!("/api/v1/me/devices/{device}")))
        .respond_with(ResponseTemplate::new(204))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path(
            "/api/v1/me/devices/0192f5a0-0000-7000-8000-0000000000d2",
        ))
        .respond_with(
            ResponseTemplate::new(404).set_body_json(
                json!({"errors": {"code": "NOT_FOUND", "message": "no such device"}}),
            ),
        )
        .mount(&server)
        .await;
    let fx = fx();
    synced(&fx, &server).await;

    let devices = crate::commands::auth::devices_list(&fx.state)
        .await
        .unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].name, "OFFICE-PC");
    crate::commands::auth::devices_revoke(&fx.state, device.parse().unwrap())
        .await
        .unwrap();
    let missing = crate::commands::auth::devices_revoke(
        &fx.state,
        "0192f5a0-0000-7000-8000-0000000000d2".parse().unwrap(),
    )
    .await
    .unwrap_err();
    assert_eq!(missing.code, "NOT_FOUND");
    let listed = requests(&server, "/api/v1/me/devices").await;
    assert_eq!(
        listed[0].headers.get("authorization").unwrap(),
        "Bearer access-1-0123456789abcdef"
    );
}

// ---- sync commands --------------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn outbox_and_status_commands_answer_from_the_engine() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    synced(&fx, &server).await;
    fx.state.engine().unwrap().enqueue(draft()).unwrap();

    let status = crate::commands::sync::status(&fx.state).await.unwrap();
    assert_eq!(status.pending, 1);
    let state = AppState::default();
    assert_eq!(
        crate::commands::sync::now(&state).unwrap_err().code,
        crate::commands::codes::NO_ACTIVE_PROFILE
    );
}

// ---- manual round on the real keychain ----------------------------------------

/// Two profiles on the Windows Credential Manager: sign in to both, switch
/// back and forth, then remove both and the fingerprint slot. Run by hand:
/// `cargo test -p keystone-desktop --lib native_two_profiles -- --ignored --nocapture`,
/// then `cmdkey /list | findstr keystone-manual` must print nothing.
#[cfg(windows)]
#[tokio::test(flavor = "multi_thread")]
#[ignore = "writes to the Windows Credential Manager"]
async fn native_two_profiles_switch_on_the_credential_manager() {
    let a = server(&[(COMPANY, "Acme")]).await;
    let b = server(&[(COMPANY, "Acme")]).await;
    let dir = tempfile::tempdir().unwrap();
    let service = unique("keystone-manual");
    let keychain = Keychain::native(&service).unwrap();
    let events = Arc::new(Recorder::default());
    let desktop = Desktop::new(
        Config {
            data_dir: dir.path().to_path_buf(),
            keychain: keychain.clone(),
            options: options(),
            user_agent: "keystone-desktop-test".into(),
            app_version: "0.1.0".into(),
            release_wait: Duration::from_secs(2),
        },
        events.clone(),
    )
    .unwrap();
    let state = AppState::default();
    let mut ids = Vec::new();
    for server in [&a, &b] {
        let profile = desktop.add_profile(&server.uri(), None).await.unwrap();
        desktop.select(&state, &profile.id).await.unwrap();
        let login = desktop
            .login(
                &state,
                EMAIL.into(),
                "secret".into(),
                None,
                "OFFICE-PC".into(),
            )
            .await
            .unwrap();
        println!("signed in {} generation {}", profile.id, login.generation);
        let id = profile.id.clone();
        events
            .wait_for(|e| matches!(e, EngineEvent::ResourcesChanged { profile_id, .. } if *profile_id == id))
            .await;
        ids.push(profile.id);
    }
    for id in [&ids[0], &ids[1], &ids[0]] {
        desktop.select(&state, id).await.unwrap();
        let client = state.client().unwrap();
        let record = client.session().record().unwrap();
        println!(
            "active {} server {} identity {} generation {} signed_in {}",
            client.session().profile(),
            client.server().origin(),
            client.session().store().identity(),
            record.generation,
            record.tokens.is_some()
        );
        assert_eq!(client.session().profile(), id.as_str());
        assert!(record.tokens.is_some());
    }
    for id in &ids {
        desktop.remove(&state, id, true).await.unwrap();
        assert!(
            KeychainTokenStore::new(&keychain)
                .load_record(id)
                .unwrap()
                .tokens
                .is_none()
        );
        assert!(DbKeyStore::new(&keychain).get(id).unwrap().is_none());
    }
    SecretSlot::device_fingerprint(&keychain).remove().unwrap();
    println!("removed both profiles of service {service}");
}
