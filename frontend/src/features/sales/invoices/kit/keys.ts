import type { QueryClient } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'

/** The active company; mutations capture it at start so late results land in the right cache. */
export const activeCompany = () => useCompanyStore.getState().activeCompanyId ?? 'none'

// Every key starts with ["sales", companyId]; this lane owns the deliveries, invoices, returns,
// reports and customers branches. Pass `company` when writing results of work started under
// another company.
const root = (company = activeCompany()) => ['sales', company] as const

export type DocBranch = 'deliveries' | 'invoices' | 'returns'

export const salesDocsKeys = {
  all: (company?: string) => root(company),
  branch: (branch: DocBranch, company?: string) => [...root(company), branch] as const,
  list: (branch: DocBranch, q: ListQueryState) => [...root(), branch, 'list', q] as const,
  detail: (branch: DocBranch, id: string, company?: string) =>
    [...root(company), branch, 'detail', id] as const,
  print: (branch: DocBranch, id: string) => [...root(), branch, 'print', id] as const,
  /** Source order of a delivery or invoice (read-only view of fe-sales1's resource). */
  orderSource: (id: string) => [...root(), 'deliveries', 'order-source', id] as const,
  lots: (itemId: string, warehouseId: string) =>
    [...root(), 'deliveries', 'lots', itemId, warehouseId] as const,
  customers: (company?: string) => [...root(company), 'customers'] as const,
  exposure: (partyId: string) => [...root(), 'customers', partyId, 'exposure'] as const,
  summary: (partyId: string, params: Record<string, string>) =>
    [...root(), 'customers', partyId, 'summary', params] as const,
  reports: (company?: string) => [...root(company), 'reports'] as const,
  report: (slug: string, params: Record<string, string>) =>
    [...root(), 'reports', slug, params] as const,
}

/**
 * Keys of other areas a posted/issued/reversed sales document makes stale: fe-sales1's orders
 * (delivered/invoiced quantities), the stock screens and the journal of that company.
 */
export function foreignKeys(company: string) {
  return [
    ['sales', company, 'orders'],
    ['inventory', company],
    ['accounting-journal', company],
  ] as const
}

/** After a document changed state in `company`: sales lists, reports, exposure and neighbours. */
export function invalidateSalesEffects(queryClient: QueryClient, company: string): void {
  for (const queryKey of [
    salesDocsKeys.branch('deliveries', company),
    salesDocsKeys.branch('invoices', company),
    salesDocsKeys.branch('returns', company),
    salesDocsKeys.customers(company),
    salesDocsKeys.reports(company),
    ...foreignKeys(company),
  ]) {
    void queryClient.invalidateQueries({ queryKey })
  }
}
