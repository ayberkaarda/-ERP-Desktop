import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import { salesDocsKeys } from '../invoices/kit/keys'
import { deliveriesApi } from './api'

/** Re-renders on company switch so keys (which embed the company) move with it. */
export function useCompany() {
  return useCompanyStore((s) => s.activeCompanyId)
}

export function useDeliveryList(query: ListQueryState) {
  useCompany()
  return useQuery({
    queryKey: salesDocsKeys.list('deliveries', query),
    queryFn: ({ signal }) => deliveriesApi.list(query, signal),
    placeholderData: keepPreviousData,
  })
}

export function useDelivery(id: string | undefined) {
  useCompany()
  return useQuery({
    queryKey: salesDocsKeys.detail('deliveries', id ?? ''),
    queryFn: ({ signal }) => deliveriesApi.get(id ?? '', signal),
    enabled: Boolean(id),
  })
}

export function useOrderSource(id: string | null | undefined) {
  useCompany()
  return useQuery({
    queryKey: salesDocsKeys.orderSource(id ?? ''),
    queryFn: ({ signal }) => deliveriesApi.order(id ?? '', signal),
    enabled: Boolean(id),
  })
}
