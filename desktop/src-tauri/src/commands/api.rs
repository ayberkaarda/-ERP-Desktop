//! `api_request`: the webview's only door to the server.
//!
//! request -> checks ([`validate`]) -> [`Router::target`] + facts ->
//! [`Router::decide`] -> server ([`HttpClient::proxy_in`]), this device
//! ([`LocalResolver`]) or a local refusal in the Laravel error envelope.
//!
//! - `Ok(ApiResponseDto)` for every answer, server or local, success or
//!   error status: the UI reads the same envelope as on the web.
//! - `Err(CommandError)` when there is no answer: invalid request
//!   (`INVALID_REQUEST`, `PAYLOAD_TOO_LARGE`), no profile, network failure
//!   without a local fallback (`NETWORK_ERROR`), sign-in and account
//!   failures (`UNAUTHENTICATED`, `USER_DEACTIVATED`, ...; redacted by the
//!   client).
//! - Every proxy call runs in its own task: when an `online-first` read
//!   stops waiting at its deadline, the call (and a token refresh inside
//!   it) still finishes in the background instead of being dropped halfway.
//! - A call that fails with `UNAUTHENTICATED` because another sign-in
//!   happened while it was in flight is sent once more with the new
//!   sign-in (the user is signed in; the old generation is gone).
//! - Store work (local copy, local answers, token record reads) runs on
//!   `spawn_blocking`.
//! - A write whose `Idempotency-Key` this device recorded is answered here
//!   ([`LocalResolver::replay`]) before any routing: online too, a repeat of
//!   a pushed draft must not reach the server as a new request.
//! - A whole `200` answer of a `source: snapshot` resource is kept for the
//!   offline read, for the sign-in it was fetched in and only while its
//!   profile is still the active one. Keeping it never fails the answer.
//! - The same holds for the `200` answer of `GET /auth/me` (the session
//!   read, [`is_session_read`]): offline, or when the server cannot be
//!   reached, it is answered from that copy while the local data is
//!   verified for the sign-in that fetched it (`meta.offline`: as of its
//!   fetch, stale); without one it stays `OFFLINE_UNAVAILABLE`. Every other
//!   `/auth` path stays online only.
//! - A write sent while the profile counted as online whose connection
//!   could not be made (`NotSent`: refused, unknown host, connect timeout,
//!   a handshake that is not TLS) never reached the server: it takes the
//!   offline way (a draft where the resource allows one) and the profile is
//!   offline from then on. A write whose answer was lost (timeout after
//!   sending, a cut connection) is not queued: the server may have applied
//!   it. A refused server certificate (`TLS_CERTIFICATE_INVALID`) is told to
//!   the user as such and does not turn the profile offline.
//! - A request answered on this device because the profile is offline asks
//!   the engine for a probe, at most once per
//!   [`crate::router::PROBE_INTERVAL`]; one that would be refused waits for
//!   the verdict ([`PROBE_WAIT`]) and is decided again when the server
//!   answered, so the first retry after the server is back reaches it.

use std::sync::Arc;
use std::time::{Duration, Instant};

use keystone_sync::SyncError;
use keystone_sync::client::{
    AUTH_READS, HttpClient, PROXY_BODY_LIMIT, ProxyMethod, ProxyRequest, ProxyResponse,
    REQUEST_HEADERS,
};
use keystone_sync::engine::{SyncState, Trigger};
use keystone_sync::store::{LocalCopy, OnlineOnly, Store};
use keystone_sync::wire::{ResourceName, Source, Timestamp};
use serde_json::{Map, Value};

use crate::commands::{CommandError, CommandResult, codes};
use crate::dto::api::{ApiBody, ApiRequestDto, ApiResponseDto, ResponseSource};
use crate::router::envelope::{self, OfflineMeta};
use crate::router::{
    ApiCall, Connectivity, Decision, Facts, LocalOutcome, LocalPlan, LocalResolver, OfflineWrites,
    PROBE_WAIT, Refusal, Router, Target, TargetKind, local_read, local_resolver, query_map,
};
use crate::state::{AppState, Engine};

/// A background task of the command panicked or was cancelled.
pub const TASK_FAILED: &str = "TASK_FAILED";

