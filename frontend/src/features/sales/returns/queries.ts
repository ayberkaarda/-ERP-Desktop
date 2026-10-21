import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ListQueryState } from '@/components/shared/data-table'
import { useCompanyStore } from '@/stores/company'
import { salesDocsKeys } from '../invoices/kit/keys'
import { returnsApi } from './api'

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
