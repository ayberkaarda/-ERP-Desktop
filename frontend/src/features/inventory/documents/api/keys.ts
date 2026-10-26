import type { QueryClient } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'

/** The active company; mutations capture it at start so late results land in the right cache. */
export const activeCompany = () => useCompanyStore.getState().activeCompanyId ?? 'none'

// Every key starts with ["inventory", companyId] (the convention shared with the stock screens,
// whose keys live under ["inventory", companyId, "stock-views"]); this lane uses the "docs"
// branch. Pass `company` explicitly when writing results of work started under another company.
const root = (company = activeCompany()) => ['inventory', company, 'docs'] as const

/** The stock screens' branches whose data a posted or reversed document changes. */
const STOCK_VIEWS = ['balances', 'movements', 'lots', 'serials'] as const

export const invDocsKeys = {
  all: (company?: string) => root(company),
  documents: (company?: string) => [...root(company), 'documents'] as const,
  documentList: (q: ListQueryState) => [...root(), 'documents', 'list', q] as const,
  document: (id: string, company?: string) =>
    [...root(company), 'documents', 'detail', id] as const,
  reservations: (company?: string) => [...root(company), 'reservations'] as const,
  reservationList: (q: ListQueryState) => [...root(), 'reservations', 'list', q] as const,
  units: (company?: string) => [...root(company), 'lookups', 'units'] as const,
  categories: () => [...root(), 'lookups', 'categories'] as const,
  item: (id: string, company?: string) => [...root(company), 'lookups', 'item', id] as const,
  items: (ids: readonly string[]) => [...root(), 'lookups', 'items', [...ids].sort()] as const,
  lot: (id: string) => [...root(), 'lookups', 'lot', id] as const,
  itemLots: (itemId: string) => [...root(), 'lookups', 'item-lots', itemId] as const,
  itemUnits: (itemId: string) => [...root(), 'lookups', 'item-units', itemId] as const,
  reports: (company?: string) => [...root(company), 'reports'] as const,
  report: (name: string, params: Record<string, string>) =>
    [...root(), 'reports', name, params] as const,
  /** Stock screen keys (fe-inv1: ["inventory", companyId, "stock-views", <branch>]). */
  stockViews: (company: string) =>
    STOCK_VIEWS.map((b) => ['inventory', company, 'stock-views', b] as const),
}

/**
 * After a document is posted or reversed in `company`: its lists, the reports, reservations and
 * the stock screens (balances, movements, lots, serials) of that company are stale.
 */
export function invalidateStockEffects(queryClient: QueryClient, company: string): void {
  for (const queryKey of [
    invDocsKeys.documents(company),
    invDocsKeys.reports(company),
    invDocsKeys.reservations(company),
    ...invDocsKeys.stockViews(company),
  ]) {
    void queryClient.invalidateQueries({ queryKey })
  }
}
