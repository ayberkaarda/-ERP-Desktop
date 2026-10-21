import { useMemo, type Ref } from 'react'
import { Combobox, type ComboboxOption, type FieldControlProps } from '@/components/shared/form'
import { useCategories, useLocations, useWarehouses } from '../hooks/queries'

interface PickerProps extends Partial<FieldControlProps> {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  ref?: Ref<HTMLInputElement>
  disabled?: boolean
  clearable?: boolean
  placeholder?: string
  className?: string
  'aria-label'?: string
  'aria-required'?: boolean
}

const label = (r: { code: string; name: string }) => `${r.code} · ${r.name}`

/** Active warehouses (the stored one stays listed even if it was deactivated). */
export function WarehouseSelect({ exclude, ...props }: PickerProps & { exclude?: string }) {
  const { data = [], isLoading } = useWarehouses()
  const options = useMemo<ComboboxOption[]>(
    () =>
      data
        .filter((w) => (w.is_active || w.id === props.value) && w.id !== exclude)
        .map((w) => ({ value: w.id, label: label(w) })),
    [data, exclude, props.value],
  )
  return (
    <Combobox
      {...props}
      value={props.value || null}
      loading={isLoading}
      options={options}
      onChange={(v) => props.onChange(v ?? '')}
    />
  )
}

/** Locations of one warehouse; empty and disabled until a warehouse is chosen. */
export function LocationSelect({ warehouseId, ...props }: PickerProps & { warehouseId: string }) {
  const { data = [], isLoading } = useLocations(warehouseId)
  const options = useMemo<ComboboxOption[]>(
    () =>
      data
        .filter((l) => l.is_active || l.id === props.value)
        .map((l) => ({ value: l.id, label: label(l) })),
    [data, props.value],
  )
  return (
    <Combobox
      clearable
      {...props}
      value={props.value || null}
      disabled={(props.disabled ?? false) || warehouseId === ''}
      loading={isLoading && warehouseId !== ''}
      options={options}
      onChange={(v) => props.onChange(v ?? '')}
    />
  )
}

export function CategorySelect(props: PickerProps) {
  const { data = [], isLoading } = useCategories()
  const options = useMemo<ComboboxOption[]>(
    () =>
      [...data]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((c) => ({ value: c.id, label: label(c) })),
    [data],
  )
  return (
    <Combobox
      clearable
      {...props}
      value={props.value || null}
      loading={isLoading}
      options={options}
      onChange={(v) => props.onChange(v ?? '')}
    />
  )
}
