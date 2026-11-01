// Which shell profile is active, so events of a profile the user has left are
// dropped. Read with `profile_list`; read again when an event names another
// profile (a switch the adapter has not seen yet, or late news of the old one).

import type { ProfilesDto } from '../../bridge/generated/ProfilesDto'
import { call, type Invoke } from '../../bridge/invoke'

export interface ActiveProfile {
  /** `undefined` until the first read finished; `null` when no profile is active. */
  current(): string | null | undefined
  /** Reads the active profile again (concurrent calls share one read). */
  refresh(): Promise<string | null>
  /** Runs `deliver` if `profileId` is the active profile, checking again first if it is not. */
  accept(profileId: string, deliver: () => void): void
  /** Called with the new id on every change (the first read included). */
  subscribe(listener: (id: string | null) => void): () => void
}

export function createActiveProfile(invoke: Invoke): ActiveProfile {
  let current: string | null | undefined
  let reading: Promise<string | null> | null = null
  const listeners = new Set<(id: string | null) => void>()

  const refresh = (): Promise<string | null> => {
    reading ??= call<ProfilesDto>(invoke, 'profile_list')
      .then(
        (dto) => dto.active_id ?? null,
        () => null,
      )
      .then((id) => {
        reading = null
        if (id !== current) {
          current = id
          for (const listener of [...listeners]) listener(id)
        }
        return id
      })
    return reading
  }

  return {
    current: () => current,
    refresh,
    accept: (profileId, deliver) => {
      if (current === profileId) {
        deliver()
        return
      }
      void refresh().then((id) => {
        if (id === profileId) deliver()
      })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
