import { useMemo } from 'react'
import { Combobox, type ComboboxOption } from '@/components/shared/form'
import type { PickerProps } from '../../shared/pickers'
import { useCategories } from '../hooks/queries'

// Warehouse and location pickers are shared with the stock screens (one data source:
// GET /stock-warehouses and the Reference locations of the warehouse).
export {
  LocationCombobox as LocationSelect,
  WarehouseCombobox as WarehouseSelect,
} from '../../shared/pickers'

const label = (r: { code: string; name: string }) => `${r.code} · ${r.name}`

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
