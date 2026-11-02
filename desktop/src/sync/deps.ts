// What the sync package takes from the running platform: the shell bridge
// (`platform.desktop.bridge`), connectivity, http, notify and the offline meta
// store. A web platform has neither bridge nor offline meta.

import { desktopBridgeOf, isDesktopPlatform } from '../platform'
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

export function syncDepsOf(platform: Platform): SyncDeps {
  return {
    bridge: desktopBridgeOf(platform) ?? null,
    connectivity: platform.connectivity,
    offlineMeta: isDesktopPlatform(platform) ? platform.desktop.offlineMeta : null,
    http: platform.http,
    notify: platform.notify,
  }
}
