import type { ListQueryState } from '@/components/shared/data-table'

/** TanStack Query key factory; every key starts with "reference" so mutations can invalidate by resource. */
export const refKeys = {
  all: ['reference'] as const,
  resource: (name: string) => ['reference', name] as const,
  list: (name: string, query: ListQueryState) => ['reference', name, 'list', query] as const,
  full: (name: string, scope?: string) => ['reference', name, 'all', scope ?? ''] as const,
  locations: (warehouseId: string) => ['reference', 'locations', warehouseId] as const,
  latestRates: () => ['reference', 'exchange-rates', 'latest'] as const,
  rateStatus: () => ['reference', 'exchange-rates', 'status'] as const,
  settings: () => ['reference', 'settings'] as const,
}