/// Paths under `/api/v1/` (lowercase, without the prefix) the webview may
/// not call: each one and everything below it, except [`AUTH_READS`]. The
/// client refuses the same set; checking here first refuses them offline
/// too, with `INVALID_REQUEST`.
const RESERVED: [&str; 3] = ["auth", "sync", "broadcasting/auth"];

const PREFIX: &str = "/api/v1/";

#[tauri::command]
pub async fn api_request<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: tauri::State<'_, AppState>,
    req: ApiRequestDto,
) -> CommandResult<ApiResponseDto> {
    use tauri::Manager;
    if app.try_state::<Connectivity>().is_none() {
        // First call: `manage` keeps the first value if two calls race.
        app.manage(Connectivity::default());
    }
    let connectivity = app.state::<Connectivity>();
    handle(&state, &connectivity, local_resolver(), req).await
}

/// The command without Tauri: checks, decides and answers `request`. A
/// local offline refusal names the refused request ([`name_refused`]).
pub async fn handle(
    state: &AppState,
    connectivity: &Connectivity,
    resolver: Arc<dyn LocalResolver>,
    request: ApiRequestDto,
) -> CommandResult<ApiResponseDto> {
    let call = validate(request)?;
    let (method, path) = (call.method, call.path.clone());
    let answer = respond(state, connectivity, resolver, call).await?;
    Ok(name_refused(answer, method, &path))
}

/// Local error codes that refuse a request because it needs the server
/// (`OFFLINE_UNAVAILABLE`) or offline writes are closed
/// (`SYNC_OFFLINE_WRITE_NOT_ALLOWED`), with their HTTP status.
const OFFLINE_REFUSALS: [(&str, u16); 2] = [
    ("OFFLINE_UNAVAILABLE", 503),
    ("SYNC_OFFLINE_WRITE_NOT_ALLOWED", 422),
];

/// Adds `errors.details = {method, path}` to a local offline refusal, so the
/// UI can name the action it refused. `method` is upper case; `path` is the
/// API-relative path (`/parties/{id}`): the request path was checked to be
/// plain segments, so it holds no query, fragment or credential. Server
/// answers and every other local answer are left as they are.
pub fn name_refused(mut answer: ApiResponseDto, method: ProxyMethod, path: &str) -> ApiResponseDto {
    if answer.source != ResponseSource::Local {
        return answer;
    }
    let status = answer.status;
    let Some(ApiBody::Json { value }) = answer.body.as_mut() else {
        return answer;
    };
    let Some(errors) = value.get_mut("errors").and_then(Value::as_object_mut) else {
        return answer;
    };
    let refusal = errors
        .get("code")
        .and_then(Value::as_str)
        .is_some_and(|code| OFFLINE_REFUSALS.contains(&(code, status)));
    if !refusal {
        return answer;
    }
    let relative = path.strip_prefix(PREFIX).unwrap_or(path);
    let details = errors
        .entry("details")
        .or_insert_with(|| Value::Object(Map::new()));
    if let Value::Object(details) = details {
        details.insert("method".into(), Value::String(method_name(method).into()));
        details.insert("path".into(), Value::String(format!("/{relative}")));
    }
    answer
}

fn method_name(method: ProxyMethod) -> &'static str {
    match method {
        ProxyMethod::Get => "GET",
        ProxyMethod::Post => "POST",
        ProxyMethod::Put => "PUT",
        ProxyMethod::Patch => "PATCH",
        ProxyMethod::Delete => "DELETE",
    }
}

