// Sync state store, engine event binding, query invalidation and the
// online-only hook. This file is the package's only public surface.
export {
  conflictChoices,
  mergedPayload,
  serverValue,
  type ConflictChoice,
  type FieldPick,
} from './conflicts'
export { platformSyncDeps, syncDepsOf, type SyncDeps } from './deps'
export {
  createFreshnessTracker,
  type Freshness,
  type FreshnessTracker,
  type OfflineMetaSource,
} from './freshness'
export { invalidateChanged } from './invalidation'
export { useOnlineOnlyState } from './onlineOnly'
export { offlineRefusalOf, watchOfflineRefusals, type OfflineRefusal } from './refusals'
export {
  createSyncStore,
  syncStoreFor,
  type ResourcesChange,
  type SyncBridge,
  type SyncSnapshot,
  type SyncStore,
} from './store'
export { createDesktopText, useDesktopText, type DesktopText } from './text'
