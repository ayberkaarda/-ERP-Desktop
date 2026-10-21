import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'

/** The active company; mutations capture it at start so late results land in the right cache. */
export const activeCompany = () => useCompanyStore.getState().activeCompanyId ?? 'none'

// Every key starts with a company so a company switch never shows stale rows. Pass `company`
// explicitly when writing results of work started under another company.
const root = (company = activeCompany()) => ['accounting-journal', company] as const

export const journalKeys = {
  all: (company?: string) => root(company),
  entries: (company?: string) => [...root(company), 'entries'] as const,
  entryList: (q: ListQueryState) => [...root(), 'entries', 'list', q] as const,
  entry: (id: string, company?: string) => [...root(company), 'entries', 'detail', id] as const,
  periods: () => [...root(), 'periods'] as const,
  reports: () => [...root(), 'reports'] as const,
  report: (name: string, params: Record<string, string>) =>
    [...root(), 'reports', name, params] as const,
}
