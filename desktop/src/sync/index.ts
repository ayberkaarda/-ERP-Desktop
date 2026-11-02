// Sync state store, engine event binding, query invalidation and the
// online-only hook. This file is the package's only public surface.
export { mergedPayload, type FieldPick } from './conflicts'
export { syncDepsOf, type SyncDeps } from './deps'
export {
  createFreshnessTracker,
  type Freshness,
  type FreshnessTracker,
  type OfflineMetaSource,
} from './freshness'
export { invalidateChanged } from './invalidation'
export { useOnlineOnlyState } from './onlineOnly'
export {
  offlineRefusalOf,
  refusalMessage,
  watchOfflineRefusals,
  type OfflineRefusal,
  type OfflineRefusalEvent,
} from './refusals'
export {
  createSyncStore,
  syncStoreFor,
  type ResourcesChange,
  type SyncBridge,
  type SyncSnapshot,
  type SyncStore,
} from './store'
export { createDesktopText, useDesktopText, type DesktopText } from './text'