/// Answers `call`; when it was answered on this device because the profile
/// is offline, asks the engine for a probe.
///
/// - A local answer (a draft, a local read) only triggers it, at most once
///   per [`crate::router::PROBE_INTERVAL`] ([`Connectivity::probe_due`]). Its
///   verdict reaches the view through the connectivity bridge: the engine
///   leaving `Offline`, or a pass that ends idle while the view says
///   unreachable, counts as reachable.
/// - A request that would be refused waits for the verdict ([`PROBE_WAIT`];
///   its own turn, [`Connectivity::wait_due`], so a local answer just before
///   does not take it) and, when the server answered, is decided again: the
///   first retry after the server came back reaches it. A refusal never
///   queued anything, so deciding again sends nothing twice.
async fn respond(
    state: &AppState,
    connectivity: &Connectivity,
    resolver: Arc<dyn LocalResolver>,
    call: ApiCall,
) -> CommandResult<ApiResponseDto> {
    let routed = respond_once(state, connectivity, resolver.clone(), &call).await?;
    if routed.online {
        return Ok(routed.answer);
    }
    let Some(profile) = state.active_profile_id() else {
        return Ok(routed.answer);
    };
    if !is_offline_refusal(&routed.answer) {
        if connectivity.probe_due(&profile, clock()) {
            let _ = state.trigger(&profile, Trigger::Probe);
        }
        return Ok(routed.answer);
    }
    if !connectivity.wait_due(&profile, clock()) {
        return Ok(routed.answer);
    }
    let verdict =
        crate::commands::sync::probe(state, connectivity, &profile, Trigger::Probe, PROBE_WAIT)
            .await;
    if matches!(verdict, Ok(Some(true))) {
        return Ok(respond_once(state, connectivity, resolver, &call)
            .await?
            .answer);
    }
    Ok(routed.answer)
}

/// The time the connectivity view and the probe interval are measured in:
/// the Tokio clock, so paused tests move it.
fn clock() -> Instant {
    tokio::time::Instant::now().into_std()
}

/// A local `OFFLINE_UNAVAILABLE` refusal: nothing was answered or queued.
fn is_offline_refusal(answer: &ApiResponseDto) -> bool {
    answer.source == ResponseSource::Local
        && answer.status == 503
        && answer
            .json()
            .and_then(|body| body.pointer("/errors/code"))
            .and_then(Value::as_str)
            == Some("OFFLINE_UNAVAILABLE")
}

/// An answer, and whether it was decided as online.
struct Routed {
    answer: ApiResponseDto,
    online: bool,
}

impl Routed {
    fn offline(answer: ApiResponseDto) -> Self {
        Self {
            answer,
            online: false,
        }
    }
}

