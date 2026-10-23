import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import { purchKeys } from '../invoices/kit/keys'
import { receiptsApi } from './api'

function useCompany() {
  return useCompanyStore((s) => s.activeCompanyId)
}

export function useReceiptList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.list('receipts', query),
    queryFn: ({ signal }) => receiptsApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useReceipt(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.detail('receipts', id ?? ''),
    queryFn: ({ signal }) => receiptsApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useOrderSource(id: string | null | undefined) {
  useCompany()
  return useQuery({
    queryKey: purchKeys.orderSource(id ?? ''),
    queryFn: ({ signal }) => receiptsApi.order(id ?? '', signal),
    enabled: Boolean(id),
  })
}
