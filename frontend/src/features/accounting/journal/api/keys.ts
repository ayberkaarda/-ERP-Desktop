import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'

// Every key starts with the active company so a company switch never shows stale rows.
const company = () => useCompanyStore.getState().activeCompanyId ?? 'none'
const root = () => ['accounting-journal', company()] as const

export const journalKeys = {
  all: () => root(),
  entries: () => [...root(), 'entries'] as const,
  entryList: (q: ListQueryState) => [...root(), 'entries', 'list', q] as const,
  entry: (id: string) => [...root(), 'entries', 'detail', id] as const,
  periods: () => [...root(), 'periods'] as const,
  reports: () => [...root(), 'reports'] as const,
  report: (name: string, params: Record<string, string>) =>
    [...root(), 'reports', name, params] as const,
}
