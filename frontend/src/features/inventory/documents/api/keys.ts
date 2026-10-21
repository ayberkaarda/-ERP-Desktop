import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'

/** The active company; mutations capture it at start so late results land in the right cache. */
export const activeCompany = () => useCompanyStore.getState().activeCompanyId ?? 'none'

// Every key starts with a company so a company switch never shows stale rows. Pass `company`
// explicitly when writing results of work started under another company.
const root = (company = activeCompany()) => ['inventory-docs', company] as const

export const invDocsKeys = {
  all: (company?: string) => root(company),
  documents: (company?: string) => [...root(company), 'documents'] as const,
  documentList: (q: ListQueryState) => [...root(), 'documents', 'list', q] as const,
  document: (id: string, company?: string) =>
    [...root(company), 'documents', 'detail', id] as const,
  reservations: (company?: string) => [...root(company), 'reservations'] as const,
  reservationList: (q: ListQueryState) => [...root(), 'reservations', 'list', q] as const,
  warehouses: () => [...root(), 'lookups', 'warehouses'] as const,
  locations: (warehouseId: string) => [...root(), 'lookups', 'locations', warehouseId] as const,
  units: () => [...root(), 'lookups', 'units'] as const,
  categories: () => [...root(), 'lookups', 'categories'] as const,
  item: (id: string) => [...root(), 'lookups', 'item', id] as const,
  itemUnits: (itemId: string) => [...root(), 'lookups', 'item-units', itemId] as const,
  report: (name: string, params: Record<string, string>) =>
    [...root(), 'reports', name, params] as const,
}
