import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AsyncCombobox,
  Combobox,
  type ComboboxOption,
  type FieldControlProps,
} from '@/components/shared/form'
import { Input } from '@/components/ui/input'
import { lookupsApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import { useCategories, useCurrencies, useUnits } from '../hooks/queries'
import { buildTree, categoryPath, flattenTree } from '../lib/tree'

interface PickerProps extends Partial<FieldControlProps> {
  value: string | null
  onChange: (value: string | null) => void
  onBlur?: () => void
  ref?: Ref<HTMLInputElement>
  disabled?: boolean
  clearable?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
}

function unitLabel(u: { code: string; name: string }) {
  return `${u.code} · ${u.name}`
}

/** Active units of the company; `exclude` hides e.g. the item's base unit. */
export function UnitSelect({ exclude = [], ...props }: PickerProps & { exclude?: string[] }) {
  const { data = [], isLoading } = useUnits()
  const options = useMemo<ComboboxOption[]>(
    () =>
      data
        .filter((u) => (u.is_active || u.id === props.value) && !exclude.includes(u.id))
        .map((u) => ({ value: u.id, label: unitLabel(u), description: u.symbol ?? undefined })),
    [data, exclude, props.value],
  )
  return (
    <Combobox
      {...props}
      loading={isLoading}
      options={options}
      onChange={(v) => props.onChange(v)}
    />
  )
}

/** Categories as indented paths; `disabledIds` explains why some parents cannot be picked. */
export function CategorySelect({
  disabledIds,
  disabledReason,
  ...props
}: PickerProps & { disabledIds?: ReadonlySet<string>; disabledReason?: string }) {
  const { data = [], isLoading } = useCategories()
  const options = useMemo<ComboboxOption[]>(() => {
    return flattenTree(buildTree(data)).map((n) => {
      const disabled = disabledIds?.has(n.category.id) ?? false
      return {
        value: n.category.id,
        label: `${n.category.code} · ${n.category.name}`,
        // Tree order plus the parent path keeps same-named children apart.
        description: disabled
          ? disabledReason
          : n.category.parent_id
            ? categoryPath(n.category.parent_id, data)
            : undefined,
        disabled,
      }
    })
  }, [data, disabledIds, disabledReason])
  return (
    <Combobox
      {...props}
      loading={isLoading}
      options={options}
      filter={(o, q) => o.label.toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))}
      onChange={(v) => props.onChange(v)}
    />
  )
}

/** Reference tax codes (async); the label of a stored id is fetched once. */
export function TaxCodeCombobox(props: PickerProps) {
  const { t } = useTranslation('catalog')
  const queryClient = useQueryClient()
  const initial = useQuery({
    queryKey: catalogKeys.taxCode(props.value ?? ''),
    queryFn: ({ signal }) => lookupsApi.taxCode(props.value ?? '', signal),
    enabled: Boolean(props.value),
    staleTime: 10 * 60_000,
    retry: false,
  })
  const initialOption: ComboboxOption | null = props.value
    ? {
        value: props.value,
        label: initial.data ? `${initial.data.code} · ${initial.data.name}` : props.value,
      }
    : null
  return (
    <AsyncCombobox
      key={props.value && !initial.data ? 'pending' : 'ready'}
      {...props}
      initialOption={initialOption}
      clearable={props.clearable ?? true}
      loadOptions={async (q, signal) =>
        (await lookupsApi.taxCodes(q, signal)).map((c) => {
          queryClient.setQueryData(catalogKeys.taxCode(c.id), c)
          return {
            value: c.id,
            label: `${c.code} · ${c.name}`,
            description: c.rate !== null ? t('pickers.rate', { rate: c.rate }) : undefined,
          }
        })
      }
      onChange={(v) => props.onChange(v)}
    />
  )
}

/** Parties by name/code/tax number. */
export function PartyPicker(props: PickerProps) {
  const queryClient = useQueryClient()
  const initial = useQuery({
    queryKey: catalogKeys.party(props.value ?? ''),
    queryFn: ({ signal }) => lookupsApi.party(props.value ?? '', signal),
    enabled: Boolean(props.value),
    staleTime: 10 * 60_000,
    retry: false,
  })
  const initialOption: ComboboxOption | null = props.value
    ? {
        value: props.value,
        label: initial.data ? `${initial.data.code} · ${initial.data.name}` : props.value,
      }
    : null
  return (
    <AsyncCombobox
      key={props.value && !initial.data ? 'pending' : 'ready'}
      {...props}
      initialOption={initialOption}
      clearable={props.clearable ?? true}
      minQueryLength={1}
      loadOptions={async (q, signal) =>
        (await lookupsApi.parties(q, signal)).map((p) => {
          queryClient.setQueryData(catalogKeys.party(p.id), p)
          return { value: p.id, label: `${p.code} · ${p.name}` }
        })
      }
      onChange={(v) => props.onChange(v)}
    />
  )
}

/** Company currencies; falls back to a 3-letter code field when the list is unavailable. */
export function CurrencySelect(props: PickerProps) {
  const { data, isError } = useCurrencies()
  if (isError || data?.length === 0) {
    const { onChange, value, ...rest } = props
    return (
      <Input
        {...rest}
        value={value ?? ''}
        maxLength={3}
        autoComplete="off"
        className="font-code uppercase"
        onChange={(e) => onChange(e.target.value.toUpperCase() || null)}
      />
    )
  }
  const options = (data ?? []).map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))
  return (
    <Combobox {...props} loading={!data} options={options} onChange={(v) => props.onChange(v)} />
  )
}
