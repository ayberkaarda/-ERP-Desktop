import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'

/**
 * TanStack Query keys of the stock, movement and lot screens for one company. Every key starts with
 * ["inventory", companyId, "stock-views"], so another company's data is never served after a
 * switch and the documents lane can use its own branch under ["inventory", companyId].
 */
export function invKeysFor(company: string | null) {
  const scope = ['inventory', company ?? 'no-company'] as const
  const base = [...scope, 'stock-views'] as const
  return {
    company: scope,
    all: base,
    balances: () => [...base, 'balances'] as const,
    balanceList: (query: ListQueryState) => [...base, 'balances', 'list', query] as const,
    itemStock: (itemId: string) => [...base, 'balances', 'item', itemId] as const,
    movements: () => [...base, 'movements'] as const,
    movementList: (params: Record<string, string>) =>
      [...base, 'movements', 'list', params] as const,
    lots: () => [...base, 'lots'] as const,
    lotList: (query: ListQueryState) => [...base, 'lots', 'list', query] as const,
    lotTrace: (id: string) => [...base, 'lots', 'trace', id] as const,
    serials: () => [...base, 'serials'] as const,
    serialList: (query: ListQueryState) => [...base, 'serials', 'list', query] as const,
  }
}

export type InvKeys = ReturnType<typeof invKeysFor>

/** Keys of the active company; re-renders on a company switch so the keys move with it. */
export function useInvKeys(): InvKeys {
  return invKeysFor(useCompanyStore((s) => s.activeCompanyId))
}
