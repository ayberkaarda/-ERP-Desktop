import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useDebouncedValue } from '@/components/shared/hooks/useDebouncedValue'
import { stableStringify } from '@/features/sales/shared/lib/idempotency'
import { usePermission } from '@/lib/permissions'
import { useCompanyStore } from '@/stores/company'
import { ordersApi, previewApi, requestsApi, rfqsApi, supplierApi } from '../api'
import { purchKeys } from '../lib/keys'
import { PURCH_ACCESS, PURCH_PERMS } from '../permissions'
import type { PreviewInput } from '../types'

export {
  useApproval,
  useCompanyCurrency,
  useItemUnits,
} from '@/features/sales/shared/hooks/queries'

/** Re-renders on company switch so keys (which embed the company) move with it. */
function useCompany() {
  return useCompanyStore((s) => s.activeCompanyId)
}

export function useRequestList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.list('request', query),
    queryFn: ({ signal }) => requestsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useRfqList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.list('rfq', query),
    queryFn: ({ signal }) => rfqsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useOrderList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.list('order', query),
    queryFn: ({ signal }) => ordersApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useRequest(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.detail('request', id ?? ''),
    queryFn: ({ signal }) => requestsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useRfq(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.detail('rfq', id ?? ''),
    queryFn: ({ signal }) => rfqsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useOrder(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.detail('order', id ?? ''),
    queryFn: ({ signal }) => ordersApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useComparison(id: string, enabled: boolean) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.comparison(id),
    queryFn: ({ signal }) => rfqsApi.comparison(id, signal),
    enabled: enabled && id !== '',
  })
}

/** Supplier exposure (informational); only for users with orders.view or invoices.view. */
export function useSupplierExposure(partyId: string) {
  useCompany()
  const allowed = usePermission(PURCH_ACCESS.exposure)
  return useQuery({
    queryKey: purchKeys.exposure(partyId),
    queryFn: ({ signal }) => supplierApi.exposure(partyId, signal),
    enabled: allowed && partyId !== '',
    staleTime: 30_000,
  })
}

/**
 * Over-receipt tolerance (purchasing.allow_over_receipt_percent) for users who may read settings;
 * null when it cannot be read: the server then alone bounds receipts.
 */
export function useOverReceiptPercent(): string | null {
  useCompany()
  const allowed = usePermission(PURCH_PERMS.settingsView)
  const query = useQuery({
    queryKey: purchKeys.overReceipt(),
    queryFn: ({ signal }) => supplierApi.overReceiptPercent(signal),
    enabled: allowed,
    staleTime: 5 * 60_000,
    retry: false,
  })
  return allowed && query.isSuccess ? query.data : null
}

export const PREVIEW_DEBOUNCE_MS = 400

/** Server totals for the order editor: debounced, cached per body, last figures kept. */
export function usePreviewTotals(input: PreviewInput | null) {
  useCompany()
  const body = input ? stableStringify(input) : ''
  const settled = useDebouncedValue(body, PREVIEW_DEBOUNCE_MS)
  const query = useQuery({
    queryKey: purchKeys.preview(settled),
    queryFn: ({ signal }) => previewApi.totals(JSON.parse(settled) as PreviewInput, signal),
    enabled: settled !== '',
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: false,
  })
  return {
    ...query,
    data: body === '' ? undefined : query.data,
    stale: body !== '' && (body !== settled || query.isFetching || query.isPlaceholderData),
  }
}
