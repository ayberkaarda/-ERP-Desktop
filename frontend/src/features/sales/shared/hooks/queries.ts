import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useDebouncedValue } from '@/components/shared/hooks/useDebouncedValue'
import { usePermission } from '@/lib/permissions'
import { useCompanyStore } from '@/stores/company'
import { lookupsApi, ordersApi, previewApi, quotesApi } from '../api'
import { stableStringify } from '../lib/idempotency'
import { salesKeys } from '../lib/keys'
import { SALES_ACCESS, SALES_PERMS } from '../permissions'
import type { PreviewTotalsInput } from '../types'

/** Company currency (the *_local totals); TRY until /auth/me serves it. */
export function useCompanyCurrency(): string {
  return useCompanyStore(
    (s) => s.companies.find((c) => c.id === s.activeCompanyId)?.currency ?? 'TRY',
  )
}

/** Re-renders on company switch so keys (which embed the company) move with it. */
export function useCompany() {
  return useCompanyStore((s) => s.activeCompanyId)
}

export function useQuoteList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: salesKeys.list('quote', query),
    queryFn: ({ signal }) => quotesApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useOrderList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: salesKeys.list('order', query),
    queryFn: ({ signal }) => ordersApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useQuote(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: salesKeys.detail('quote', id ?? ''),
    queryFn: ({ signal }) => quotesApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useOrder(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: salesKeys.detail('order', id ?? ''),
    queryFn: ({ signal }) => ordersApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

/** Customer exposure; with a stored order / invoice id also what that document adds. */
export function useExposure(partyId: string, documentId: string | null = null) {
  useCompany()
  const allowed = usePermission(SALES_ACCESS.exposure)
  return useQuery({
    queryKey: [...salesKeys.exposure(partyId), documentId ?? ''],
    queryFn: ({ signal }) => lookupsApi.exposure(partyId, signal, documentId),
    enabled: allowed && partyId !== '',
    staleTime: 30_000,
  })
}

/**
 * Over-delivery tolerance (sales.allow_over_delivery_percent) for users who may read settings;
 * null when it cannot be read: the server then alone bounds deliveries.
 */
export function useOverDeliveryPercent(): string | null {
  useCompany()
  const allowed = usePermission(SALES_PERMS.settingsView)
  const query = useQuery({
    queryKey: [...salesKeys.all(), 'settings', 'over-delivery'],
    queryFn: ({ signal }) => lookupsApi.overDeliveryPercent(signal),
    enabled: allowed,
    staleTime: 5 * 60_000,
    retry: false,
  })
  return allowed && query.isSuccess ? query.data : null
}

/** Debounce of the editor's preview requests (typing a quantity sends one request). */
export const PREVIEW_DEBOUNCE_MS = 400

/**
 * Server totals for the editor: the body settles for PREVIEW_DEBOUNCE_MS, identical bodies share
 * one cached result, and the previous result stays shown while the next one loads.
 */
export function usePreviewTotals(input: PreviewTotalsInput | null) {
  useCompany()
  const body = input ? stableStringify(input) : ''
  const settled = useDebouncedValue(body, PREVIEW_DEBOUNCE_MS)
  const query = useQuery({
    queryKey: salesKeys.preview(settled),
    queryFn: ({ signal }) => previewApi.totals(JSON.parse(settled) as PreviewTotalsInput, signal),
    enabled: settled !== '',
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  })
  return {
    ...query,
    data: body === '' ? undefined : query.data,
    /** The shown figures are behind the form (typing, or the request is in flight). */
    stale: body !== '' && (body !== settled || query.isFetching || query.isPlaceholderData),
  }
}

export function useUnits() {
  useCompany()
  return useQuery({
    queryKey: salesKeys.units(),
    queryFn: ({ signal }) => lookupsApi.units(signal),
    staleTime: 5 * 60_000,
  })
}

/** Base and alternate units of an item with factors (unit cell, conversion preview). */
export function useItemUnits(item: { id: string; base_unit_id: string } | null) {
  useCompany()
  const units = useUnits()
  const ready = item !== null && item.id !== '' && item.base_unit_id !== '' && units.isSuccess
  return useQuery({
    queryKey: salesKeys.itemUnits(item?.id ?? ''),
    queryFn: ({ signal }) =>
      item ? lookupsApi.itemUnits(item, units.data ?? [], signal) : Promise.resolve([]),
    enabled: ready,
    staleTime: 5 * 60_000,
  })
}

/** Stock of an item for the availability hint; only for users who may read stock. */
export function useItemStock(itemId: string, enabled: boolean) {
  useCompany()
  const allowed = usePermission(SALES_ACCESS.stockHint)
  return useQuery({
    queryKey: salesKeys.itemStock(itemId),
    queryFn: ({ signal }) => lookupsApi.itemStock(itemId, signal),
    enabled: allowed && enabled && itemId !== '',
    staleTime: 30_000,
  })
}

export function useApproval(id: string | null) {
  useCompany()
  return useQuery({
    queryKey: salesKeys.approval(id ?? ''),
    queryFn: ({ signal }) => lookupsApi.approval(id ?? '', signal),
    enabled: Boolean(id),
    retry: false,
  })
}
