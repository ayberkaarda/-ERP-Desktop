// Online means: the active profile's engine is not `offline`, and the server
// was not last found unreachable. The engine state comes from `sync_status`
// first, then from `engine-event` status events. Reachability comes from the
// requests this client sends and from the shell's `connectivity` events, which
// also cover what a request answer does not show (a read answered from this
// device after the server did not answer in time).

import { listenEngine, type Listen, type Unlisten } from '../../bridge/events'
import type { StatusDto } from '../../bridge/generated/StatusDto'
import { call, type Invoke } from '../../bridge/invoke'
import type { NetworkReport } from './http'
import type { ActiveProfile } from './profile'
import type { Connectivity } from '@/platform/types'

export interface DesktopConnectivity extends Connectivity {
  /** What the http client reports after each request. */
  network: NetworkReport
  /**
   * After a sign-out: the shell forgets what it announced for the profile and
   * may not announce its return, so the state starts over from the engine.
   */
  reset(): void
  dispose(): void
}

export function createDesktopConnectivity(options: {
  invoke: Invoke
  listen: Listen
  profile: ActiveProfile
}): DesktopConnectivity {
  const { invoke, listen, profile } = options
  let engineOffline = false
  let networkDown = false
  // Bumped by every event, so an older `sync_status` answer is not applied over it.
  let version = 0
  const listeners = new Set<(online: boolean) => void>()

  const online = () => !engineOffline && !networkDown
  const update = (change: () => void) => {
    const before = online()
    change()
    const after = online()
    if (after !== before) for (const listener of [...listeners]) listener(after)
  }

  const readStatus = (id: string) => {
    const asked = version
    void call<StatusDto>(invoke, 'sync_status').then(
      (status) => {
        if (asked !== version || profile.current() !== id) return
        update(() => {
          engineOffline = status.state === 'offline'
        })
      },
      () => undefined,
    )
  }

  const startOver = (id: string | null | undefined) => {
    version += 1
    update(() => {
      engineOffline = false
      networkDown = false
    })
    if (typeof id === 'string') readStatus(id)
  }

  const stopProfile = profile.subscribe(startOver)

  const unlisten: Promise<Unlisten> = listenEngine(listen, (event) => {
    if (event.type === 'status') {
      profile.accept(event.profile_id, () => {
        version += 1
        update(() => {
          engineOffline = event.status.state === 'offline'
        })
      })
    } else if (event.type === 'connectivity') {
      profile.accept(event.profile_id, () => {
        version += 1
        update(() => {
          networkDown = !event.online
          if (event.online) engineOffline = false
        })
      })
    }
  })

  return {
    isOnline: online,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    network: {
      failed: () => {
        update(() => {
          networkDown = true
        })
      },
      answered: () => {
        version += 1
        update(() => {
          networkDown = false
          engineOffline = false
        })
      },
    },
    reset: () => {
      startOver(profile.current())
    },
    dispose: () => {
      stopProfile()
      void unlisten.then((stop) => {
        stop()
      })
    },
  }
}
