// Reactive fallback for server-only actions that were not disabled in time:
// the shell refuses them offline (503 OFFLINE_UNAVAILABLE) or while the offline
// manifests differ (422 SYNC_OFFLINE_WRITE_NOT_ALLOWED). A failed mutation with
// one of these errors is reported once. When the error names the refused
// request (`details.method` / `details.path`), the manifest route table gives
// the action, and the toast says why that action needs the server.

import type { QueryClient } from '@tanstack/react-query'

import { onlineOnlyAction, type OnlineOnlyAction } from '../wire'
import type { DesktopText } from './text'
import { isApiError } from '@/platform/types'

export type OfflineRefusal = 'offline' | 'manifest'

export interface OfflineRefusalEvent {
  kind: OfflineRefusal
  /** The online-only action of the refused route; `null` when the route is unknown. */
  action: OnlineOnlyAction | null
}

function actionOf(details: Record<string, unknown>): OnlineOnlyAction | null {
  const { method, path } = details
  if (typeof method !== 'string' || typeof path !== 'string') return null
  return onlineOnlyAction(method, path)?.action ?? null
}

export function offlineRefusalOf(error: unknown): OfflineRefusalEvent | null {
  if (!isApiError(error)) return null
  if (error.status === 503 && error.code === 'OFFLINE_UNAVAILABLE') {
    return { kind: 'offline', action: actionOf(error.details) }
  }
  if (error.status === 422 && error.code === 'SYNC_OFFLINE_WRITE_NOT_ALLOWED') {
    return { kind: 'manifest', action: actionOf(error.details) }
  }
  return null
}

export function refusalMessage(text: DesktopText, event: OfflineRefusalEvent): string {
  if (event.kind === 'offline' && event.action !== null) return text.onlineOnly(event.action)
  return text.td(`sync.refusal.${event.kind}`)
}

export function watchOfflineRefusals(
  client: QueryClient,
  onRefusal: (event: OfflineRefusalEvent) => void,
): () => void {
  return client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return
    const refusal = offlineRefusalOf(event.action.error)
    if (refusal) onRefusal(refusal)
  })
}
