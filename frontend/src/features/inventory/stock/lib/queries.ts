import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { balancesApi, lotsApi, serialsApi } from './api'
import { useInvKeys } from './keys'

// --- Stock ----------------------------------------------------------------------------------

export function useBalanceList(query: ListQueryState, enabled = true) {
  const keys = useInvKeys()
  return useQuery({
    queryKey: keys.balanceList(query),
    queryFn: ({ signal }) => balancesApi.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useItemStock(itemId: string | null) {
  const keys = useInvKeys()
  return useQuery({
    queryKey: keys.itemStock(itemId ?? ''),
    queryFn: ({ signal }) => balancesApi.item(itemId ?? '', signal),
    enabled: Boolean(itemId),
  })
}

// --- Lots and serials -----------------------------------------------------------------------

export function useLotList(query: ListQueryState) {
  const keys = useInvKeys()
  return useQuery({
    queryKey: keys.lotList(query),
    queryFn: ({ signal }) => lotsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useLotTrace(id: string | null) {
  const keys = useInvKeys()
  return useQuery({
    queryKey: keys.lotTrace(id ?? ''),
    queryFn: ({ signal }) => lotsApi.trace(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useSerialList(query: ListQueryState) {
  const keys = useInvKeys()
  return useQuery({
    queryKey: keys.serialList(query),
    queryFn: ({ signal }) => serialsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}
