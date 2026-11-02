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
    // The state names the file to fix, by its absolute path only.
    let file = fx.desktop.registry().path().display().to_string();
    assert!(fx.desktop.registry().path().is_absolute());
    assert_eq!(error.path.as_deref(), Some(file.as_str()));
    let told = fx.events.states().pop().and_then(|s| s.error).unwrap();
    assert_eq!(told.path.as_deref(), Some(file.as_str()));
    assert!(!told.message.contains("not json"), "{}", told.message);
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

#[tokio::test(flavor = "multi_thread")]
async fn a_switch_that_cannot_store_its_choice_fails_and_a_busy_removal_says_so() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let id = Some(profile.id.as_str());
    // A request of the profile is still running.
    let in_flight = fx.state.client().unwrap();

    // Removing the open profile waits, gives up and opens it again.
    fx.events.clear_states();
    let busy = fx
        .desktop
        .remove(&fx.state, &profile.id, true)
        .await
        .unwrap_err();
    assert_eq!(busy.code, codes::PROFILE_BUSY);
    assert_eq!(
        phases(&fx),
        [
            told(ProfilePhase::Starting, id, None),
            told(ProfilePhase::Ready, id, None),
        ]
    );

    // From here on profiles.json cannot be replaced: its temporary file is
    // taken. The switch stops the open profile before it finds out.
    let blocker = fx.desktop.registry().path().with_extension("json.tmp");
    std::fs::create_dir(&blocker).unwrap();
    fx.events.clear_states();
    let error = fx.desktop.select(&fx.state, &profile.id).await.unwrap_err();
    assert_eq!(error.code, codes::PROFILES_FILE_INVALID);
    let file = fx.desktop.registry().path().display().to_string();
    assert_eq!(error.path.as_deref(), Some(file.as_str()));
    assert_eq!(fx.state.active_profile_id(), None);
    assert_eq!(
        phases(&fx),
        [told(
            ProfilePhase::Failed,
            id,
            Some(codes::PROFILES_FILE_INVALID)
        )]
    );
    std::fs::remove_dir(&blocker).unwrap();

    // The failed profile cannot go while its request runs: the state says why.
    let busy = fx
        .desktop
        .remove(&fx.state, &profile.id, true)
        .await
        .unwrap_err();
    assert_eq!(busy.code, codes::PROFILE_BUSY);
    assert_eq!(
        phases(&fx).last(),
        Some(&told(ProfilePhase::Failed, id, Some(codes::PROFILE_BUSY)))
    );
    assert!(fx.desktop.registry().get(&profile.id).is_ok());

    drop(in_flight);
    fx.desktop
        .remove(&fx.state, &profile.id, true)
        .await
        .unwrap();
    assert_eq!(fx.desktop.profile_state().phase, ProfilePhase::None);
}

// ---- company switch guard -------------------------------------------------------

/// The arguments the webview sends to `profile_select_company` are its
/// parameter names: `{company, force}`, `force` optional and `false` when
/// left out. No command runs here without a Tauri runtime, so the source
/// itself is checked.
#[test]
fn the_company_command_takes_company_and_an_optional_force() {
    let source = include_str!("../../commands/profiles.rs").replace("\r\n", "\n");
    let start = source
        .find("pub async fn profile_select_company(")
        .expect("the command is there");
    let command = &source[start..];
    let command = &command[..command.find("\n}\n").unwrap()];
    let flat = command.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(
        flat.contains("company: Uuid, force: Option<bool>, ) -> CommandResult<LoginDto>"),
        "{flat}"
    );
    assert!(
        flat.contains(".select_company(&state, company, force.unwrap_or(false))"),
        "{flat}"
    );
}

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

