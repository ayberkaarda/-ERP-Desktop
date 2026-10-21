import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import { salesDocsKeys } from '../invoices/kit/keys'
import type { Invoice } from '../invoices/api'
import { returnedPerLine, returnsApi } from './api'

export function useReturnList(query: ListQueryState) {
  useCompanyStore((s) => s.activeCompanyId)
  return useQuery({
    queryKey: salesDocsKeys.list('returns', query),
    queryFn: ({ signal }) => returnsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useReturn(id: string | undefined) {
  useCompanyStore((s) => s.activeCompanyId)
  return useQuery({
    queryKey: salesDocsKeys.detail('returns', id ?? ''),
    queryFn: ({ signal }) => returnsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

/** Quantities per invoice line already on the invoice's other returns (bounds a new return). */
export function useReturnedPerLine(invoice: Invoice | undefined) {
  useCompanyStore((s) => s.activeCompanyId)
  return useQuery({
    queryKey: [...salesDocsKeys.branch('returns'), 'returned', invoice?.id ?? ''],
    queryFn: ({ signal }) => returnedPerLine(invoice?.links ?? [], signal),
    enabled: invoice !== undefined,
  })
}
