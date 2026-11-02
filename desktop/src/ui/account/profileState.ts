import type { CommandError } from '../../bridge/generated/CommandError'
import type { ProfilePhase } from '../../bridge/generated/ProfilePhase'
import type { ProfileStateDto } from '../../bridge/generated/ProfileStateDto'

export const PROFILE_STATE_EVENT = 'profile-state'

const PHASES = new Set<ProfilePhase>(['none', 'starting', 'ready', 'engineless', 'failed'])

/** The error of a state, keeping only fields of the expected type (text is rendered as is). */
function cleanError(error: Record<string, unknown>, code: string): CommandError {
  const { message, retry_after: retryAfter, path } = error
  return {
    code,
    message: typeof message === 'string' ? message : '',
    ...(typeof retryAfter === 'number' ? { retry_after: retryAfter } : {}),
    ...(typeof path === 'string' ? { path } : {}),
  }
}

/** A `profile-state` payload (or `profile_state` answer), or undefined when it is not one. */
export function parseProfileState(payload: unknown): ProfileStateDto | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const { phase, profile_id: id, error } = payload as Record<string, unknown>
  if (typeof phase !== 'string' || !PHASES.has(phase as ProfilePhase)) return undefined
  if (id !== undefined && id !== null && typeof id !== 'string') return undefined
  if (error === undefined || error === null) return payload as ProfileStateDto
  if (typeof error !== 'object') return undefined
  const { code } = error as { code?: unknown }
  if (typeof code !== 'string') return undefined
  return { ...(payload as ProfileStateDto), error: cleanError(error as Record<string, unknown>, code) }
}
