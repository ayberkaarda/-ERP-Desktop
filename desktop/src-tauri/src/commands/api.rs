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

use std::sync::Arc;
use std::time::{Duration, Instant};

use keystone_sync::SyncError;
use keystone_sync::client::{
    AUTH_READS, HttpClient, PROXY_BODY_LIMIT, ProxyMethod, ProxyRequest, ProxyResponse,
    REQUEST_HEADERS,
};
use keystone_sync::engine::SyncState;
use keystone_sync::store::LocalCopy;

use crate::commands::{CommandError, CommandResult, codes};
use crate::dto::api::{ApiBody, ApiRequestDto, ApiResponseDto};
use crate::router::envelope::{self, OfflineMeta};
use crate::router::{
    ApiCall, Connectivity, Decision, Facts, LocalOutcome, LocalPlan, LocalResolver, OfflineWrites,
    Refusal, Router, local_resolver,
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

/// The command without Tauri: checks, decides and answers `request`.
pub async fn handle(
    state: &AppState,
    connectivity: &Connectivity,
    resolver: Arc<dyn LocalResolver>,
    request: ApiRequestDto,
) -> CommandResult<ApiResponseDto> {
    let call = validate(request)?;
    let profile = state.active_profile_id().ok_or_else(no_profile)?;
    let client = state.client()?;
    let engine = state.engine().ok();
    if state.active_profile_id().as_deref() != Some(profile.as_str()) {
        return Err(CommandError::new(
            codes::NO_ACTIVE_PROFILE,
            "the server profile changed while the request was prepared",
        ));
    }

    let target = Router::embedded().target(call.method, &call.path);
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
            match blocking(move || resolver.local_copy(&engine, &resource)).await {
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

    let run = Run {
        profile,
        client,
        engine,
        resolver,
        connectivity,
    };
    match decision {
        Decision::Refuse(refusal) => Ok(refuse(refusal, Vec::new())),
        Decision::Local { plan, else_online } => match run.local(plan, &call).await? {
            LocalOutcome::Answer(answer) => Ok(answer),
            LocalOutcome::Unsupported { .. } if else_online => run.online(&call, None).await,
            LocalOutcome::Unsupported {
                unsupported_filters,
            } => Ok(refuse(Refusal::Offline, unsupported_filters)),
        },
        Decision::Online { deadline, fallback } => match run.online(&call, deadline).await {
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

struct Run<'a> {
    profile: String,
    client: Arc<HttpClient>,
    engine: Option<Arc<Engine>>,
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
        let (resolver, call) = (self.resolver.clone(), call.clone());
        blocking(move || resolver.resolve(&engine, &plan, &call)).await
    }

    /// Sends `call` and records whether the server answered (a connection
    /// that could not be made: unreachable).
    async fn online(
        &self,
        call: &ApiCall,
        deadline: Option<Duration>,
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
        result.map(envelope::from_proxy).map_err(CommandError::from)
    }
}

/// Runs the proxy call in its own task; with `deadline`, stops waiting
/// (`NETWORK_ERROR`) and leaves the task to finish on its own.
async fn send(
    client: Arc<HttpClient>,
    request: ProxyRequest,
    deadline: Option<Duration>,
) -> CommandResult<Result<ProxyResponse, SyncError>> {
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
async fn proxy(
    client: &Arc<HttpClient>,
    request: &ProxyRequest,
) -> Result<ProxyResponse, SyncError> {
    let before = record(client).await?;
    let error = match client.proxy_in(request, before.generation).await {
        Err(error) if error.code() == "UNAUTHENTICATED" => error,
        other => return other,
    };
    let after = record(client).await?;
    if after.generation != before.generation && after.tokens.is_some() && !after.deactivated {
        return client.proxy_in(request, after.generation).await;
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
    let (code, status) = refusal.code_and_status();
    let body = envelope::error(code, refusal.message(), None);
    let body = if unsupported_filters.is_empty() {
        body
    } else {
        envelope::with_offline(
            body,
            &OfflineMeta {
                unsupported_filters,
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
