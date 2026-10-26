import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Combobox, type ComboboxProps } from '@/components/shared/form'
import { fetchAll } from '../../invoices/kit/http'
import { salesDocsKeys } from '../../invoices/kit/keys'

interface CategoryRow {
  id: string
  code: string
  name: string
  parent_id: string | null
}

type CategorySelectProps = Omit<ComboboxProps, 'options' | 'onChange' | 'value'> & {
  value: string
  onChange: (id: string) => void
}

/** Catalog item categories (GET /item-categories) as "CODE · Name" options. */
export function CategorySelect({ value, onChange, ...props }: CategorySelectProps) {
  const query = useQuery({
    queryKey: [...salesDocsKeys.reports(), 'lookups', 'categories'],
    queryFn: ({ signal }) => fetchAll<CategoryRow>('/item-categories', {}, signal),
    staleTime: 5 * 60_000,
  })
  const options = useMemo(
    () => (query.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })),
    [query.data],
  )
  return (
    <Combobox
      clearable
      {...props}
      value={value || null}
      options={options}
      loading={query.isLoading}
      onChange={(v) => onChange(v ?? '')}
    />
  )
}
