//! The session read across a restart: a profile restored with its server
//! down opens the web from the kept `GET /auth/me` answer, and a company
//! switch or profile reset leaves none behind.

use super::*;
use crate::commands::api;
use crate::dto::api::{ApiRequestDto, ApiResponseDto, ResponseSource};
use crate::router::local_resolver;

const ME: &str = "/api/v1/auth/me";

/// [`server`] outside wiremock's pool: dropping it closes its port, so the
/// profile's server is gone (a pooled one keeps listening).
async fn server(companies: &[(&str, &str)]) -> MockServer {
    let none = json!({"host": null, "port": null, "scheme": null, "key": null});
    serve_on(MockServer::builder().start().await, companies, none).await
}

async fn me_of(state: &AppState, desktop: &Desktop) -> CommandResult<ApiResponseDto> {
    let request: ApiRequestDto =
        serde_json::from_value(json!({ "method": "GET", "path": ME })).unwrap();
    api::handle(state, desktop.connectivity(), local_resolver(), request).await
}

/// The first desktop is stopped as on exit, its server goes away, and a
/// second desktop over the same data restores the active profile.
async fn restored_offline(fx: &Fx, server: MockServer) -> (Desktop, AppState) {
    fx.desktop
        .stop(&fx.state, &mut *fx.desktop.running.lock().await)
        .await;
    drop(server);
    let (again, _, _) = desktop_over(fx.dir.path(), &fx.service, &fx.mock, options());
    let state = AppState::default();
    again.restore(&state).await.unwrap();
    (again, state)
}

/// Waits until the restored engine found the server gone.
async fn engine_offline(state: &AppState) {
    let engine = state.engine().unwrap();
    eventually("engine offline", async || {
        engine.status().state == SyncState::Offline
    })
    .await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cold_start_without_the_server_opens_from_the_kept_answer() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    synced(&fx, &server).await;
    let online = me_of(&fx.state, &fx.desktop).await.unwrap();
    assert_eq!(online.source, ResponseSource::Network);

    let (again, state) = restored_offline(&fx, server).await;

    // Asked at once (the engine may not have noticed yet) and once it has.
    let first = me_of(&state, &again).await.unwrap();
    assert_eq!((first.status, first.source), (200, ResponseSource::Local));
    assert_eq!(
        first.json().unwrap()["data"],
        me_body(&[(COMPANY, "Acme")])["data"]
    );
    engine_offline(&state).await;
    let later = me_of(&state, &again).await.unwrap();
    assert_eq!((later.status, later.source), (200, ResponseSource::Local));
    assert_eq!(later.json().unwrap()["meta"]["offline"]["stale"], true);
    // The outbox and the mirror opened too.
    assert!(state.engine().unwrap().outbox_entries().is_ok());
    assert_eq!(rows_of(&state), 1);
}

fn rows_of(state: &AppState) -> usize {
    state
        .engine()
        .unwrap()
        .list(&parties(), &ListQuery::default())
        .map(|page| page.rows.len())
        .unwrap_or(0)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cold_start_without_a_kept_answer_stays_refused() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    synced(&fx, &server).await;

    let (again, state) = restored_offline(&fx, server).await;
    engine_offline(&state).await;

    let answer = me_of(&state, &again).await.unwrap();
    assert_eq!((answer.status, answer.source), (503, ResponseSource::Local));
    assert_eq!(
        answer.json().unwrap()["errors"]["code"],
        "OFFLINE_UNAVAILABLE"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_company_switch_leaves_no_answer_of_the_old_company() {
    let server = server(&[(COMPANY, "Acme"), (COMPANY_2, "Beta")]).await;
    let fx = fx();
    let profile = fx.add(&server).await;
    fx.desktop.select(&fx.state, &profile.id).await.unwrap();
    fx.login().await.unwrap();
    fx.desktop
        .select_company(&fx.state, COMPANY.parse().unwrap(), false)
        .await
        .unwrap();
    let engine = fx.state.engine().unwrap();
    eventually("first run", async || {
        engine.status().state == SyncState::Idle && engine.outbox_entries().is_ok()
    })
    .await;
    me_of(&fx.state, &fx.desktop).await.unwrap();
    assert!(engine.session_copy().unwrap().is_some());
    // A held engine is a request still running: the switch would wait.
    drop(engine);

    fx.desktop
        .select_company(&fx.state, COMPANY_2.parse().unwrap(), true)
        .await
        .unwrap();

    let (again, state) = restored_offline(&fx, server).await;
    engine_offline(&state).await;
    let answer = me_of(&state, &again).await.unwrap();
    assert_eq!(answer.status, 503, "{answer:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_profile_reset_leaves_no_answer() {
    let server = server(&[(COMPANY, "Acme")]).await;
    let fx = fx();
    let profile = synced(&fx, &server).await;
    me_of(&fx.state, &fx.desktop).await.unwrap();
    assert!(fx.state.engine().unwrap().session_copy().unwrap().is_some());

    fx.desktop
        .reset(&fx.state, &profile.id, true)
        .await
        .unwrap();

    // Signed out, nothing on this device answers the session read.
    let engine = fx.state.engine().unwrap();
    assert!(engine.session_copy().is_err());
    fx.desktop
        .connectivity()
        .observe(&profile.id, false, std::time::Instant::now());
    let answer = me_of(&fx.state, &fx.desktop).await.unwrap();
    assert_eq!(answer.status, 503);
}