async fn respond_once(
    state: &AppState,
    connectivity: &Connectivity,
    resolver: Arc<dyn LocalResolver>,
    call: &ApiCall,
) -> CommandResult<Routed> {
    let profile = state.active_profile_id().ok_or_else(no_profile)?;
    let client = state.client()?;
    let engine = state.engine().ok();
    let store = state.store().ok();
    if state.active_profile_id().as_deref() != Some(profile.as_str()) {
        return Err(CommandError::new(
            codes::NO_ACTIVE_PROFILE,
            "the server profile changed while the request was prepared",
        ));
    }

    let target = Router::embedded().target(call.method, &call.path);
    if let Some(engine) = &engine
        && matches!(&target, Some(t) if matches!(t.kind, TargetKind::Write { .. }))
        && call.header("idempotency-key").is_some()
    {
        let (resolver, engine, repeat) = (resolver.clone(), engine.clone(), call.clone());
        if let Some(answer) = blocking(move || resolver.replay(&engine, &repeat)).await? {
            // A replay is the same answer online and offline: no probe.
            return Ok(Routed {
                answer,
                online: true,
            });
        }
    }
    let status = engine.as_ref().map(|engine| engine.status());
    let online = connectivity.online(
        &profile,
        status.as_ref().map(|s| s.state == SyncState::Offline),
        clock(),
    );
    let local_copy = match (&engine, &target) {
        (Some(engine), Some(target)) => {
            let (resolver, engine, resource) =
                (resolver.clone(), engine.clone(), target.resource.clone());
            let store = store.clone();
            let copy = move || resolver.local_copy(&engine, store.as_deref(), &resource);
            match blocking(copy).await {
                Ok(copy) => copy,
                // Online the server still answers; offline the error is the answer.
                Err(_) if online => LocalCopy::Missing,
                Err(error) => return Err(error),
            }
        }
        _ => LocalCopy::Missing,
    };
    let offline_writes = match &status {
        None => OfflineWrites::NoLocalStore,
        Some(status) if status.manifest_mismatch => OfflineWrites::ManifestMismatch,
        Some(_) => OfflineWrites::Open,
    };
    let policy = match (&engine, &target) {
        (Some(engine), Some(target)) => engine.write_policy(&target.resource),
        _ => None,
    };
    let facts = Facts {
        online,
        local_copy,
        offline_writes,
    };
    let decision = Router::decide(target.as_ref(), &facts, policy.as_ref());
    let snapshot = target.as_ref().filter(|t| is_whole_snapshot(t, call));
    let session_read = is_session_read(call);

    let run = Run {
        state,
        profile,
        client,
        engine,
        store,
        resolver,
        connectivity,
    };
    let keep = Keep {
        snapshot: snapshot.map(|t| &t.resource),
        session: session_read,
    };
    let answered = |answer| Routed { answer, online };
    match decision {
        Decision::Refuse(Refusal::Offline) if session_read => Ok(answered(
            run.session()
                .await?
                .unwrap_or_else(|| refuse(Refusal::Offline, Vec::new())),
        )),
        Decision::Refuse(refusal) => Ok(answered(refuse(refusal, Vec::new()))),
        Decision::Local { plan, else_online } => match run.local(plan, call).await? {
            LocalOutcome::Answer(answer) => Ok(answered(answer)),
            LocalOutcome::Unsupported { .. } if else_online => {
                Ok(answered(run.online(call, None, Keep::NOTHING).await?))
            }
            LocalOutcome::Unsupported {
                unsupported_filters,
            } => {
                let spec = target
                    .as_ref()
                    .and_then(|t| query_map::spec_of(&t.resource));
                let online_only = spec
                    .map(|spec| query_map::online_only(spec, &call.query))
                    .unwrap_or_default();
                let invalid = spec
                    .map(|spec| query_map::invalid_values(spec, &call.query))
                    .unwrap_or_default();
                Ok(answered(refuse_with(
                    Refusal::Offline,
                    unsupported_filters,
                    online_only,
                    &invalid,
                )))
            }
        },
        Decision::Online { deadline, fallback } => match run.online(call, deadline, keep).await {
            Ok(answer) => Ok(answered(answer)),
            // The server went away before this profile was seen offline,
            // and the write certainly did not leave this device: it takes
            // the way it takes offline (a draft, when the resource allows
            // one). A write whose answer was lost is not queued: the server
            // may have applied it.
            Err(Unanswered {
                error,
                not_sent: true,
            }) if error.code == NETWORK_ERROR
                && matches!(&target, Some(t) if matches!(t.kind, TargetKind::Write { .. })) =>
            {
                let offline = Facts {
                    online: false,
                    ..facts
                };
                match Router::decide(target.as_ref(), &offline, policy.as_ref()) {
                    Decision::Local {
                        plan: plan @ LocalPlan::Write { .. },
                        ..
                    } => match run.local(plan, call).await? {
                        LocalOutcome::Answer(answer) => Ok(Routed::offline(answer)),
                        LocalOutcome::Unsupported { .. } => Err(error),
                    },
                    _ => Err(error),
                }
            }
            Err(Unanswered { error, .. }) if error.code == NETWORK_ERROR => match fallback {
                Some(plan) => match run.local(plan, call).await? {
                    LocalOutcome::Answer(answer) => Ok(answered(answer)),
                    LocalOutcome::Unsupported { .. } => Err(error),
                },
                // The server went away before the engine noticed (a reload
                // or a cold start right after): the kept session answer.
                None if session_read => run.session().await?.map(answered).ok_or(error),
                None => Err(error),
            },
            Err(Unanswered { error, .. }) => Err(error),
        },
    }
}

/// A call the server did not answer. `not_sent`: it certainly did not
/// reach the server (no connection, or a refused certificate).
struct Unanswered {
    error: CommandError,
    not_sent: bool,
}

impl From<CommandError> for Unanswered {
    fn from(error: CommandError) -> Self {
        Self {
            error,
            not_sent: false,
        }
    }
}

impl From<Unanswered> for CommandError {
    fn from(failure: Unanswered) -> Self {
        failure.error
    }
}

/// `GET /api/v1/auth/me` without a query: the session read the web starts
/// with. Its `200` answer is kept for the offline start, and offline (or
/// when the server cannot be reached) it is answered from that copy. Every
/// other `/auth` path stays online only.
fn is_session_read(call: &ApiCall) -> bool {
    call.method == ProxyMethod::Get && call.path == SESSION_PATH && call.query.is_empty()
}

