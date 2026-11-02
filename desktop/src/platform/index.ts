// Desktop implementation of the web Platform contract (http, connectivity,
// notify, realtime, session) over Tauri commands and events. This file is the
// package's only public surface; runtime.ts is reached by the build swap, not
// through here.
export {
  createDesktopPlatform,
  desktopBridgeOf,
  DESKTOP_BRIDGE_EVENTS,
  isDesktopPlatform,
  isPlatformCancelled,
  PlatformCancelledError,
  PendingWorkError,
  PENDING_WORK,
  REALTIME_EVENT_NAMES,
  type DesktopBridge,
  type DesktopPlatform,
  type DesktopSession,
  type OfflineMeta,
  type OfflineMetaStore,
  type PendingWork,
  type PendingWorkDecision,
  type PendingWorkHandler,
} from './desktop'
