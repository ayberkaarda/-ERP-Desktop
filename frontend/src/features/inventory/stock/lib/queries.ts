import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { balancesApi, locationsApi, lotsApi, serialsApi, warehousesApi } from './api'
import { useInvKeys } from './keys'
import type { LocationInput, WarehouseInput } from './types'

// --- Warehouses -----------------------------------------------------------------------------

export function useWarehouseList(query: ListQueryState, enabled = true) {
  const keys = useInvKeys()
  return useQuery({
    queryKey: keys.warehouseList(query),
    queryFn: ({ signal }) => warehousesApi.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** Every warehouse of the company (filters and pickers). */
export function useAllWarehouses(enabled = true) {
  const keys = useInvKeys()
  return useQuery({
    queryKey: keys.warehouseAll(),
    queryFn: ({ signal }) => warehousesApi.all(signal),
    staleTime: 60_000,
    enabled,
  })
}

export function useLocations(warehouseId: string | null) {
  const keys = useInvKeys()
  return useQuery({
    queryKey: keys.locations(warehouseId ?? ''),
    queryFn: ({ signal }) => locationsApi.all(warehouseId ?? '', signal),
    enabled: Boolean(warehouseId),
  })
}

export function useSaveWarehouse() {
  const keys = useInvKeys()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      args:
        | { mode: 'create'; input: WarehouseInput; key: string }
        | { mode: 'update'; id: string; version: number; patch: Partial<WarehouseInput> },
    ) =>
      args.mode === 'create'
        ? warehousesApi.create(args.input, args.key)
        : warehousesApi.update(args.id, args.version, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.warehouses() }),
  })
}

export function useDeleteWarehouse() {
  const keys = useInvKeys()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      warehousesApi.remove(id, version),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.warehouses() }),
  })
}

export function useSaveLocation(warehouseId: string) {
  const keys = useInvKeys()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      args:
        | { mode: 'create'; input: LocationInput; key: string }
        | { mode: 'update'; id: string; patch: Partial<LocationInput>; version?: number },
    ) =>
      args.mode === 'create'
        ? locationsApi.create(warehouseId, args.input, args.key)
        : locationsApi.update(warehouseId, args.id, args.patch, args.version),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.warehouses() }),
  })
}

export function useDeleteLocation(warehouseId: string) {
  const keys = useInvKeys()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => locationsApi.remove(warehouseId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.warehouses() }),
  })
}

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