const SESSION_PATH: &str = "/api/v1/auth/me";

/// What a successful server answer is kept for.
#[derive(Clone, Copy)]
struct Keep<'a> {
    /// The snapshot of this resource.
    snapshot: Option<&'a ResourceName>,
    /// The session answer ([`is_session_read`]).
    session: bool,
}

impl Keep<'_> {
    const NOTHING: Keep<'static> = Keep {
        snapshot: None,
        session: false,
    };
}

const NETWORK_ERROR: &str = "NETWORK_ERROR";

/// A GET of a snapshot resource that is not narrowed to part of it.
fn is_whole_snapshot(target: &Target, call: &ApiCall) -> bool {
    target.source == Source::Snapshot
        && target.kind == TargetKind::List
        && local_read::is_whole_answer(&call.query)
}

struct Run<'a> {
    state: &'a AppState,
    profile: String,
    client: Arc<HttpClient>,
    engine: Option<Arc<Engine>>,
    store: Option<Arc<Store>>,
    resolver: Arc<dyn LocalResolver>,
    connectivity: &'a Connectivity,
}

impl Run<'_> {
    async fn local(&self, plan: LocalPlan, call: &ApiCall) -> CommandResult<LocalOutcome> {
        let Some(engine) = self.engine.clone() else {
            return Ok(LocalOutcome::Unsupported {
                unsupported_filters: Vec::new(),
            });
        };
        let (resolver, store, call) = (self.resolver.clone(), self.store.clone(), call.clone());
        blocking(move || resolver.resolve(&engine, store.as_deref(), &plan, &call)).await
    }

    /// The kept session answer ([`LocalResolver::session`]); `None` without
    /// an engine.
    async fn session(&self) -> CommandResult<Option<ApiResponseDto>> {
        let Some(engine) = self.engine.clone() else {
            return Ok(None);
        };
        let resolver = self.resolver.clone();
        blocking(move || resolver.session(&engine)).await
    }

    /// Sends `call` and records whether the server answered (a connection
    /// that could not be made: unreachable). `keep`: what a successful
    /// answer is kept for.
    async fn online(
        &self,
        call: &ApiCall,
        deadline: Option<Duration>,
        keep: Keep<'_>,
    ) -> Result<ApiResponseDto, Unanswered> {
        // Taken before sending: the kept session answer is as of its request,
        // and an older request answered last does not replace a newer one.
        let sent_at = if keep.session {
            local_read::now().ok()
        } else {
            None
        };
        let result = send(self.client.clone(), proxy_request(call), deadline).await?;
        let reachable = match &result {
            Ok(_) | Err(SyncError::Api { .. }) => Some(true),
            // Only a failed connection marks the server unreachable; a slow or
            // cut-off answer (and the online-first deadline) says nothing,
            // and neither does a refused certificate: the server is there
            // but not trusted, and the user is told so.
            Err(SyncError::NotSent(_)) => Some(false),
            Err(_) => None,
        };
        if let Some(reachable) = reachable {
            self.connectivity.observe(&self.profile, reachable, clock());
        }
        let (response, generation) = result.map_err(|error| Unanswered {
            not_sent: error.not_sent(),
            error: CommandError::from(error),
        })?;
        let answer = envelope::from_proxy(response);
        if let Some(resource) = keep.snapshot {
            self.keep_snapshot(resource, &answer, generation).await;
        }
        if let Some(sent_at) = sent_at {
            self.keep_session(&answer, generation, sent_at).await;
        }
        Ok(answer)
    }

    /// Keeps a `200` envelope while this call's client and engine are still
    /// the active ones: another company or profile may share the store now.
    /// The engine refuses the rest (see [`local_read::save_snapshot`]).
    async fn keep_snapshot(
        &self,
        resource: &ResourceName,
        answer: &ApiResponseDto,
        generation: u64,
    ) {
        let Some((engine, body)) = self.keepable(answer) else {
            return;
        };
        let resource = resource.clone();
        let saved =
            blocking(move || local_read::save_snapshot(&engine, &resource, &body, generation));
        if let Err(error) = saved.await {
            log::debug!("snapshot not kept: {}", error.code);
        }
    }

    /// Keeps the session answer like a snapshot ([`Run::keep_snapshot`]);
    /// the engine refuses it for another sign-in, a signed-out or
    /// deactivated one, and a body carrying a credential (see
    /// [`local_read::save_session`]). Only the error code is logged.
    async fn keep_session(&self, answer: &ApiResponseDto, generation: u64, sent_at: Timestamp) {
        let Some((engine, body)) = self.keepable(answer) else {
            return;
        };
        let saved =
            blocking(move || local_read::save_session(&engine, &body, generation, &sent_at));
        if let Err(error) = saved.await {
            log::debug!("session answer not kept: {}", error.code);
        }
    }

    /// The engine and body of a `200` envelope with `data`, while this
    /// call's client and engine are still the active ones.
    fn keepable(&self, answer: &ApiResponseDto) -> Option<(Arc<Engine>, Value)> {
        let engine = self.engine.clone()?;
        let body = answer.json().filter(|body| body.get("data").is_some());
        let (true, Some(body)) = (answer.status == 200, body) else {
            return None;
        };
        let current = self
            .state
            .client()
            .is_ok_and(|client| Arc::ptr_eq(&client, &self.client))
            && self
                .state
                .engine()
                .is_ok_and(|active| Arc::ptr_eq(&active, &engine));
        current.then(|| (engine, body.clone()))
    }
}

