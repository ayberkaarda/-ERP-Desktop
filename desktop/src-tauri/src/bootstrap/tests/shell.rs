//! D4 shell follow-ups in the running shell: the profile state, the company
//! switch guard, connectivity news, the snapshot refresh, meta refresh and
//! `open_external`, against wiremock servers.

use std::sync::Mutex;

use wiremock::matchers::header;

use super::*;
use crate::commands::external::{Opener, open_with};
use crate::dto::external::ExternalTarget;
use crate::dto::profile::{ProfilePhase, ProfileStateDto};
use crate::dto::realtime::RealtimeStateDto;

const BALANCES: &str = "/api/v1/stock-balances";

fn phases(fx: &Fx) -> Vec<(ProfilePhase, Option<String>, Option<String>)> {
    fx.events
        .states()
        .into_iter()
        .map(|s| (s.phase, s.profile_id, s.error.map(|e| e.code)))
        .collect()
}

fn told(
    phase: ProfilePhase,
    id: Option<&str>,
    code: Option<&str>,
) -> (ProfilePhase, Option<String>, Option<String>) {
    (phase, id.map(str::to_owned), code.map(str::to_owned))
}

/// A second desktop over the data of `fx`, as after a restart of the app
/// (the first one's tasks stopped as on exit).
async fn restarted(fx: &Fx) -> (Desktop, Arc<Recorder>) {
    fx.desktop
        .stop(&fx.state, &mut *fx.desktop.running.lock().await)
        .await;
    let (again, events, _) = desktop_over(fx.dir.path(), &fx.service, &fx.mock, options());
    (again, events)
}

fn states_of(events: &Recorder) -> Vec<(ProfilePhase, Option<String>, Option<String>)> {
    events
        .states()
        .into_iter()
        .map(|s| (s.phase, s.profile_id, s.error.map(|e| e.code)))
        .collect()
}

