// Typed `listen` for the shell's events. A payload that does not have the
// documented shape is dropped (and reported to `onInvalid`), never passed on.

import type { EngineEvent } from './generated/EngineEvent'
import type { RealtimeEventDto } from './generated/RealtimeEventDto'
import type { RealtimeStateDto } from './generated/RealtimeStateDto'

export type { EngineEvent, RealtimeEventDto, RealtimeStateDto }

/** Name of the Tauri event the engine bridge emits (`ENGINE_EVENT` in Rust). */
export const ENGINE_EVENT = 'engine-event'

/** Name of the Tauri event the realtime bridge emits (`REALTIME_EVENT` in Rust). */
export const REALTIME_EVENT = 'realtime-event'

/** Name of the Tauri event the profile state machine emits (`PROFILE_STATE_EVENT` in Rust). */
export const PROFILE_STATE_EVENT = 'profile-state'

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
  if (payload.type === 'connectivity') {
    if (typeof payload.online !== 'boolean') return undefined
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

const REALTIME_STATES: readonly string[] = [
  'disabled',
  'idle',
  'connecting',
  'connected',
  'unavailable',
] satisfies RealtimeStateDto[]

/** The `realtime-event` payload as a typed event, or `undefined` when malformed. */
export function parseRealtimeEvent(payload: unknown): RealtimeEventDto | undefined {
  if (!isRecord(payload) || typeof payload.profile_id !== 'string') return undefined
  switch (payload.type) {
    case 'state':
      if (typeof payload.state !== 'string' || !REALTIME_STATES.includes(payload.state)) {
        return undefined
      }
      break
    case 'session_revoked':
      if (typeof payload.reason !== 'string') return undefined
      break
    case 'membership_revoked':
      if (typeof payload.company_id !== 'string') return undefined
      break
    case 'notification_created': {
      const notification = payload.notification
      if (!isRecord(notification) || typeof notification.id !== 'string') return undefined
      if (typeof notification.type !== 'string') return undefined
      if (typeof notification.created_at !== 'string') return undefined
      break
    }
    default:
      return undefined
  }
  return payload as unknown as RealtimeEventDto
}

/** Subscribes to `realtime-event`; returns the unsubscribe function. */
export function listenRealtime(
  listen: Listen,
  handler: (event: RealtimeEventDto) => void,
  onInvalid?: (payload: unknown) => void,
): Promise<Unlisten> {
  return listen(REALTIME_EVENT, ({ payload }) => {
    const event = parseRealtimeEvent(payload)
    if (event) handler(event)
    else onInvalid?.(payload)
  })
}
