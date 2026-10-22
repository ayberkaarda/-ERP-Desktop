import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useDebouncedValue } from '@/components/shared/hooks/useDebouncedValue'
import { useCompanyStore } from '@/stores/company'
import { invoicesApi } from './api'
import { stableStringify } from '../shared/lib/idempotency'
import { salesDocsKeys } from './kit/keys'
import type { PreviewInput } from './types'

export function useCompany() {
  return useCompanyStore((s) => s.activeCompanyId)
}

export function useInvoiceList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: salesDocsKeys.list('invoices', query),
    queryFn: ({ signal }) => invoicesApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useInvoice(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: salesDocsKeys.detail('invoices', id ?? ''),
    queryFn: ({ signal }) => invoicesApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useExposure(
  partyId: string | null | undefined,
  enabled = true,
  documentId?: string,
) {
  useCompany()
  return useQuery({
    queryKey: [...salesDocsKeys.exposure(partyId ?? ''), documentId ?? ''],
    queryFn: ({ signal }) => invoicesApi.exposure(partyId ?? '', signal, documentId),
    enabled: enabled && Boolean(partyId),
    staleTime: 15_000,
  })
}

/** Preview-totals delay after the last edit. */
export const PREVIEW_DELAY = 400

/**
 * Server totals and price resolution of the editor, debounced; `fresh` is false while the answer
 * belongs to an older state of the form (the local estimate is shown instead).
 */
export function usePreviewTotals(input: PreviewInput | null) {
  useCompany()
  const key = input ? stableStringify(input) : ''
  const settled = useDebouncedValue(key, PREVIEW_DELAY)
  const settledInput = settled === key ? input : null
  const query = useQuery({
    queryKey: [...salesDocsKeys.branch('invoices'), 'preview', settled],
    queryFn: ({ signal }) => {
      if (!settledInput) throw new Error('stale')
      return invoicesApi.preview(settledInput, signal)
    },
    enabled: settledInput !== null,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  })
  const fresh = query.data !== undefined && settled === key && !query.isPlaceholderData
  return { ...query, fresh }
}
