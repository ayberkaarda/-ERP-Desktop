// Sync status badges, outbox panel, Conflict Inbox and freshness strip.
// This file is the package's only public surface.
import { createElement } from 'react'

import { useOnlineOnlyState } from '../../sync'
import type { ExtensionPart } from '../../app/compose'
import { ConflictInboxPage } from './ConflictInboxPage'
import { useSyncDeps } from './context'
import { OutboxPage } from './OutboxPage'
import { CONFLICTS_PATH, OUTBOX_PATH } from './paths'
import { SyncHeader } from './SyncHeader'

export { ConflictInboxPage } from './ConflictInboxPage'
export { SyncDepsProvider, useSyncDeps } from './context'
export { FreshnessStrip } from './FreshnessStrip'
export { OutboxPage } from './OutboxPage'
export { CONFLICTS_PATH, OUTBOX_PATH } from './paths'
export { SyncHeader } from './SyncHeader'

/** Online-only answer of the running platform (available until it is known). */
export function useDesktopOnlineOnly(action: string) {
  return useOnlineOnlyState(useSyncDeps()?.connectivity ?? null, action)
}

/** What the sync package adds to the web app (see app/extensions.tsx). */
export const syncExtensions: ExtensionPart = {
  HeaderExtras: SyncHeader,
  routes: [
    { path: OUTBOX_PATH.slice(1), element: createElement(OutboxPage) },
    { path: CONFLICTS_PATH.slice(1), element: createElement(ConflictInboxPage) },
  ],
  useOnlineOnly: useDesktopOnlineOnly,
}
