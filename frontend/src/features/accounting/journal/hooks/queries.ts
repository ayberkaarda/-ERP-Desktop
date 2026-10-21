import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import { journalApi, lookupsApi } from '../api/client'
import { journalKeys } from '../api/keys'

/** Re-renders on company switch so keys (which embed the company) move with it. */
export function useCompany() {
  return useCompanyStore((s) => s.activeCompanyId)
}

export function useEntryList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: journalKeys.entryList(query),
    queryFn: ({ signal }) => journalApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useEntry(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: journalKeys.entry(id ?? ''),
    queryFn: ({ signal }) => journalApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

/** Label source for an id that came from the URL or a preset (no search ran yet). */
export function useAccountRecord(id: string) {
  useCompany()
  return useQuery({
    queryKey: [...journalKeys.all(), 'account', id],
    queryFn: ({ signal }) => lookupsApi.account(id, signal),
    enabled: id !== '',
    staleTime: 60_000,
  })
}

export function usePartyRecord(id: string) {
  useCompany()
  return useQuery({
    queryKey: [...journalKeys.all(), 'party', id],
    queryFn: ({ signal }) => lookupsApi.ref('parties', id, signal),
    enabled: id !== '',
    staleTime: 60_000,
  })
}

export function usePeriods() {
  useCompany()
  return useQuery({
    queryKey: journalKeys.periods(),
    queryFn: ({ signal }) => lookupsApi.periods(signal),
    staleTime: 60_000,
  })
}
