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

use std::sync::Arc;
use std::time::{Duration, Instant};

use keystone_sync::SyncError;
use keystone_sync::client::{
    AUTH_READS, HttpClient, PROXY_BODY_LIMIT, ProxyMethod, ProxyRequest, ProxyResponse,
    REQUEST_HEADERS,
};
use keystone_sync::engine::SyncState;
use keystone_sync::store::{LocalCopy, OnlineOnly, Store};
use keystone_sync::wire::{ResourceName, Source};
use serde_json::{Map, Value};

use crate::commands::{CommandError, CommandResult, codes};
use crate::dto::api::{ApiBody, ApiRequestDto, ApiResponseDto, ResponseSource};
use crate::router::envelope::{self, OfflineMeta};
use crate::router::{
    ApiCall, Connectivity, Decision, Facts, LocalOutcome, LocalPlan, LocalResolver, OfflineWrites,
    Refusal, Router, Target, TargetKind, local_read, local_resolver, query_map,
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

async fn respond(
    state: &AppState,
    connectivity: &Connectivity,
    resolver: Arc<dyn LocalResolver>,
    call: ApiCall,
) -> CommandResult<ApiResponseDto> {
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
            return Ok(answer);
        }
    }
    let status = engine.as_ref().map(|engine| engine.status());
    let online = connectivity.online(
        &profile,
        status.as_ref().map(|s| s.state == SyncState::Offline),
        Instant::now(),
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
    let snapshot = target.as_ref().filter(|t| is_whole_snapshot(t, &call));

    let run = Run {
        state,
        profile,
        client,
        engine,
        store,
        resolver,
        connectivity,
    };
    match decision {
        Decision::Refuse(refusal) => Ok(refuse(refusal, Vec::new())),
        Decision::Local { plan, else_online } => match run.local(plan, &call).await? {
            LocalOutcome::Answer(answer) => Ok(answer),
            LocalOutcome::Unsupported { .. } if else_online => run.online(&call, None, None).await,
            LocalOutcome::Unsupported {
                unsupported_filters,
            } => {
                let online_only = target
                    .as_ref()
                    .and_then(|t| query_map::spec_of(&t.resource))
                    .map(|spec| query_map::online_only(spec, &call.query))
                    .unwrap_or_default();
                Ok(refuse_with(
                    Refusal::Offline,
                    unsupported_filters,
                    online_only,
                ))
            }
        },
        Decision::Online { deadline, fallback } => match run
            .online(&call, deadline, snapshot.map(|t| &t.resource))
            .await
        {
            Err(error) if error.code == NETWORK_ERROR => match fallback {
                Some(plan) => match run.local(plan, &call).await? {
                    LocalOutcome::Answer(answer) => Ok(answer),
                    LocalOutcome::Unsupported { .. } => Err(error),
                },
                None => Err(error),
            },
            other => other,
        },
    }
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

    /// Sends `call` and records whether the server answered (a connection
    /// that could not be made: unreachable). `snapshot`: the resource a
    /// successful answer is kept for.
    async fn online(
        &self,
        call: &ApiCall,
        deadline: Option<Duration>,
        snapshot: Option<&ResourceName>,
    ) -> CommandResult<ApiResponseDto> {
        let result = send(self.client.clone(), proxy_request(call), deadline).await?;
        let reachable = match &result {
            Ok(_) | Err(SyncError::Api { .. }) => Some(true),
            // Only a failed connection marks the server unreachable; a slow or
            // cut-off answer (and the online-first deadline) says nothing.
            Err(SyncError::NotSent(_)) => Some(false),
            Err(_) => None,
        };
        if let Some(reachable) = reachable {
            self.connectivity
                .observe(&self.profile, reachable, Instant::now());
        }
        let (response, generation) = result.map_err(CommandError::from)?;
        let answer = envelope::from_proxy(response);
        if let Some(resource) = snapshot {
            self.keep_snapshot(resource, &answer, generation).await;
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
        let Some(engine) = self.engine.clone() else {
            return;
        };
        let body = answer.json().filter(|body| body.get("data").is_some());
        let (true, Some(body)) = (answer.status == 200, body) else {
            return;
        };
        let current = self
            .state
            .client()
            .is_ok_and(|client| Arc::ptr_eq(&client, &self.client))
            && self
                .state
                .engine()
                .is_ok_and(|active| Arc::ptr_eq(&active, &engine));
        if !current {
            return;
        }
        let (resource, body) = (resource.clone(), body.clone());
        let saved =
            blocking(move || local_read::save_snapshot(&engine, &resource, &body, generation));
        if let Err(error) = saved.await {
            log::debug!("snapshot not kept: {}", error.code);
        }
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
    refuse_with(refusal, unsupported_filters, Vec::new())
}

/// [`refuse`] naming the filters it could not apply; those the offline
/// manifest keeps for the server also come with their reason.
fn refuse_with(
    refusal: Refusal,
    unsupported_filters: Vec<String>,
    online_only: Vec<OnlineOnly>,
) -> ApiResponseDto {
    let (code, status) = refusal.code_and_status();
    let body = envelope::error(code, refusal.message(), None);
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
mod tests;
