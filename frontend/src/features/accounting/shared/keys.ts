import type { ListQueryState } from '@/components/shared/data-table'

/** TanStack Query key factory; everything starts with "accounting" so a reset can drop it all. */
export const accKeys = {
  all: ['accounting'] as const,
  accounts: () => ['accounting', 'accounts'] as const,
  accountList: (query: ListQueryState) => ['accounting', 'accounts', 'list', query] as const,
  accountTree: () => ['accounting', 'accounts', 'tree'] as const,
  account: (id: string) => ['accounting', 'accounts', 'one', id] as const,
  balance: (id: string, asOf: string) => ['accounting', 'accounts', 'balance', id, asOf] as const,
  fiscalYears: () => ['accounting', 'fiscal-years'] as const,
  closingPreview: (id: string) => ['accounting', 'fiscal-years', 'preview', id] as const,
  periods: (yearId?: string) =>
    yearId ? (['accounting', 'periods', yearId] as const) : (['accounting', 'periods'] as const),
  rules: () => ['accounting', 'determination-rules'] as const,
}