/// Runs the proxy call in its own task; with `deadline`, stops waiting
/// (`NETWORK_ERROR`) and leaves the task to finish on its own.
async fn send(
    client: Arc<HttpClient>,
    request: ProxyRequest,
    deadline: Option<Duration>,
) -> CommandResult<Result<(ProxyResponse, u64), SyncError>> {
    let task = tauri::async_runtime::spawn(async move { proxy(&client, &request).await });
    let joined = match deadline {
        Some(wait) => match tokio::time::timeout(wait, task).await {
            Ok(joined) => joined,
            Err(_) => {
                return Ok(Err(SyncError::Network(format!(
                    "no answer within {} s",
                    wait.as_secs()
                ))));
            }
        },
        None => task.await,
    };
    joined.map_err(|_| CommandError::new(TASK_FAILED, "the request task stopped"))
}

/// One proxy call bound to the current sign-in, sent once more when it
/// failed with `UNAUTHENTICATED` because another sign-in happened meanwhile.
/// Comes with the generation of the sign-in that answered.
async fn proxy(
    client: &Arc<HttpClient>,
    request: &ProxyRequest,
) -> Result<(ProxyResponse, u64), SyncError> {
    let before = record(client).await?;
    let error = match client.proxy_in(request, before.generation).await {
        Err(error) if error.code() == "UNAUTHENTICATED" => error,
        other => return other.map(|answer| (answer, before.generation)),
    };
    let after = record(client).await?;
    if after.generation != before.generation && after.tokens.is_some() && !after.deactivated {
        let answer = client.proxy_in(request, after.generation).await?;
        return Ok((answer, after.generation));
    }
    Err(error)
}

async fn record(client: &Arc<HttpClient>) -> Result<keystone_sync::auth::SessionRecord, SyncError> {
    let client = client.clone();
    tauri::async_runtime::spawn_blocking(move || client.session().record())
        .await
        .unwrap_or_else(|_| Err(SyncError::TokenStore("token record read stopped".into())))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .unwrap_or_else(|_| Err(CommandError::new(TASK_FAILED, "the local task stopped")))
}

fn proxy_request(call: &ApiCall) -> ProxyRequest {
    ProxyRequest {
        method: call.method,
        path: call.path.clone(),
        query: call.query.clone(),
        headers: call.headers.clone(),
        body: call.body.clone(),
    }
}

fn refuse(refusal: Refusal, unsupported_filters: Vec<String>) -> ApiResponseDto {
    refuse_with(refusal, unsupported_filters, Vec::new(), &[])
}

