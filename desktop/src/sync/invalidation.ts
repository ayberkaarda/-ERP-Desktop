// `resources_changed` → React Query invalidation. Mapped manifest resources
// invalidate only their own query key roots (the web resourceKeys table);
// `all`, an unmapped resource or a missing company invalidate everything,
// which is always correct, only slower.

import type { QueryClient } from '@tanstack/react-query'

import type { ResourcesChange } from './store'
import { invalidateResources } from '@/lib/sync/resourceKeys'

export async function invalidateChanged(
  client: QueryClient,
  change: ResourcesChange,
  company: string | null,
): Promise<void> {
  if (change.all || company === null) {
    await client.invalidateQueries()
    return
  }
  await invalidateResources(client, change.resources, company)
}
