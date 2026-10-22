import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchAll } from '../../invoices/kit/http'
import { salesDocsKeys } from '../../invoices/kit/keys'
import type { Row } from '../definitions'

interface CodeName {
  id: string
  code: string
  name: string
}

const EMPTY: Row[] = []

/** Category rows carry only category_id and margin rows warehouse_id: name them for reading. */
export function useRowLabels(data: Row[] | undefined): Row[] {
  const { t } = useTranslation('sales-reports')
  const rows = data ?? EMPTY
  const needsCategory = rows.some((r) => 'category_id' in r)
  const needsWarehouse = rows.some((r) => 'warehouse_id' in r && !('line_no' in r))
  const categories = useQuery({
    queryKey: [...salesDocsKeys.reports(), 'lookups', 'categories'],
    queryFn: ({ signal }) => fetchAll<CodeName>('/item-categories', {}, signal),
    staleTime: 5 * 60_000,
    enabled: needsCategory,
  })
  const warehouses = useQuery({
    queryKey: [...salesDocsKeys.reports(), 'lookups', 'warehouses'],
    queryFn: ({ signal }) => fetchAll<CodeName>('/warehouses', {}, signal),
    staleTime: 5 * 60_000,
    enabled: needsWarehouse,
  })
  return useMemo(() => {
    if (!needsCategory && !needsWarehouse) return rows
    const label = (list: CodeName[] | undefined, id: unknown, none = '') => {
      if (typeof id !== 'string' || id === '') return none
      const hit = list?.find((x) => x.id === id)
      return hit ? `${hit.code} · ${hit.name}` : id
    }
    return rows.map((r) => ({
      ...r,
      ...(needsCategory
        ? { category_label: label(categories.data, r.category_id, t('hub.uncategorised')) }
        : {}),
      ...(needsWarehouse ? { warehouse_label: label(warehouses.data, r.warehouse_id) } : {}),
    }))
  }, [rows, needsCategory, needsWarehouse, categories.data, warehouses.data, t])
}