/// [`refuse`] naming the filters it could not apply; those the offline
/// manifest keeps for the server also come with their reason, and values
/// the server would refuse are named in `errors.details.invalid_values`.
fn refuse_with(
    refusal: Refusal,
    unsupported_filters: Vec<String>,
    online_only: Vec<OnlineOnly>,
    invalid: &[query_map::InvalidValue],
) -> ApiResponseDto {
    let (code, status) = refusal.code_and_status();
    let mut body = envelope::error(code, refusal.message(), None);
    if !invalid.is_empty()
        && let Some(errors) = body.get_mut("errors").and_then(Value::as_object_mut)
    {
        let values = serde_json::to_value(invalid).unwrap_or(Value::Null);
        let mut details = Map::new();
        details.insert("invalid_values".into(), values);
        errors.insert("details".into(), Value::Object(details));
    }
    let body = if unsupported_filters.is_empty() {
        body
    } else {
        envelope::with_offline(
            body,
            &OfflineMeta {
                unsupported_filters,
                online_only,
                ..OfflineMeta::default()
            },
        )
    };
    envelope::local(status, body)
}

fn no_profile() -> CommandError {
    CommandError::new(codes::NO_ACTIVE_PROFILE, "no server profile is selected")
}

fn invalid(message: impl Into<String>) -> CommandError {
    SyncError::InvalidRequest(message.into()).into()
}

/// Checks the request before anything else runs. Messages name the
/// problem, never a value of the request.
pub fn validate(request: ApiRequestDto) -> CommandResult<ApiCall> {
    let method = ProxyMethod::from_name(&request.method)
        .ok_or_else(|| invalid("method must be GET, POST, PUT, PATCH or DELETE"))?;
    check_path(&request.path)?;
    if is_reserved(method, &request.path) {
        return Err(invalid("this path is reserved for the desktop client"));
    }

    let mut headers = Vec::new();
    for (name, value) in request.headers {
        let name = name.to_ascii_lowercase();
        if !REQUEST_HEADERS.contains(&name.as_str()) {
            continue;
        }
        if !value.chars().all(|c| c == '\t' || (' '..='~').contains(&c)) {
            return Err(invalid(format!("header {name} has an invalid value")));
        }
        headers.push((name, value));
    }

    let body = match &request.body {
        None => None,
        Some(_) if method == ProxyMethod::Get => {
            return Err(invalid("a GET request has no body"));
        }
        Some(body) => {
            let bytes = envelope::request_bytes(body).map_err(invalid)?;
            if bytes.len() > PROXY_BODY_LIMIT {
                return Err(SyncError::PayloadTooLarge(format!(
                    "request body exceeds the {} MiB limit",
                    PROXY_BODY_LIMIT / (1024 * 1024)
                ))
                .into());
            }
            if !headers.iter().any(|(n, _)| n == "content-type") {
                let content_type = match body {
                    ApiBody::Json { .. } => "application/json",
                    ApiBody::Text { .. } => "text/plain; charset=utf-8",
                    ApiBody::Binary { .. } => "application/octet-stream",
                };
                headers.push(("content-type".into(), content_type.into()));
            }
            Some(bytes)
        }
    };

    Ok(ApiCall {
        method,
        path: request.path,
        query: request.query,
        headers,
        body,
    })
}

/// `/api/v1/` followed by plain segments (`[A-Za-z0-9-_.~]`, not `.` or
/// `..`): no query, fragment, encoding, empty segment or trailing slash.
fn check_path(path: &str) -> CommandResult<()> {
    let rest = path
        .strip_prefix(PREFIX)
        .ok_or_else(|| invalid("path must start with /api/v1/"))?;
    let plain = !rest.is_empty()
        && rest.split('/').all(|segment| {
            !segment.is_empty()
                && segment != "."
                && segment != ".."
                && segment
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~'))
        });
    if plain {
        Ok(())
    } else {
        Err(invalid(
            "path must be plain segments under /api/v1/ without query or fragment",
        ))
    }
}

fn is_reserved(method: ProxyMethod, path: &str) -> bool {
    let rest = path
        .strip_prefix(PREFIX)
        .unwrap_or(path)
        .to_ascii_lowercase();
    if AUTH_READS.contains(&(method, rest.as_str())) {
        return false;
    }
    RESERVED
        .iter()
        .any(|reserved| rest == *reserved || rest.starts_with(&format!("{reserved}/")))
}

#[cfg(test)]
mod probe_tests;
#[cfg(test)]
mod probe_timing_tests;
#[cfg(test)]
mod tests;
