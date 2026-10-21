import { useRef } from 'react'
import {
  AsyncCombobox,
  type AsyncComboboxProps,
  type ComboboxOption,
} from '@/components/shared/form'
import { lookupsApi, type RefResource } from '../api/client'
import { refLabel } from '../lib/labels'
import type { NamedRef } from '../types'

type PassThrough = Omit<
  AsyncComboboxProps,
  'value' | 'onChange' | 'loadOptions' | 'initialOption' | 'scopeKey'
>

interface RefPickerProps extends PassThrough {
  resource: RefResource
  value: string
  onChange: (id: string, record: NamedRef | null) => void
  record?: NamedRef | null
}

/** Party, cost center or project search (code + name) for line dimensions and filters. */
export function RefPicker({ resource, value, onChange, record, ...props }: RefPickerProps) {
  const seen = useRef(new Map<string, NamedRef>())
  const loadOptions = async (q: string, signal: AbortSignal): Promise<ComboboxOption[]> => {
    const rows = await lookupsApi.refs(resource, q, signal)
    for (const r of rows) seen.current.set(r.id, r)
    return rows.map((r) => ({ value: r.id, label: refLabel(r) }))
  }
  return (
    <AsyncCombobox
      {...props}
      value={value || null}
      scopeKey={resource}
      initialOption={record ? { value: record.id, label: refLabel(record) } : null}
      loadOptions={loadOptions}
      onChange={(id) =>
        onChange(
          id ?? '',
          id ? (seen.current.get(id) ?? (record?.id === id ? record : null)) : null,
        )
      }
    />
  )
}