/// Answers every pushed mutation with `answer` (its status and body).
async fn push_answers(server: &MockServer, answer: Value) {
    Mock::given(method("POST"))
        .and(path("/api/v1/sync/push"))
        .respond_with(move |request: &Request| {
            let body: Value = serde_json::from_slice(&request.body).unwrap();
            let results: Vec<Value> = body["mutations"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| {
                    let mut result = json!({
                        "idempotency_key": m["idempotency_key"], "resource": m["resource"],
                        "id": m["id"], "replayed": false
                    });
                    let fields = answer.as_object().unwrap().clone();
                    result.as_object_mut().unwrap().extend(fields);
                    result
                })
                .collect();
            ResponseTemplate::new(200)
                .set_body_json(json!({"data": {"results": results}, "meta": {}}))
        })
        .mount(server)
        .await;
}

/// The active profile in `COMPANY` after a run that sent `draft()` and got
/// `answer` for it; its status once `settled` holds.
async fn a_draft_answered(
    fx: &Fx,
    server: &MockServer,
    answer: Value,
    settled: impl Fn(&keystone_sync::engine::SyncStatus) -> bool,
) -> String {
    push_answers(server, answer).await;
    let profile = fx.add(server).await;
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
    fx.state.trigger(&id, Trigger::Manual).unwrap();
    eventually("the answer of the push", async || {
        settled(&fx.state.engine().unwrap().refresh_status().unwrap())
    })
    .await;
    id
}

/// Unsent work that is not waiting in the outbox holds a company change
/// (and a removal) up as well.
async fn assert_held_up(fx: &Fx, id: &str) {
    let refused = fx
        .desktop
        .select_company(&fx.state, COMPANY_2.parse().unwrap(), false)
        .await
        .unwrap_err();
    assert_eq!(refused.code, codes::PROFILE_HAS_PENDING_WORK);
    assert_eq!(
        fx.desktop.registry().get(id).unwrap().company_id,
        Some(COMPANY.parse().unwrap())
    );
    let refused = fx.desktop.remove(&fx.state, id, false).await.unwrap_err();
    assert_eq!(refused.code, codes::PROFILE_HAS_PENDING_WORK);
    assert_eq!(fx.state.active_profile_id().as_deref(), Some(id));
}

