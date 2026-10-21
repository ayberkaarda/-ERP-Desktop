import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useDebouncedValue } from '@/components/shared/hooks/useDebouncedValue'
import { isApiError } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { partyKeys } from '../api/keys'
import { partiesApi, type ListParams } from '../api/parties'
import type { Party, PartyInput, PartyPatch } from '../types'

export function useCompanyId() {
  return useCompanyStore((s) => s.activeCompanyId)
}

export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && error.code === 'VERSION_CONFLICT'
}

export function usePartyList(params: ListParams) {
  const companyId = useCompanyId()
  return useQuery({
    queryKey: partyKeys.list(companyId, params),
    queryFn: ({ signal }) => partiesApi.list(params, signal),
    placeholderData: keepPreviousData,
  })
}

export function useParty(id: string | undefined) {
  const companyId = useCompanyId()
  return useQuery({
    queryKey: partyKeys.detail(companyId, id ?? ''),
    queryFn: ({ signal }) => partiesApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

function useStoreParty() {
  const queryClient = useQueryClient()
  const companyId = useCompanyId()
  return (party: Party) => {
    queryClient.setQueryData(partyKeys.detail(companyId, party.id), party)
    void queryClient.invalidateQueries({ queryKey: partyKeys.lists(companyId) })
    void queryClient.invalidateQueries({ queryKey: partyKeys.audit(companyId, party.id) })
  }
}

export function useCreateParty() {
  const store = useStoreParty()
  return useMutation({
    mutationFn: ({ input, key }: { input: PartyInput; key: string }) =>
      partiesApi.create(input, key),
    onSuccess: store,
  })
}

export function useUpdateParty() {
  const store = useStoreParty()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PartyPatch }) => partiesApi.update(id, patch),
    onSuccess: store,
  })
}

export function useDeleteParty() {
  const queryClient = useQueryClient()
  const companyId = useCompanyId()
  return useMutation({
    mutationFn: (id: string) => partiesApi.remove(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: partyKeys.detail(companyId, id) })
      void queryClient.invalidateQueries({ queryKey: partyKeys.lists(companyId) })
    },
  })
}

export interface BulkResult {
  ok: number
  failed: number
}

/** No bulk endpoint: one PATCH per party, each with its own current version. */
export function useBulkSetActive() {
  const queryClient = useQueryClient()
  const companyId = useCompanyId()
  return useMutation({
    mutationFn: async ({
      ids,
      active,
      known,
    }: {
      ids: string[]
      active: boolean
      known: Map<string, Party>
    }): Promise<BulkResult> => {
      const results = await Promise.allSettled(
        ids.map(async (id) => {
          const party = known.get(id) ?? (await partiesApi.get(id))
          if (party.is_active === active) return party
          return partiesApi.update(id, { is_active: active, version: party.version })
        }),
      )
      for (const r of results) {
        if (r.status === 'fulfilled') {
          queryClient.setQueryData(partyKeys.detail(companyId, r.value.id), r.value)
        }
      }
      const ok = results.filter((r) => r.status === 'fulfilled').length
      return { ok, failed: results.length - ok }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: partyKeys.lists(companyId) }),
  })
}

export function usePartyAudit(id: string) {
  const companyId = useCompanyId()
  return useInfiniteQuery({
    queryKey: partyKeys.audit(companyId, id),
    queryFn: ({ pageParam, signal }) => partiesApi.audit(id, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (pages.length < last.lastPage ? pages.length + 1 : null),
  })
}

const MIN_TAX = 5
const MIN_NAME = 3

/**
 * Possible duplicates for what is being typed. Advisory only: it never blocks saving, and
 * a failing lookup is silent.
 */
export function useDuplicateCheck(taxNumber: string, name: string, excludeId?: string) {
  const companyId = useCompanyId()
  const tax = useDebouncedValue(taxNumber.trim(), 400)
  const nm = useDebouncedValue(name.trim(), 400)
  const sendTax = tax.length >= MIN_TAX ? tax : ''
  const sendName = nm.length >= MIN_NAME ? nm : ''
  const query = useQuery({
    queryKey: partyKeys.duplicates(companyId, sendTax, sendName),
    queryFn: ({ signal }) => partiesApi.duplicates({ tax_number: sendTax, name: sendName }, signal),
    enabled: sendTax !== '' || sendName !== '',
    staleTime: 60_000,
    retry: false,
  })
  const matches = (query.data ?? []).filter((d) => d.id !== excludeId)
  return { matches, checking: query.isFetching }
}
