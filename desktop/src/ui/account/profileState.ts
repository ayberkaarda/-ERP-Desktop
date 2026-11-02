import type { ProfilePhase } from '../../bridge/generated/ProfilePhase'
import type { ProfileStateDto } from '../../bridge/generated/ProfileStateDto'

export const PROFILE_STATE_EVENT = 'profile-state'

const PHASES = new Set<ProfilePhase>(['none', 'starting', 'ready', 'engineless', 'failed'])

/** A `profile-state` payload, or undefined when it is not one. */
export function parseProfileState(payload: unknown): ProfileStateDto | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const { phase, profile_id: id, error } = payload as Record<string, unknown>
  if (typeof phase !== 'string' || !PHASES.has(phase as ProfilePhase)) return undefined
  if (id !== undefined && id !== null && typeof id !== 'string') return undefined
  if (error !== undefined && error !== null) {
    if (typeof error !== 'object' || typeof (error as { code?: unknown }).code !== 'string') return undefined
  }
  return payload as ProfileStateDto
}
