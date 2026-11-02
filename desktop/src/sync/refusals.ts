// Reactive fallback for server-only actions that were not disabled in time:
// the shell refuses them offline (503 OFFLINE_UNAVAILABLE) or while the offline
// manifests differ (422 SYNC_OFFLINE_WRITE_NOT_ALLOWED). A failed mutation with
// one of these errors is reported once, so the user gets a translated reason.

import type { QueryClient } from '@tanstack/react-query'

import { isApiError } from '@/platform/types'

export type OfflineRefusal = 'offline' | 'manifest'

export function offlineRefusalOf(error: unknown): OfflineRefusal | null {
  if (!isApiError(error)) return null
  if (error.status === 503 && error.code === 'OFFLINE_UNAVAILABLE') return 'offline'
  if (error.status === 422 && error.code === 'SYNC_OFFLINE_WRITE_NOT_ALLOWED') return 'manifest'
  return null
}

export function watchOfflineRefusals(
  client: QueryClient,
  onRefusal: (refusal: OfflineRefusal) => void,
): () => void {
  return client.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return
    const refusal = offlineRefusalOf(event.action.error)
    if (refusal) onRefusal(refusal)
  })
}
