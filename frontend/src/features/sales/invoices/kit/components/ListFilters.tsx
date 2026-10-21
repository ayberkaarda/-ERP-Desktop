import { FilterX } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ItemCombobox } from '@/features/catalog'
import { PartyCombobox } from '@/features/parties'
import type { ListFiltersState } from '../listFilters'
import { PresetsMenu } from './PresetsMenu'

interface ListFiltersProps {
  filters: ListFiltersState
  /** Page-specific filters placed before the shared ones' actions. */
  children?: ReactNode
}

/** Date range, customer, number and item filters with clear and saved views. */
export function ListFilters({ filters, children }: ListFiltersProps) {
  const { t } = useTranslation('sales-docs')
  const { f, change, urlQuery } = filters
  return (
    <section
      aria-label={t('list.filters')}
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
      <FieldShell label={t('filters.customer')} className="w-64">
        {(control) => (
          <PartyCombobox
            {...control}
            role="customer"
            showRoles={false}
            value={f('party_id') || null}
            onChange={(id) => change('party_id', id ?? '')}
          />
        )}
      </FieldShell>
      <FieldShell label={t('filters.number')} className="w-40">
        {(control) => (
          <Input
            {...control}
            type="search"
            maxLength={50}
            value={f('number')}
            onChange={(e) => change('number', e.target.value)}
          />
        )}
      </FieldShell>
      <FieldShell label={t('filters.item')} className="w-60">
        {(control) => (
          <ItemCombobox
            {...control}
            value={f('item_id') || null}
            onChange={(id) => change('item_id', id ?? '')}
          />
        )}
      </FieldShell>
      {children}
      <div className="ml-auto flex items-center gap-2">
        {filters.filtered && (
          <Button type="button" variant="ghost" size="sm" onClick={filters.clear}>
            <FilterX aria-hidden="true" />
            {t('filters.clear')}
          </Button>
        )}
        <PresetsMenu
          storageKey={filters.key}
          allowed={filters.presetKeys}
          title={t('presets.views')}
          current={{ q: urlQuery.q, ...urlQuery.filters }}
          onApply={filters.applyPreset}
        />
      </div>
    </section>
  )
}
