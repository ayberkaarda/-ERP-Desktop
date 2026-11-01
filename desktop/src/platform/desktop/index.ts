// Builds the desktop `Platform` from Tauri's `invoke` and `listen` (passed in,
// so tests use the fake bridge and only runtime.ts binds the real ones).

import type { Listen } from '../../bridge/events'
import type { Invoke } from '../../bridge/invoke'
import { createDesktopConnectivity } from './connectivity'
import { createDesktopHttp } from './http'
import { createDesktopNotify } from './notify'
import { createOfflineMetaStore, type OfflineMetaStore } from './offlineMeta'
import { createActiveProfile } from './profile'
import { createDesktopRealtime } from './realtime'
import { createDesktopSession, type DesktopSession, type PendingWorkHandler } from './session'
import type { Notify, Platform, PlatformDeps } from '@/platform/types'

export interface DesktopPlatform extends Platform {
  kind: 'desktop'
  session: DesktopSession
  desktop: {
    /** `meta.offline` of the last local answer per API path. */
    offlineMeta: OfflineMetaStore
    /** Reads the active profile again (after a profile was added, selected or removed). */
    refreshProfile(): Promise<string | null>
    /** Who decides about unsent work on sign-out or company switch (the desktop dialog). */
    setPendingWorkHandler(handler: PendingWorkHandler | null): void
    /** Stops the event listeners (tests, hot reload). */
    dispose(): void
  }
}

export function isDesktopPlatform(platform: Platform): platform is DesktopPlatform {
  return platform.kind === 'desktop' && 'desktop' in platform
}

export function createDesktopPlatform(options: {
  deps: PlatformDeps
  invoke: Invoke
  listen: Listen
  notify?: Notify
}): DesktopPlatform {
  const { deps, invoke, listen } = options
  const offlineMeta = createOfflineMetaStore()
  const profile = createActiveProfile(invoke)
  const connectivity = createDesktopConnectivity({ invoke, listen, profile })
  const realtime = createDesktopRealtime({ invoke, listen, profile })
  const stopProfile = profile.subscribe(() => {
    offlineMeta.clear()
  })
  const http = createDesktopHttp({ invoke, deps, network: connectivity.network, offlineMeta })
  let pendingWork: PendingWorkHandler | null = null
  const session = createDesktopSession({
    invoke,
    pendingWork: () => pendingWork ?? undefined,
    onChanged: () => {
      offlineMeta.clear()
    },
  })
  void profile.refresh()

  return {
    kind: 'desktop',
    http,
    connectivity,
    notify: options.notify ?? createDesktopNotify(),
    realtime,
    session,
    desktop: {
      offlineMeta,
      refreshProfile: () => profile.refresh(),
      setPendingWorkHandler: (handler) => {
        pendingWork = handler
      },
      dispose: () => {
        stopProfile()
        connectivity.dispose()
        realtime.dispose()
      },
    },
  }
}

export {
  PendingWorkError,
  PENDING_WORK,
  type DesktopSession,
  type PendingWork,
  type PendingWorkDecision,
  type PendingWorkHandler,
} from './session'
export { isPlatformCancelled, PlatformCancelledError } from '@/platform/shared'
export type { OfflineMeta, OfflineMetaStore } from './offlineMeta'
export { REALTIME_EVENT_NAMES } from './realtime'
