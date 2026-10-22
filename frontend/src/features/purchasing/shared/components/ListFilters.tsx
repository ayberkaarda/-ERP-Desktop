import { FilterX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { setFilter, updateListQuery, type ListQueryState } from '@/components/shared/data-table'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ItemCombobox } from '@/features/catalog'
import { SavedFiltersMenu } from '@/features/sales/shared/components/SavedFiltersMenu'
import { usePermission } from '@/lib/permissions'
import { LIST_FILTERS, SAVED_KEYS } from '../lib/listFilters'
import { SupplierPicker } from './SupplierPicker'

interface ListFiltersProps {
  /** Saved views are kept per page (and per user and company). */
  page: string
  query: ListQueryState
  setQuery: (next: ListQueryState) => void
  /** Label of the supplier filter (RFQs: invited, requests: suggested supplier). */
  supplierLabel?: string
}

/** Date range, supplier, item and number filters with clear-all and saved views. */
export function ListFilters({ page, query, setQuery, supplierLabel }: ListFiltersProps) {
  const { t } = useTranslation('purchasing-orders')
  const canPickItems = usePermission('items.view')
  const canPickParties = usePermission('parties.view')
  const f = (key: string) => query.filters[key] ?? ''
  const change = (key: string, value: string) => setQuery(setFilter(query, key, value))
  const filtered = LIST_FILTERS.some((k) => f(k) !== '') || query.q !== ''

  const apply = (params: Record<string, string>) => {
    let next = updateListQuery(query, { q: params.q ?? '', filters: {} })
    for (const key of LIST_FILTERS) if (params[key]) next = setFilter(next, key, params[key])
    setQuery(next)
  }

  return (
    <section
      aria-label={t('filters.title')}
      className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <FieldShell label={t('filters.dateFrom')} className="w-40">
        {(control) => (
          <DateInput
            {...control}
            value={f('date_from')}
            max={f('date_to') || undefined}
            onChange={(v) => change('date_from', v)}
          />
        )}
      </FieldShell>
      <FieldShell label={t('filters.dateTo')} className="w-40">
        {(control) => (
          <DateInput
            {...control}
            value={f('date_to')}
            min={f('date_from') || undefined}
            onChange={(v) => change('date_to', v)}
          />
        )}
      </FieldShell>
      {canPickParties && (
        <FieldShell label={supplierLabel ?? t('filters.supplier')} className="w-64">
          {(control) => (
            <SupplierPicker
              {...control}
              clearable
              value={f('supplier')}
              onChange={(id) => change('supplier', id ?? '')}
            />
          )}
        </FieldShell>
      )}
      {canPickItems && (
        <FieldShell label={t('filters.item')} className="w-64">
          {(control) => (
            <ItemCombobox
              {...control}
              value={f('item_id') || null}
              onChange={(id) => change('item_id', id ?? '')}
            />
          )}
        </FieldShell>
      )}
      <FieldShell label={t('filters.number')} className="w-40">
        {(control) => (
          <Input
            {...control}
            value={f('number')}
            maxLength={64}
            onChange={(e) => change('number', e.target.value.trim())}
          />
        )}
      </FieldShell>
      <div className="ml-auto flex items-center gap-2">
        {filtered && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setQuery(updateListQuery(query, { q: '', filters: {} }))}
          >
            <FilterX aria-hidden="true" />
            {t('filters.clear')}
          </Button>
        )}
        <SavedFiltersMenu
          page={`purchasing-${page}`}
          allowed={SAVED_KEYS}
          current={{ q: query.q, ...query.filters }}
          onApply={apply}
        />
      </div>
    </section>
  )
}
