//! `sync_*`, `outbox_*` and `conflicts_*` commands over the active
//! profile's engine. Engine store work runs on a blocking thread.

use keystone_sync::conflicts::ResolutionAction;
use keystone_sync::engine::Trigger;
use keystone_sync::wire::ConflictChoice;
use tauri::State;
use uuid::Uuid;

use crate::bootstrap::codes;
use crate::commands::{CommandError, CommandResult};
use crate::dto::status::{
    ConflictDto, ConflictResolveDto, OutboxEntryDto, ResolutionDto, StatusDto,
};
use crate::state::{AppState, Engine};

#[tauri::command]
pub fn sync_now(state: State<'_, AppState>) -> CommandResult<()> {
    now(&state)
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
        Err(CommandError::new(
            crate::commands::codes::ENGINE_UNAVAILABLE,
            "the active profile does not sync (no company chosen or no local store)",
        ))
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
