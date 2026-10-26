import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'

/**
 * TanStack Query key factory for one company. Every key starts with ["accounting", companyId]
 * so cached data of one company is never served after switching to another, and a reset can
 * still drop all accounting data through the "accounting" prefix.
 */
export function accKeysFor(company: string | null) {
  const scope = ['accounting', company ?? 'no-company'] as const
  return {
    all: scope,
    accounts: () => [...scope, 'accounts'] as const,
    accountList: (query: ListQueryState) => [...scope, 'accounts', 'list', query] as const,
    accountTree: () => [...scope, 'accounts', 'tree'] as const,
    account: (id: string) => [...scope, 'accounts', 'one', id] as const,
    balance: (id: string, asOf: string) => [...scope, 'accounts', 'balance', id, asOf] as const,
    fiscalYears: () => [...scope, 'fiscal-years'] as const,
    closingPreview: (id: string) => [...scope, 'fiscal-years', 'preview', id] as const,
    periods: (yearId?: string) =>
      yearId ? ([...scope, 'periods', yearId] as const) : ([...scope, 'periods'] as const),
    rules: () => [...scope, 'determination-rules'] as const,
  }
}

export type AccKeys = ReturnType<typeof accKeysFor>

/** Keys of the active company; re-renders on a company switch so the keys move with it. */
export function useAccKeys(): AccKeys {
  return accKeysFor(useCompanyStore((s) => s.activeCompanyId))
}
