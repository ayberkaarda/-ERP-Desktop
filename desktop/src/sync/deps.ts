// What the sync package takes from the running platform. Only the swapped
// runtime binds the real Tauri `invoke`/`listen`, so the bridge comes from the
// desktop platform object (`platform.desktop.bridge`); without it the screens
// that need commands stay hidden and the rest (online-only, freshness) works.

import { isDesktopPlatform } from '../platform'
import type { OfflineMetaSource } from './freshness'
import type { SyncBridge } from './store'
import type { Connectivity, HttpClient, Notify, Platform } from '@/platform/types'

export interface SyncDeps {
  bridge: SyncBridge | null
  connectivity: Connectivity
  offlineMeta: OfflineMetaSource | null
  http: HttpClient
  notify: Notify
}

function bridgeOf(desktop: object): SyncBridge | null {
  if (!('bridge' in desktop)) return null
  const offered = desktop.bridge as Partial<SyncBridge> | null | undefined
  if (typeof offered?.invoke !== 'function' || typeof offered.listen !== 'function') return null
  return { invoke: offered.invoke, listen: offered.listen }
}

export function syncDepsOf(platform: Platform): SyncDeps {
  const desktop = isDesktopPlatform(platform) ? platform.desktop : null
  return {
    bridge: desktop ? bridgeOf(desktop) : null,
    connectivity: platform.connectivity,
    offlineMeta: desktop?.offlineMeta ?? null,
    http: platform.http,
    notify: platform.notify,
  }
}

let loaded: SyncDeps | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/**
 * The running platform's deps. The web `@/platform` module builds the platform
 * when it is first imported, so it is imported on first use, never by loading
 * this package (tests and the package surface stay free of a Tauri runtime).
 */
export const platformSyncDeps = {
  get: (): SyncDeps | null => loaded,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    loading ??= import('@/platform').then(({ platform }) => {
      loaded = syncDepsOf(platform)
      for (const l of [...listeners]) l()
    })
    return () => {
      listeners.delete(listener)
    }
  },
}
