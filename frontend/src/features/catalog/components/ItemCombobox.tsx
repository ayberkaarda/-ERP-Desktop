import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LIST_QUERY } from '@/components/shared/data-table'
import {
  AsyncCombobox,
  type ComboboxOption,
  type FieldControlProps,
} from '@/components/shared/form'
import { itemsApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import { useUnits } from '../hooks/queries'
import type { Item, ItemType, Unit } from '../types'

export interface ItemComboboxProps extends Partial<FieldControlProps> {
  value: string | null
  /** The picked row comes along so callers can default unit and tax code. */
  onChange: (id: string | null, item: Item | null) => void
  onBlur?: () => void
  ref?: Ref<HTMLInputElement>
  /** Restrict to stock or service items. */
  type?: ItemType
  /** Include inactive items (default: active only). */
  includeInactive?: boolean
  disabled?: boolean
  clearable?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
}

function baseUnitCode(item: Item, units: readonly Unit[]) {
  return item.base_unit?.code ?? units.find((u) => u.id === item.base_unit_id)?.code ?? '—'
}

/**
 * Async item picker for documents and price lists. Searches code, name, SKU and barcode
 * (server `q`); each option shows the base unit and the default tax code id.
 */
export function ItemCombobox({
  value,
  onChange,
  type,
  includeInactive = false,
  clearable = true,
  ...props
}: ItemComboboxProps) {
  const { t } = useTranslation('catalog')
  const { data: units = [] } = useUnits()
  const queryClient = useQueryClient()
  // Search results seed the detail cache, so a picked row needs no extra request.
  const current = useQuery({
    queryKey: catalogKeys.item(value ?? ''),
    queryFn: ({ signal }) => itemsApi.get(value ?? '', signal),
    enabled: Boolean(value),
    staleTime: 5 * 60_000,
  })
  const known = value ? current.data : undefined

  const toOption = (item: Item): ComboboxOption => ({
    value: item.id,
    label: `${item.code} · ${item.name}`,
    description: t('itemCombobox.details', {
      unit: baseUnitCode(item, units),
      tax: item.default_tax_code_id ?? t('itemCombobox.noTax'),
    }),
  })

  const loadOptions = async (q: string, signal: AbortSignal) => {
    const filters: Record<string, string> = {}
    if (!includeInactive) filters.is_active = 'true'
    if (type) filters.type = type
    const res = await itemsApi.list({ ...DEFAULT_LIST_QUERY, perPage: 20, q, filters }, signal)
    for (const item of res.data) {
      if (!queryClient.getQueryData(catalogKeys.item(item.id)))
        queryClient.setQueryData(catalogKeys.item(item.id), item)
    }
    return res.data.map(toOption)
  }

  return (
    <AsyncCombobox
      key={value && !known ? 'pending' : 'ready'}
      {...props}
      value={value}
      clearable={clearable}
      initialOption={known ? toOption(known) : value ? { value, label: value } : null}
      loadOptions={loadOptions}
      onChange={(id) =>
        onChange(id, id ? (queryClient.getQueryData<Item>(catalogKeys.item(id)) ?? null) : null)
      }
    />
  )
}
