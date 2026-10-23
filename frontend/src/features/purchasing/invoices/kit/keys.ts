import type { QueryClient } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'

/** The active company id ('none' before one is chosen); mutations capture it at start. */
export function activeCompany(): string {
  return useCompanyStore.getState().activeCompanyId ?? 'none'
}

// Every purchasing query key starts with ["purchasing", companyId].
const root = (company = activeCompany()) => ['purchasing', company] as const

export type DocBranch = 'receipts' | 'invoices' | 'returns'

export const purchKeys = {
  all: (company?: string) => root(company),
  branch: (branch: DocBranch, company?: string) => [...root(company), branch] as const,
  list: (branch: DocBranch, q: ListQueryState) => [...root(), branch, 'list', q] as const,
  detail: (branch: DocBranch, id: string, company?: string) =>
    [...root(company), branch, 'detail', id] as const,
  print: (branch: DocBranch, id: string) => [...root(), branch, 'print', id] as const,
  match: (id: string, company?: string) => [...root(company), 'invoices', 'match', id] as const,
  /** Source order of a receipt. */
  orderSource: (id: string) => [...root(), 'receipts', 'order-source', id] as const,
  /** A source invoice or receipt read by the return flow. */
  returnSource: (kind: 'invoice' | 'receipt', id: string) =>
    [...root(), 'returns', 'source', kind, id] as const,
  suppliers: (company?: string) => [...root(company), 'suppliers'] as const,
  exposure: (partyId: string) => [...root(), 'suppliers', partyId, 'exposure'] as const,
  summary: (partyId: string) => [...root(), 'suppliers', partyId, 'summary'] as const,
  performance: (partyId: string, params: Record<string, string>) =>
    [...root(), 'suppliers', partyId, 'performance', params] as const,
  reports: (company?: string) => [...root(company), 'reports'] as const,
  report: (slug: string, params: Record<string, string>) =>
    [...root(), 'reports', slug, params] as const,
}

/**
 * Keys of other areas a posted/booked/reversed purchasing document makes stale:
 * orders (received/invoiced quantities), the stock screens, the journal and account balances.
 */
export function foreignKeys(company: string) {
  return [
    ['purchasing', company, 'orders'],
    ['inventory', company],
    ['accounting-journal', company],
    ['accounting', company, 'accounts', 'balance'],
  ] as const
}

/** After a document changed state in `company`: purchasing lists, reports, suppliers, neighbours. */
export function invalidatePurchEffects(queryClient: QueryClient, company: string): void {
  for (const queryKey of [purchKeys.all(company), ...foreignKeys(company)]) {
    void queryClient.invalidateQueries({ queryKey })
  }
}
