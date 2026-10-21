import type { QueryClient } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import type { SalesKind } from '../types'

/** The active company; mutations capture it at start so late results land in the right cache. */
export const activeCompany = () => useCompanyStore.getState().activeCompanyId ?? 'none'

// Every key starts with ["sales", companyId]; fe-sales2 uses other branches under the same root.
const root = (company = activeCompany()) => ['sales', company] as const

const branch = (kind: SalesKind) => (kind === 'quote' ? 'quotes' : 'orders')

export const salesKeys = {
  all: (company?: string) => root(company),
  documents: (kind: SalesKind, company?: string) => [...root(company), branch(kind)] as const,
  list: (kind: SalesKind, q: ListQueryState) => [...root(), branch(kind), 'list', q] as const,
  detail: (kind: SalesKind, id: string, company?: string) =>
    [...root(company), branch(kind), 'detail', id] as const,
  preview: (payload: string) => [...root(), 'preview', payload] as const,
  exposure: (partyId: string, company?: string) => [...root(company), 'exposure', partyId] as const,
  itemStock: (itemId: string) => [...root(), 'lookups', 'item-stock', itemId] as const,
  itemUnits: (itemId: string) => [...root(), 'lookups', 'item-units', itemId] as const,
  units: () => [...root(), 'lookups', 'units'] as const,
  approval: (id: string) => [...root(), 'approval', id] as const,
}

/**
 * After a state change of a quote or order in `company`: both lists, the exposure of customers
 * and the fe-sales2 branches (deliveries, invoices) may be stale.
 */
export function invalidateSales(queryClient: QueryClient, company: string): void {
  void queryClient.invalidateQueries({ queryKey: root(company) })
}
