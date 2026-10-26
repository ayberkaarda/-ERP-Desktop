import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import { documentsApi, lookupsApi, reservationsApi } from '../api/client'
import { activeCompany, invDocsKeys } from '../api/keys'
import { enrichDocument, resolveItems } from '../lib/enrich'
import type { ItemRef, StockDocument } from '../types'

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

/**
 * Labels a document returned by the API (items, units, locations) for the company the request
 * was started in; mutations call it before writing their result to the cache.
 */
export function useEnrich() {
  const queryClient = useQueryClient()
  return useCallback(
    (doc: StockDocument, company = activeCompany()) => enrichDocument(queryClient, doc, company),
    [queryClient],
  )
}

export function useDocument(id: string | undefined) {
  useCompany()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: invDocsKeys.document(id ?? ''),
    queryFn: async ({ signal }) => {
      const company = activeCompany()
      const doc = await documentsApi.get(id ?? '', signal)
      return enrichDocument(queryClient, doc, company, signal)
    },
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

export function useUnits() {
  useCompany()
  return useQuery({
    queryKey: invDocsKeys.units(),
    queryFn: ({ signal }) => lookupsApi.units(signal),
    staleTime: 5 * 60_000,
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

/** Items of a page of rows (labels for lists the API returns with ids only). */
export function useItemsById(ids: readonly string[]) {
  useCompany()
  const queryClient = useQueryClient()
  const unique = [...new Set(ids.filter(Boolean))]
  return useQuery({
    queryKey: invDocsKeys.items(unique),
    queryFn: ({ signal }) => resolveItems(queryClient, unique, activeCompany(), signal),
    enabled: unique.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
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
