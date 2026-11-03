import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { DEFAULT_LIST_QUERY } from '@/components/shared/data-table'
import {
  AsyncCombobox,
  type ComboboxOption,
  type FieldControlProps,
  type LoadedOptions,
} from '@/components/shared/form'
import { useIntlLocale } from '@/lib/datetime/locale'
import { isApiError } from '@/platform'
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

/**
 * A runtime with an offline mode refuses a search it cannot answer completely (items are also
 * found by barcode and variant SKU, which only the server has): 503 OFFLINE_UNAVAILABLE.
 */
function isOfflineUnavailable(error: unknown) {
  return isApiError(error) && error.status === 503 && error.code === 'OFFLINE_UNAVAILABLE'
}

/** How long the unfiltered page stands in for the server search before it is read again. */
const OFFLINE_LIST_STALE_MS = 60_000

function baseUnitCode(item: Item, units: readonly Unit[]) {
  return item.base_unit?.code ?? units.find((u) => u.id === item.base_unit_id)?.code ?? '—'
}

/**
 * Async item picker for documents and price lists. Searches code, name, SKU and barcode
 * (server `q`); each option shows the base unit and the default tax code id. When that search
 * is not available offline, the rows of the unfiltered page are searched by code and name
 * instead, with a notice that says so.
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
  const locale = useIntlLocale()
  // Rows of the latest search: a pick returns exactly the record the user saw.
  const lastResults = useRef(new Map<string, Item>())
  // A picked row seeds the detail cache, so labelling it needs no extra request.
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

  const loadOptions = async (
    q: string,
    signal: AbortSignal,
  ): Promise<ComboboxOption[] | LoadedOptions> => {
    const filters: Record<string, string> = {}
    if (!includeInactive) filters.is_active = 'true'
    if (type) filters.type = type
    const query = { ...DEFAULT_LIST_QUERY, perPage: 20, q, filters }
    const search = q.trim()
    // The same page without the text: what an empty box lists.
    const unfiltered = { ...query, q: '' }
    const unfilteredKey = catalogKeys.itemList(unfiltered)
    let rows: Item[]
    let notice: string | undefined
    try {
      const res = await itemsApi.list(query, signal)
      rows = res.data
      // Kept only for the offline fallback below.
      if (!search) queryClient.setQueryData(unfilteredKey, res)
    } catch (error) {
      if (!search || !isOfflineUnavailable(error)) throw error
      // Offline the text search is refused, the unfiltered page is still answered. Searching
      // only its rows is a partial answer, so the notice says so.
      const page = await queryClient
        .query({
          queryKey: unfilteredKey,
          queryFn: ({ signal: s }) => itemsApi.list(unfiltered, s),
          staleTime: OFFLINE_LIST_STALE_MS,
          // A refusal now is answered with the load error; the next keystroke tries again.
          retry: false,
        })
        .catch(() => {
          throw error
        })
      const needle = search.toLocaleLowerCase(locale)
      rows = page.data.filter(
        (item) =>
          item.code.toLocaleLowerCase(locale).includes(needle) ||
          item.name.toLocaleLowerCase(locale).includes(needle),
      )
      notice = t('itemCombobox.offlineSearch')
    }
    lastResults.current = new Map(rows.map((item) => [item.id, item]))
    const options = rows.map(toOption)
    return notice ? { options, notice } : options
  }

  return (
    <AsyncCombobox
      key={value && !known ? 'pending' : 'ready'}
      {...props}
      value={value}
      clearable={clearable}
      initialOption={known ? toOption(known) : value ? { value, label: value } : null}
      loadOptions={loadOptions}
      onChange={(id) => {
        const picked = id ? lastResults.current.get(id) : undefined
        // The search row is newer than any cached detail; it also labels the field.
        if (picked) queryClient.setQueryData(catalogKeys.item(picked.id), picked)
        onChange(
          id,
          picked ?? (id ? (queryClient.getQueryData<Item>(catalogKeys.item(id)) ?? null) : null),
        )
      }}
    />
  )
}