// ---- profile_state ------------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_tells_starting_then_ready() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let (again, events) = restarted(&fx).await;
    assert_eq!(again.profile_state().phase, ProfilePhase::None);

    again.mark_starting();
    let state = AppState::default();
    again.restore(&state).await.unwrap();
    let id = Some(profile.id.as_str());
    assert_eq!(
        states_of(&events),
        [
            told(ProfilePhase::Starting, None, None),
            told(ProfilePhase::Starting, id, None),
            told(ProfilePhase::Ready, id, None),
        ]
    );
    assert_eq!(
        again.profile_state(),
        ProfileStateDto::new(ProfilePhase::Ready, id, None)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restore_without_a_profile_tells_none() {
    let fx = fx();
    fx.desktop.mark_starting();
    // A state is told once, not again when it is the same.
    fx.desktop.mark_starting();
    assert_eq!(fx.desktop.restore(&fx.state).await.unwrap(), None);
    assert_eq!(
        phases(&fx),
        [
            told(ProfilePhase::Starting, None, None),
            told(ProfilePhase::None, None, None),
        ]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_malformed_session_record_fails_the_restore_and_a_reset_opens_it() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.registry().set_active(Some(&profile.id)).unwrap();
    fx.put_raw(&profile.id, b"{\"generation\": \"x\"}");

    fx.desktop.mark_starting();
    let error = fx.desktop.restore(&fx.state).await.unwrap_err();
    assert_eq!(error.code, codes::PROFILE_RECORD_MALFORMED);
    let id = Some(profile.id.as_str());
    assert_eq!(
        phases(&fx),
        [
            told(ProfilePhase::Starting, None, None),
            told(
                ProfilePhase::Failed,
                id,
                Some(codes::PROFILE_RECORD_MALFORMED)
            ),
        ]
    );
    assert_eq!(fx.state.active_profile_id(), None);
    // Removing another profile leaves the failure on screen.
    let other = fx.add(&server).await;
    fx.desktop.remove(&fx.state, &other.id, true).await.unwrap();
    assert_eq!(fx.desktop.profile_state().phase, ProfilePhase::Failed);

    // The way out the UI offers: reset, and the profile opens signed out.
    fx.events.clear_states();
    fx.desktop
        .reset(&fx.state, &profile.id, true)
        .await
        .unwrap();
    assert_eq!(
        phases(&fx),
        [
            told(ProfilePhase::Starting, id, None),
            told(ProfilePhase::Ready, id, None),
        ]
    );
    assert_eq!(fx.state.active_profile_id().as_deref(), id);
    assert_eq!(fx.desktop.registry().load().unwrap().active.as_deref(), id);
    assert!(!fx.desktop.auth_state(&fx.state).await.unwrap().signed_in);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_lost_database_key_leaves_the_profile_engineless() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.registry().set_active(Some(&profile.id)).unwrap();
    let dir = fx.desktop.profile_dir(&profile.id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(DB_FILE), b"an encrypted database").unwrap();

    let error = fx.desktop.restore(&fx.state).await.unwrap_err();
    assert_eq!(error.code, codes::STORE_KEY_INVALID);
    let id = Some(profile.id.as_str());
    assert_eq!(
        phases(&fx),
        [
            told(ProfilePhase::Starting, id, None),
            told(ProfilePhase::Engineless, id, Some(codes::STORE_KEY_INVALID)),
        ]
    );
    // Online requests still have their profile.
    assert_eq!(fx.state.active_profile_id().as_deref(), id);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unreadable_profile_file_fails_the_restore() {
    let fx = fx();
    std::fs::write(fx.desktop.registry().path(), b"not json").unwrap();
    let error = fx.desktop.restore(&fx.state).await.unwrap_err();
    assert_eq!(error.code, codes::PROFILES_FILE_INVALID);
    assert_eq!(
        phases(&fx),
        [told(
            ProfilePhase::Failed,
            None,
            Some(codes::PROFILES_FILE_INVALID)
        )]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn removing_the_active_profile_tells_none_and_a_failed_switch_changes_nothing() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let broken = fx.add(&server).await;
    fx.put_raw(&broken.id, b"zz");
    fx.events.clear_states();

    // The open profile stays as it was: nothing to tell.
    let error = fx.desktop.select(&fx.state, &broken.id).await.unwrap_err();
    assert_eq!(error.code, codes::PROFILE_RECORD_MALFORMED);
    assert!(phases(&fx).is_empty());
    assert_eq!(fx.desktop.profile_state().phase, ProfilePhase::Ready);

    // Removing another profile does not touch the state either.
    fx.desktop
        .remove(&fx.state, &broken.id, true)
        .await
        .unwrap();
    assert!(phases(&fx).is_empty());

    fx.desktop
        .remove(&fx.state, &profile.id, true)
        .await
        .unwrap();
    assert_eq!(phases(&fx), [told(ProfilePhase::None, None, None)]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_company_change_restarts_through_starting() {
    let server = server(&[(COMPANY, "Acme"), (COMPANY_2, "Beta")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    fx.login().await.unwrap();
    fx.events.clear_states();
    fx.desktop
        .select_company(&fx.state, COMPANY.parse().unwrap(), false)
        .await
        .unwrap();
    let id = Some(profile.id.as_str());
    assert_eq!(
        phases(&fx),
        [
            told(ProfilePhase::Starting, id, None),
            told(ProfilePhase::Ready, id, None),
        ]
    );
}

// ---- company switch guard -------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn a_company_change_with_unsent_work_needs_force() {
    let server = server(&[(COMPANY, "Acme"), (COMPANY_2, "Beta")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    fx.login().await.unwrap();
    fx.desktop
        .select_company(&fx.state, COMPANY.parse().unwrap(), false)
        .await
        .unwrap();
    let id = profile.id.clone();
    fx.events
        .wait_for(
            |e| matches!(e, EngineEvent::ResourcesChanged { profile_id, .. } if *profile_id == id),
        )
        .await;
    fx.state.engine().unwrap().enqueue(draft()).unwrap();

    let refused = fx
        .desktop
        .select_company(&fx.state, COMPANY_2.parse().unwrap(), false)
        .await
        .unwrap_err();
    assert_eq!(refused.code, codes::PROFILE_HAS_PENDING_WORK);
    assert_eq!(
        fx.desktop.registry().get(&id).unwrap().company_id,
        Some(COMPANY.parse().unwrap())
    );
    assert_eq!(fx.state.engine().unwrap().status().pending, 1);

    // The same company again: nothing is restarted, nothing to guard.
    let same = fx
        .desktop
        .select_company(&fx.state, COMPANY.parse().unwrap(), false)
        .await
        .unwrap();
    assert_eq!(same.profile.company_id, Some(COMPANY.parse().unwrap()));
    assert_eq!(fx.state.engine().unwrap().status().pending, 1);

    let forced = fx
        .desktop
        .select_company(&fx.state, COMPANY_2.parse().unwrap(), true)
        .await
        .unwrap();
    assert_eq!(forced.profile.company_id, Some(COMPANY_2.parse().unwrap()));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_first_company_choice_is_not_held_up() {
    // No run in any company yet: nothing unsent, the guard lets it through.
    let server = server(&[(COMPANY, "Acme"), (COMPANY_2, "Beta")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    fx.login().await.unwrap();
    let chosen = fx
        .desktop
        .select_company(&fx.state, COMPANY_2.parse().unwrap(), false)
        .await
        .unwrap();
    assert_eq!(chosen.profile.company_id, Some(COMPANY_2.parse().unwrap()));
}

// ---- connectivity -----------------------------------------------------------------

#[tokio::test(flavor = "multi_thread")]
async fn a_lost_server_and_its_return_are_told_and_the_return_starts_a_run() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let id = profile.id.clone();
    let connectivity = fx.desktop.connectivity().clone();
    let before = requests(&server, "/api/v1/sync/manifest").await.len();

    connectivity.observe(&id, false, std::time::Instant::now());
    connectivity.observe(&id, false, std::time::Instant::now());
    fx.events
        .wait_for(|e| matches!(e, EngineEvent::Connectivity { online: false, .. }))
        .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        requests(&server, "/api/v1/sync/manifest").await.len(),
        before
    );

    connectivity.observe(&id, true, std::time::Instant::now());
    fx.events
        .wait_for(|e| matches!(e, EngineEvent::Connectivity { online: true, .. }))
        .await;
    eventually("a run once the server is back", async || {
        requests(&server, "/api/v1/sync/manifest").await.len() > before
    })
    .await;
    let told: Vec<Value> = fx
        .events
        .events()
        .iter()
        .filter(|e| matches!(e, EngineEvent::Connectivity { .. }))
        .map(|e| serde_json::to_value(e).unwrap())
        .collect();
    assert_eq!(
        told,
        [
            json!({"type": "connectivity", "profile_id": id, "online": false}),
            json!({"type": "connectivity", "profile_id": id, "online": true}),
        ]
    );
}

// ---- snapshot refresh --------------------------------------------------------------

fn balances_body(label: &str) -> Value {
    json!({
        "data": [{"item_id": label, "quantity": "4"}],
        "meta": {"pagination": {"current_page": 1, "per_page": 25, "total": 1, "last_page": 1}}
    })
}

/// [`manifest`] with the stock balances as a snapshot resource.
fn manifest_with_balances() -> Value {
    let mut body = manifest();
    body["data"]["resources"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "resource": "stock-balances", "scope": "company", "visibility_generation": 0,
            "read": "offline-fallback", "source": "snapshot", "window_days": null,
            "writable": []
        }));
    body
}

async fn snapshot_server(companies: &[(&str, &str)]) -> MockServer {
    let server = server(companies).await;
    Mock::given(method("GET"))
        .and(path("/api/v1/sync/manifest"))
        .respond_with(ResponseTemplate::new(200).set_body_json(manifest_with_balances()))
        .with_priority(1)
        .mount(&server)
        .await;
    server
}

fn fx_every(period: Duration) -> Fx {
    let dir = tempfile::tempdir().unwrap();
    let mock = mock::Store::new().unwrap();
    let service = unique("keystone-desktop-test");
    let (desktop, events, realtime) = desktop_with(dir.path(), &service, &mock, options(), period);
    Fx {
        dir,
        mock,
        service,
        desktop,
        state: AppState::default(),
        events,
        realtime,
    }
}

fn balances(fx: &Fx) -> Option<Value> {
    fx.state
        .engine()
        .unwrap()
        .snapshot(&ResourceName("stock-balances".into()))
        .ok()
        .flatten()
        .map(|s| s.data)
}

#[tokio::test(flavor = "multi_thread")]
async fn snapshots_are_kept_every_period_and_skipped_offline() {
    let server = snapshot_server(&[(COMPANY, "Acme")]).await;
    Mock::given(method("GET"))
        .and(path(BALANCES))
        .respond_with(ResponseTemplate::new(200).set_body_json(balances_body("a")))
        .mount(&server)
        .await;
    let fx = fx_every(Duration::from_millis(300));
    let profile = synced(&fx, &server).await;

    eventually("a kept snapshot", async || {
        balances(&fx) == Some(balances_body("a"))
    })
    .await;
    eventually("rounds every period", async || {
        requests(&server, BALANCES).await.len() >= 3
    })
    .await;
    // Only the list itself, whole: what the offline read can answer.
    for request in requests(&server, BALANCES).await {
        assert_eq!(request.url.query(), None);
        assert_eq!(request.headers.get("x-company-id").unwrap(), COMPANY);
    }

    // Offline: rounds are skipped.
    let connectivity = fx.desktop.connectivity().clone();
    connectivity.observe(&profile.id, false, std::time::Instant::now());
    tokio::time::sleep(Duration::from_millis(200)).await;
    let offline = requests(&server, BALANCES).await.len();
    tokio::time::sleep(Duration::from_millis(1000)).await;
    assert_eq!(requests(&server, BALANCES).await.len(), offline);

    connectivity.observe(&profile.id, true, std::time::Instant::now());
    eventually("rounds again online", async || {
        requests(&server, BALANCES).await.len() > offline
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_company_change_stops_the_snapshots_of_the_old_company() {
    let server = snapshot_server(&[(COMPANY, "Acme"), (COMPANY_2, "Beta")]).await;
    Mock::given(method("GET"))
        .and(path(BALANCES))
        .respond_with(ResponseTemplate::new(200).set_body_json(balances_body("a")))
        .mount(&server)
        .await;
    let fx = fx_every(Duration::from_millis(200));
    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    fx.login().await.unwrap();
    // No company yet: no refresh.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(requests(&server, BALANCES).await.is_empty());

    fx.desktop
        .select_company(&fx.state, COMPANY.parse().unwrap(), false)
        .await
        .unwrap();
    eventually("rounds in the first company", async || {
        requests(&server, BALANCES).await.len() >= 2
    })
    .await;
    fx.desktop
        .select_company(&fx.state, COMPANY_2.parse().unwrap(), true)
        .await
        .unwrap();
    let of = async |company: &str| {
        requests(&server, BALANCES)
            .await
            .iter()
            .filter(|r| r.headers.get("x-company-id").unwrap() == company)
            .count()
    };
    let first = of(COMPANY).await;
    eventually("rounds in the second company", async || {
        of(COMPANY_2).await >= 2
    })
    .await;
    assert_eq!(of(COMPANY).await, first);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_answer_of_an_earlier_sign_in_is_not_kept() {
    let server = snapshot_server(&[(COMPANY, "Acme")]).await;
    Mock::given(method("GET"))
        .and(path(BALANCES))
        .and(header("authorization", "Bearer access-1-0123456789abcdef"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(balances_body("old"))
                .set_delay(Duration::from_millis(1500)),
        )
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(BALANCES))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let fx = fx();
    synced(&fx, &server).await;
    eventually("the round of the first sign-in", async || {
        !requests(&server, BALANCES).await.is_empty()
    })
    .await;
    let asked = std::time::Instant::now();

    // A second sign-in, verified by its run, while the answer is on its way.
    assert_eq!(fx.login().await.unwrap().generation, 2);
    eventually("a pull of the second sign-in", async || {
        requests(&server, "/api/v1/sync/pull")
            .await
            .iter()
            .any(|r| r.headers.get("authorization").unwrap() == "Bearer access-2-0123456789abcdef")
    })
    .await;
    assert!(
        asked.elapsed() < Duration::from_millis(1200),
        "the test lost its window"
    );
    tokio::time::sleep(Duration::from_millis(2000)).await;
    assert_eq!(balances(&fx), None);
}

// ---- profile_refresh_meta -------------------------------------------------------------

async fn serve_meta(server: &MockServer, meta: Value) {
    Mock::given(method("GET"))
        .and(path("/api/v1/meta"))
        .respond_with(ResponseTemplate::new(200).set_body_json(meta))
        .with_priority(1)
        .mount(server)
        .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refreshed_meta_is_stored_and_moves_the_realtime_connection() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    assert!(!profile.realtime);
    assert_eq!(
        fx.desktop.realtime_status().await.state,
        RealtimeStateDto::Disabled
    );

    // Reverb was set up on the server since: a port nothing listens on.
    let reverb = json!({"host": "127.0.0.1", "port": 9, "scheme": "http", "key": "new-key"});
    serve_meta(&server, meta_with("0.1.0", 1, reverb)).await;
    let refreshed = fx
        .desktop
        .refresh_meta(&fx.state, &profile.id)
        .await
        .unwrap();
    assert!(refreshed.realtime);
    let stored = fx.desktop.registry().get(&profile.id).unwrap();
    assert_eq!(stored.meta_snapshot.reverb.key.as_deref(), Some("new-key"));
    assert_ne!(
        fx.desktop.realtime_status().await.state,
        RealtimeStateDto::Disabled
    );
    // The profile itself stayed open.
    assert_eq!(fx.desktop.profile_state().phase, ProfilePhase::Ready);
    assert!(fx.state.engine().is_ok());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_refreshed_meta_the_app_cannot_serve_is_refused_and_not_stored() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    let before = fx.desktop.registry().get(&profile.id).unwrap();

    serve_meta(&server, meta("0.2.0", 1)).await;
    let error = fx
        .desktop
        .refresh_meta(&fx.state, &profile.id)
        .await
        .unwrap_err();
    assert_eq!(error.code, codes::DESKTOP_UPDATE_REQUIRED);

    // The first answer would win over a second mock: start over.
    server.reset().await;
    serve_meta(&server, meta("0.1.0", SCHEMA_VERSION + 1)).await;
    let error = fx
        .desktop
        .refresh_meta(&fx.state, &profile.id)
        .await
        .unwrap_err();
    assert_eq!(error.code, codes::SYNC_SCHEMA_MISMATCH);
    assert_eq!(fx.desktop.registry().get(&profile.id).unwrap(), before);

    let unknown = fx
        .desktop
        .refresh_meta(&fx.state, "no-such-profile")
        .await
        .unwrap_err();
    assert_eq!(unknown.code, codes::PROFILE_NOT_FOUND);
}

// ---- open_external ----------------------------------------------------------------------

#[derive(Default)]
struct FakeOpener {
    opened: Mutex<Vec<String>>,
    fail: bool,
}

impl Opener for FakeOpener {
    fn open(&self, url: &str) -> Result<(), String> {
        self.opened.lock().unwrap().push(url.to_owned());
        if self.fail {
            Err("no browser".into())
        } else {
            Ok(())
        }
    }
}

impl FakeOpener {
    fn opened(&self) -> Vec<String> {
        self.opened.lock().unwrap().clone()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn open_external_opens_a_page_of_the_active_profile_only() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let opener = FakeOpener::default();

    let none = open_with(
        &fx.desktop,
        &fx.state,
        ExternalTarget::PasswordChange,
        &opener,
    )
    .await
    .unwrap_err();
    assert_eq!(none.code, crate::commands::codes::NO_ACTIVE_PROFILE);
    assert!(opener.opened().is_empty());

    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    for target in [
        ExternalTarget::PasswordChange,
        ExternalTarget::Security,
        ExternalTarget::Home,
    ] {
        open_with(&fx.desktop, &fx.state, target, &opener)
            .await
            .unwrap();
    }
    assert_eq!(
        opener.opened(),
        [
            format!("{}/password/change", server.uri()),
            format!("{}/profile/security", server.uri()),
            format!("{}/", server.uri()),
        ]
    );

    let broken = FakeOpener {
        fail: true,
        ..FakeOpener::default()
    };
    let error = open_with(&fx.desktop, &fx.state, ExternalTarget::Home, &broken)
        .await
        .unwrap_err();
    assert_eq!(error.code, crate::commands::codes::EXTERNAL_OPEN_FAILED);
}

#[tokio::test(flavor = "multi_thread")]
async fn open_external_keeps_to_the_plain_http_switch() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    // The same profile in a desktop without the debug http switch.
    let (strict, _, _) = desktop_over(
        fx.dir.path(),
        &fx.service,
        &fx.mock,
        ClientOptions {
            allow_http_localhost: false,
            ..options()
        },
    );
    let state = AppState::default();
    state.activate(ActiveProfile {
        id: profile.id.clone(),
        client: fx.state.client().unwrap(),
        engine: None,
    });
    let opener = FakeOpener::default();
    let error = open_with(&strict, &state, ExternalTarget::Home, &opener)
        .await
        .unwrap_err();
    assert_eq!(error.code, "INVALID_SERVER_URL");
    assert!(opener.opened().is_empty());
}
