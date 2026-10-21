import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import type { ListQueryState } from '@/components/shared/data-table'
import { createIdempotencyKey } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import {
  barcodesApi,
  categoriesApi,
  conversionsApi,
  discountRulesApi,
  itemsApi,
  itemUnitsApi,
  lookupsApi,
  priceListsApi,
  unitsApi,
  variantsApi,
} from '../api/client'
import { catalogKeys } from '../api/keys'

/** Re-renders on company switch so keys (which embed the company) move with it. */
function useCompany() {
  return useCompanyStore((s) => s.activeCompanyId)
}

export function useUnits() {
  const company = useCompany()
  return useQuery({
    queryKey: catalogKeys.unitAll(),
    queryFn: ({ signal }) => unitsApi.all({ sort: 'code' }, signal),
    enabled: company !== null,
  })
}

export function useUnitList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.unitList(query),
    queryFn: ({ signal }) => unitsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useConversions() {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.conversions(),
    queryFn: ({ signal }) => conversionsApi.all({}, signal),
  })
}

export function useCategories() {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => categoriesApi.all({ sort: 'code' }, signal),
  })
}

export function useItemList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.itemList(query),
    queryFn: ({ signal }) => itemsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useItem(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.item(id ?? ''),
    queryFn: ({ signal }) => itemsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useVariants(itemId: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.variants(itemId ?? ''),
    queryFn: ({ signal }) => variantsApi.list(itemId ?? '', signal),
    enabled: Boolean(itemId),
  })
}

export function useBarcodes(itemId: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.barcodes(itemId ?? ''),
    queryFn: ({ signal }) => barcodesApi.list(itemId ?? '', signal),
    enabled: Boolean(itemId),
  })
}

export function useItemUnits(itemId: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.itemUnits(itemId ?? ''),
    queryFn: ({ signal }) => itemUnitsApi.list(itemId ?? '', signal),
    enabled: Boolean(itemId),
  })
}

export function usePriceListList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.priceListList(query),
    queryFn: ({ signal }) => priceListsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function usePriceList(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.priceList(id ?? ''),
    queryFn: ({ signal }) => priceListsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function usePriceListLines(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.priceListLines(id ?? ''),
    queryFn: ({ signal }) => priceListsApi.lines(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useDiscountRuleList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.discountRuleList(query),
    queryFn: ({ signal }) => discountRulesApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useCurrencies() {
  useCompany()
  return useQuery({
    queryKey: catalogKeys.currencies(),
    queryFn: ({ signal }) => lookupsApi.currencies(signal),
    staleTime: 10 * 60_000,
    retry: false,
  })
}

/** Invalidates a catalog key prefix (lists and details below it). */
export function useInvalidate() {
  const queryClient = useQueryClient()
  return useCallback(
    (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient],
  )
}

/**
 * One Idempotency-Key per logical submit: resending the same body (network retry) reuses it
 * so the API can replay; a changed body gets a new key (the API rejects a reused key with a
 * different body), and a success starts fresh.
 */
export function useIdempotencyKey() {
  const ref = useRef<{ body: string; key: string } | null>(null)
  const current = useCallback((body: unknown) => {
    const json = JSON.stringify(body)
    if (ref.current?.body !== json) ref.current = { body: json, key: createIdempotencyKey() }
    return ref.current.key
  }, [])
  const reset = useCallback(() => {
    ref.current = null
  }, [])
  return { current, reset }
}
