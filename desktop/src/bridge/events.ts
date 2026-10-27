// Typed `listen` for the shell's events. A payload that does not have the
// documented shape is dropped (and reported to `onInvalid`), never passed on.

import type { EngineEvent } from './generated/EngineEvent'

export type { EngineEvent }

/** Name of the Tauri event the engine bridge emits (`ENGINE_EVENT` in Rust). */
export const ENGINE_EVENT = 'engine-event'

export type Unlisten = () => void
export type Listen = (
  event: string,
  handler: (event: { payload: unknown }) => void,
) => Promise<Unlisten>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/** The `engine-event` payload as a typed event, or `undefined` when malformed. */
export function parseEngineEvent(payload: unknown): EngineEvent | undefined {
  if (!isRecord(payload) || typeof payload.profile_id !== 'string') return undefined
  if (payload.type === 'status') {
    const status = payload.status
    if (!isRecord(status) || typeof status.state !== 'string') return undefined
    return payload as unknown as EngineEvent
  }
  if (payload.type === 'resources_changed') {
    if (!isStringArray(payload.resources) || typeof payload.all !== 'boolean') return undefined
    return payload as unknown as EngineEvent
  }
  return undefined
}

/** Subscribes to `engine-event`; returns the unsubscribe function. */
export function listenEngine(
  listen: Listen,
  handler: (event: EngineEvent) => void,
  onInvalid?: (payload: unknown) => void,
): Promise<Unlisten> {
  return listen(ENGINE_EVENT, ({ payload }) => {
    const event = parseEngineEvent(payload)
    if (event) handler(event)
    else onInvalid?.(payload)
  })
}
