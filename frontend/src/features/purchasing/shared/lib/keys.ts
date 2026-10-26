import type { QueryClient } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import type { PurchaseKind } from '../types'

/** The active company; mutations capture it at start so late results land in the right cache. */
export const activeCompany = () => useCompanyStore.getState().activeCompanyId ?? 'none'

// Every key starts with ["purchasing", companyId]; receipts / invoices / returns live under the
// same root, so a conversion here refreshes their lists too.
const root = (company = activeCompany()) => ['purchasing', company] as const

const branch = (kind: PurchaseKind) =>
  kind === 'request' ? 'requests' : kind === 'rfq' ? 'rfqs' : 'orders'

export const purchKeys = {
  all: (company?: string) => root(company),
  list: (kind: PurchaseKind, q: ListQueryState) => [...root(), branch(kind), 'list', q] as const,
  detail: (kind: PurchaseKind, id: string, company?: string) =>
    [...root(company), branch(kind), 'detail', id] as const,
  comparison: (id: string) => [...root(), 'rfqs', 'comparison', id] as const,
  preview: (payload: string) => [...root(), 'preview', payload] as const,
  exposure: (partyId: string) => [...root(), 'exposure', partyId] as const,
  overReceipt: () => [...root(), 'settings', 'over-receipt'] as const,
}

/** After any state change in `company`: lists, details, exposure and downstream lists may be stale. */
export function invalidatePurchasing(queryClient: QueryClient, company: string): void {
  void queryClient.invalidateQueries({ queryKey: root(company) })
}
