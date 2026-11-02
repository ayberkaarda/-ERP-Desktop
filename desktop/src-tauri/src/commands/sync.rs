//! `sync_*`, `outbox_*` and `conflicts_*` commands over the active
//! profile's engine. Engine store work runs on a blocking thread.

use std::time::Duration;

use keystone_sync::conflicts::ResolutionAction;
use keystone_sync::engine::{SyncState, Trigger};
use keystone_sync::wire::ConflictChoice;
use tauri::State;
use uuid::Uuid;

use crate::bootstrap::codes;
use crate::commands::{CommandError, CommandResult};
use crate::dto::status::{
    ConflictDto, ConflictResolveDto, OutboxEntryDto, ResolutionDto, StatusDto,
};
use crate::router::{Connectivity, PROBE_WAIT};
use crate::state::{AppState, Engine};

/// Asks for a run now and waits up to [`PROBE_WAIT`] for its verdict, so
/// that "sync now" after the server came back finds it in this call. A run
/// that takes longer goes on in the background.
#[tauri::command]
pub async fn sync_now<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    use tauri::Manager;
    match app.try_state::<Connectivity>() {
        Some(connectivity) => now_and_wait(&state, &connectivity, PROBE_WAIT).await,
        None => now(&state),
    }
}

/// [`now`], then waits up to `wait` for the verdict ([`probe`]).
pub async fn now_and_wait(
    state: &AppState,
    connectivity: &Connectivity,
    wait: Duration,
) -> CommandResult<()> {
    let id = state.active_profile_id().ok_or_else(|| {
        CommandError::new(
            crate::commands::codes::NO_ACTIVE_PROFILE,
            "no server profile is selected",
        )
    })?;
    match probe(state, connectivity, &id, Trigger::Manual, wait).await? {
        Some(_) => Ok(()),
        None => Err(no_loop()),
    }
}

/// Sends `trigger` to the loop of `profile` and waits up to `wait` for the
/// verdict of the run: `Some(true)` when the server answered, `Some(false)`
/// when it did not or no verdict came in time (a slow run, a run that was
/// cut short; it goes on). `None`: the profile has no running loop. A
/// verdict is recorded in `connectivity` at once, so the next request is
/// routed by it.
///
/// The verdict: from `Offline`, the first sign that the server answered
/// (the engine leaves `Offline` only then), else the state the run ended in.
pub async fn probe(
    state: &AppState,
    connectivity: &Connectivity,
    profile: &str,
    trigger: Trigger,
    wait: Duration,
) -> CommandResult<Option<bool>> {
    let Ok(engine) = state.engine() else {
        return Ok(None);
    };
    let mut status = engine.subscribe();
    let mut passes = engine.subscribe_passes();
    let was_offline = status.borrow_and_update().state == SyncState::Offline;
    passes.borrow_and_update();
    if !state.trigger(profile, trigger)? {
        return Ok(None);
    }
    let verdict = tokio::time::timeout(wait, async {
        loop {
            tokio::select! {
                changed = status.changed() => {
                    changed.ok()?;
                    let state = status.borrow_and_update().state.clone();
                    if was_offline && state != SyncState::Offline {
                        return Some(true);
                    }
                }
                changed = passes.changed() => {
                    changed.ok()?;
                    passes.borrow_and_update();
                    return Some(engine.status().state != SyncState::Offline);
                }
            }
        }
    })
    .await
    .ok()
    .flatten();
    if let Some(reached) = verdict {
        connectivity.observe(profile, reached, tokio::time::Instant::now().into_std());
    }
    Ok(Some(verdict == Some(true)))
}

fn no_loop() -> CommandError {
    CommandError::new(
        crate::commands::codes::ENGINE_UNAVAILABLE,
        "the active profile does not sync (no company chosen or no local store)",
    )
}

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> CommandResult<StatusDto> {
    status(&state).await
}

#[tauri::command]
pub async fn outbox_list(state: State<'_, AppState>) -> CommandResult<Vec<OutboxEntryDto>> {
    with_engine(&state, |engine| {
        Ok(engine
            .outbox_entries()?
            .iter()
            .map(OutboxEntryDto::from)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn outbox_retry(state: State<'_, AppState>, key: Uuid) -> CommandResult<()> {
    with_engine(&state, move |engine| Ok(engine.retry(key)?)).await?;
    // A retried entry goes out with the next run, not a minute later.
    let _ = now(&state);
    Ok(())
}

#[tauri::command]
pub async fn outbox_discard(state: State<'_, AppState>, key: Uuid) -> CommandResult<()> {
    with_engine(&state, move |engine| Ok(engine.discard(key)?)).await
}

#[tauri::command]
pub async fn conflicts_list(state: State<'_, AppState>) -> CommandResult<Vec<ConflictDto>> {
    with_engine(&state, |engine| {
        Ok(engine
            .conflict_records()?
            .iter()
            .map(ConflictDto::from)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn conflicts_resolve(
    state: State<'_, AppState>,
    decision: ConflictResolveDto,
) -> CommandResult<ResolutionDto> {
    resolve(&state, decision).await
}

/// Asks the active profile's loop for a run now.
pub fn now(state: &AppState) -> CommandResult<()> {
    if crate::bootstrap::trigger(state, Trigger::Manual)? {
        Ok(())
    } else {
        Err(no_loop())
    }
}

pub async fn status(state: &AppState) -> CommandResult<StatusDto> {
    with_engine(state, |engine| {
        Ok(StatusDto::from(&engine.refresh_status()?))
    })
    .await
}

pub async fn resolve(
    state: &AppState,
    decision: ConflictResolveDto,
) -> CommandResult<ResolutionDto> {
    let choice: ConflictChoice =
        serde_json::from_value(serde_json::Value::String(decision.choice.clone()))
            .map_err(|_| invalid("unknown conflict choice"))?;
    let key = decision.idempotency_key;
    let action = with_engine(state, move |engine| {
        let action = match choice {
            ConflictChoice::UseExisting => {
                let candidate = decision
                    .candidate
                    .ok_or_else(|| invalid("use_existing needs a candidate"))?;
                engine.resolve_conflict_use_existing(key, candidate)?
            }
            ConflictChoice::Merge => {
                let merged = decision
                    .merged
                    .ok_or_else(|| invalid("merge needs the merged payload"))?;
                engine.resolve_conflict_merge(key, merged)?
            }
            other => engine.resolve_conflict(key, other)?,
        };
        Ok(match action {
            ResolutionAction::Enqueue(mutation) => {
                engine.enqueue(mutation)?;
                "queued"
            }
            ResolutionAction::TakeServer(_) => "take_server",
            ResolutionAction::UseExisting(_) => "use_existing",
            ResolutionAction::Discard => "discard",
        })
    })
    .await?;
    if action == "queued" {
        let _ = now(state);
    }
    Ok(ResolutionDto {
        action: action.to_owned(),
    })
}

fn invalid(message: &str) -> CommandError {
    keystone_sync::SyncError::InvalidRequest(message.to_owned()).into()
}

async fn with_engine<T: Send + 'static>(
    state: &AppState,
    work: impl FnOnce(&Engine) -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    let engine = state.engine()?;
    tauri::async_runtime::spawn_blocking(move || work(&engine))
        .await
        .unwrap_or_else(|_| {
            Err(CommandError::new(
                codes::TASK_FAILED,
                "the local task stopped",
            ))
        })
}