#[tokio::test(flavor = "multi_thread")]
async fn an_open_conflict_holds_a_company_change_up() {
    let server = server(&[(COMPANY, "Acme"), (COMPANY_2, "Beta")]).await;
    let fx = fx();
    let duplicate = json!({"status": "conflict", "conflict": {
        "code": "DUPLICATE_RECORD", "base_version": null, "server_version": null,
        "conflicting_fields": [], "server_data": null, "candidates": [ROW],
        "choices": ["use_existing", "keep_mine", "discard"]
    }});
    let id = a_draft_answered(&fx, &server, duplicate, |s| s.conflicts == 1).await;
    // Nothing is waiting, rejected or parked: the conflict alone holds it.
    let status = fx.state.engine().unwrap().refresh_status().unwrap();
    assert_eq!(status.pending + status.rejected + status.quarantined, 0);
    assert_held_up(&fx, &id).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_rejected_draft_holds_a_company_change_up() {
    let server = server(&[(COMPANY, "Acme"), (COMPANY_2, "Beta")]).await;
    let fx = fx();
    let invalid = json!({"status": "rejected",
        "error": {"message": "name is required", "code": "VALIDATION_ERROR"}});
    let id = a_draft_answered(&fx, &server, invalid, |s| s.rejected == 1).await;
    let status = fx.state.engine().unwrap().refresh_status().unwrap();
    assert_eq!((status.pending, status.conflicts), (0, 0));
    assert_held_up(&fx, &id).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sign_in_that_moves_the_company_is_not_held_up_by_unsent_work() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    fx.state.engine().unwrap().enqueue(draft()).unwrap();
    let status = fx.state.engine().unwrap().refresh_status().unwrap();
    assert!(status.pending + status.rejected + status.quarantined > 0);

    // The user lost the first company since: the second is the only one.
    Mock::given(method("GET"))
        .and(path("/api/v1/auth/me"))
        .respond_with(ResponseTemplate::new(200).set_body_json(me_body(&[(COMPANY_2, "Beta")])))
        .with_priority(1)
        .mount(&server)
        .await;
    let signed_in = fx.login().await.unwrap();
    assert_eq!(
        signed_in.profile.company_id,
        Some(COMPANY_2.parse().unwrap())
    );
    assert!(!signed_in.company_required);
    assert_eq!(
        fx.desktop.registry().get(&profile.id).unwrap().company_id,
        Some(COMPANY_2.parse().unwrap())
    );
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

#[tokio::test(flavor = "multi_thread")]
async fn the_return_of_another_profiles_server_neither_is_told_nor_starts_a_run() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    let before = requests(&server, "/api/v1/sync/manifest").await.len();
    let connectivity = fx.desktop.connectivity().clone();

    let now = std::time::Instant::now();
    connectivity.observe("another-profile", false, now);
    connectivity.observe("another-profile", true, now);
    // A change of this profile after them: the bridge has read past both.
    connectivity.observe(&profile.id, false, now);
    fx.events
        .wait_for(|e| matches!(e, EngineEvent::Connectivity { online: false, .. }))
        .await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(
        requests(&server, "/api/v1/sync/manifest").await.len(),
        before
    );
    let told: Vec<Value> = fx
        .events
        .events()
        .iter()
        .filter(|e| matches!(e, EngineEvent::Connectivity { .. }))
        .map(|e| serde_json::to_value(e).unwrap())
        .collect();
    assert_eq!(
        told,
        [json!({"type": "connectivity", "profile_id": profile.id, "online": false})]
    );
}

/// What `connectivity` announced since `rx` was made.
fn announced(
    rx: &mut tokio::sync::broadcast::Receiver<crate::router::ConnectivityChange>,
) -> Vec<bool> {
    std::iter::from_fn(|| rx.try_recv().ok())
        .map(|change| change.online)
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_removed_profile_leaves_nothing_announced_behind() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let connectivity = fx.desktop.connectivity().clone();
    let mut rx = connectivity.subscribe();
    let now = std::time::Instant::now();
    connectivity.observe(&profile.id, false, now);
    assert_eq!(announced(&mut rx), [false]);

    fx.desktop
        .remove(&fx.state, &profile.id, true)
        .await
        .unwrap();
    // Forgotten: a profile starts reachable, so this is no change.
    connectivity.observe(&profile.id, true, now);
    assert_eq!(announced(&mut rx), Vec::<bool>::new());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_sign_out_leaves_nothing_announced_behind() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let connectivity = fx.desktop.connectivity().clone();
    let mut rx = connectivity.subscribe();
    let now = std::time::Instant::now();
    connectivity.observe(&profile.id, false, now);
    assert_eq!(announced(&mut rx), [false]);

    assert_eq!(
        fx.desktop.sign_out(&fx.state, true).await.unwrap(),
        SignOutDto::Done
    );
    connectivity.observe(&profile.id, true, now);
    connectivity.observe(&profile.id, false, now);
    assert_eq!(announced(&mut rx), [false]);
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

#[tokio::test(flavor = "multi_thread")]
async fn a_round_answered_before_the_sign_in_is_verified_runs_again_after_the_run() {
    let server = server(&[(COMPANY, "Acme")]).await;
    // The first run takes its time: the round is answered before it verifies
    // the sign-in, and the store refuses to keep the answer yet.
    Mock::given(method("GET"))
        .and(path("/api/v1/sync/manifest"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(manifest_with_balances())
                .set_delay(Duration::from_millis(800)),
        )
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(BALANCES))
        .respond_with(ResponseTemplate::new(200).set_body_json(balances_body("a")))
        .mount(&server)
        .await;
    // The two ageing reports come last and answer 404: nothing to keep, done.
    let fx = fx();
    synced(&fx, &server).await;

    // One period is an hour: only the retry on the run's status news keeps it.
    eventually("the snapshot kept after the run", async || {
        balances(&fx) == Some(balances_body("a"))
    })
    .await;
    assert!(requests(&server, BALANCES).await.len() >= 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_source_that_answers_without_data_waits_for_the_next_period() {
    let server = snapshot_server(&[(COMPANY, "Acme")]).await;
    Mock::given(method("GET"))
        .and(path(BALANCES))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    let fx = fx();
    synced(&fx, &server).await;
    eventually("the first round", async || {
        !requests(&server, BALANCES).await.is_empty()
    })
    .await;

    // Status news of another run does not ask the server again.
    let before = requests(&server, "/api/v1/sync/manifest").await.len();
    crate::bootstrap::trigger(&fx.state, Trigger::Manual).unwrap();
    eventually("another run", async || {
        requests(&server, "/api/v1/sync/manifest").await.len() > before
    })
    .await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(requests(&server, BALANCES).await.len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_round_waits_while_the_engine_finds_the_server_gone() {
    use crate::bootstrap::snapshots::{Live, Refresh};

    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    let live = |state: &AppState| Live {
        profile_id: profile.id.clone(),
        client: state.client().unwrap(),
        engine: state.engine().unwrap(),
        // No proxy result: the engine decides.
        connectivity: Connectivity::default(),
        resources: Vec::new(),
    };
    assert!(live(&fx.state).ready().await);

    // After a restart the stored server is a port nothing listens on.
    let (again, _) = restarted(&fx).await;
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let file = again.registry().path().to_path_buf();
    let mut stored: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    for entry in stored["profiles"].as_array_mut().unwrap() {
        entry["base_url"] = json!(format!("http://127.0.0.1:{port}"));
    }
    std::fs::write(&file, serde_json::to_vec(&stored).unwrap()).unwrap();
    let state = AppState::default();
    again.restore(&state).await.unwrap();
    eventually("the engine offline", async || {
        state.engine().unwrap().status().state == SyncState::Offline
    })
    .await;

    let gone = live(&state);
    assert!(!gone.ready().await);
    // A fresh answer through the proxy wins: the sign-in itself is usable.
    gone.connectivity
        .observe(&profile.id, true, std::time::Instant::now());
    assert!(gone.ready().await);
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
async fn a_refreshed_meta_of_another_profile_leaves_the_active_realtime_alone() {
    let a = server(&[(COMPANY, "Acme")]).await;
    let b = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let active = synced(&fx, &a).await;
    let other = fx.add(&b).await;

    // Reverb was set up on the other profile's server.
    let reverb = json!({"host": "127.0.0.1", "port": 9, "scheme": "http", "key": "other-key"});
    serve_meta(&b, meta_with("0.1.0", 1, reverb)).await;
    let refreshed = fx.desktop.refresh_meta(&fx.state, &other.id).await.unwrap();
    assert!(refreshed.realtime);
    let stored = fx.desktop.registry().get(&other.id).unwrap();
    assert_eq!(
        stored.meta_snapshot.reverb.key.as_deref(),
        Some("other-key")
    );

    let status = fx.desktop.realtime_status().await;
    assert_eq!(status.profile_id.as_deref(), Some(active.id.as_str()));
    assert_eq!(status.state, RealtimeStateDto::Disabled);
    assert_eq!(
        fx.state.active_profile_id().as_deref(),
        Some(active.id.as_str())
    );
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
async fn open_external_without_an_active_profile_opens_no_stored_one() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let opener = FakeOpener::default();
    let refused = async || {
        let error = open_with(&fx.desktop, &fx.state, ExternalTarget::Home, &opener)
            .await
            .unwrap_err();
        assert_eq!(error.code, crate::commands::codes::NO_ACTIVE_PROFILE);
        assert!(opener.opened().is_empty());
    };

    // Stored, never selected.
    let stored = fx.add(&server).await;
    refused().await;

    // The stored active profile failed to open at start-up.
    fx.desktop.registry().set_active(Some(&stored.id)).unwrap();
    fx.put_raw(&stored.id, b"zz");
    fx.desktop.restore(&fx.state).await.unwrap_err();
    assert_eq!(fx.desktop.profile_state().phase, ProfilePhase::Failed);
    refused().await;
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
