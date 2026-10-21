import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import { documentsApi, lookupsApi, reservationsApi } from '../api/client'
import { invDocsKeys } from '../api/keys'
import type { ItemRef } from '../types'

/** Re-renders on company switch so keys (which embed the company) move with it. */
export function useCompany() {
  return useCompanyStore((s) => s.activeCompanyId)
}

export function useDocumentList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: invDocsKeys.documentList(query),
    queryFn: ({ signal }) => documentsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useDocument(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: invDocsKeys.document(id ?? ''),
    queryFn: ({ signal }) => documentsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useReservationList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: invDocsKeys.reservationList(query),
    queryFn: ({ signal }) => reservationsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useWarehouses() {
  useCompany()
  return useQuery({
    queryKey: invDocsKeys.warehouses(),
    queryFn: ({ signal }) => lookupsApi.warehouses(signal),
    staleTime: 60_000,
  })
}

export function useLocations(warehouseId: string) {
  useCompany()
  return useQuery({
    queryKey: invDocsKeys.locations(warehouseId),
    queryFn: ({ signal }) => lookupsApi.locations(warehouseId, signal),
    enabled: warehouseId !== '',
    staleTime: 60_000,
  })
}

export function useCategories() {
  useCompany()
  return useQuery({
    queryKey: invDocsKeys.categories(),
    queryFn: ({ signal }) => lookupsApi.categories(signal),
    staleTime: 5 * 60_000,
  })
}

export function useItemRecord(id: string) {
  useCompany()
  return useQuery({
    queryKey: invDocsKeys.item(id),
    queryFn: ({ signal }) => lookupsApi.item(id, signal),
    enabled: id !== '',
    staleTime: 5 * 60_000,
  })
}

/** Base and alternate units of an item with factors (for the unit cell and its preview). */
export function useItemUnits(item: ItemRef | null) {
  useCompany()
  return useQuery({
    queryKey: invDocsKeys.itemUnits(item?.id ?? ''),
    queryFn: ({ signal }) => (item ? lookupsApi.itemUnits(item, signal) : Promise.resolve([])),
    enabled: item !== null && item.id !== '',
    staleTime: 5 * 60_000,
  })
}
