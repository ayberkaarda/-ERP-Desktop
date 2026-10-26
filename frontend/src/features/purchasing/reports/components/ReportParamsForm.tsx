import { Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ItemCombobox } from '@/features/catalog'
import { PartyCombobox } from '@/features/parties'
import { CurrencySelect, WarehouseSelect } from '@/features/reference'
import { selectClass } from '@/features/sales/invoices/kit/ui'
import { CategorySelect } from '@/features/sales/reports/components/CategorySelect'
import type { ParamDef, ReportDef } from '../definitions'
import { missingRequired, rangeInvalid, type ParamRecord } from '../lib/params'

interface ReportParamsFormProps {
  def: ReportDef
  value: ParamRecord
  onChange: (next: ParamRecord) => void
  onSubmit: () => void
}

const WIDTH: Record<ParamDef['kind'], string> = {
  date: 'w-40',
  party: 'w-64',
  item: 'w-64',
  category: 'w-56',
  warehouse: 'w-56',
  currency: 'w-32',
  select: 'w-40',
  number: 'w-24',
}

/** Parameter form of a report, built from its definition; Enter or "Run" applies it. */
export function ReportParamsForm({ def, value, onChange, onSubmit }: ReportParamsFormProps) {
  const { t } = useTranslation('purchasing-reports')
  const set = (key: string, v: string) => onChange({ ...value, [key]: v })
  const blocked = missingRequired(def, value).length > 0 || rangeInvalid(value)

  return (
    <form
      aria-label={t('hub.parameters')}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3 print:hidden"
      onSubmit={(e) => {
        e.preventDefault()
        if (!blocked) onSubmit()
      }}
    >
      {def.params.map((p) => {
        const v = value[p.key] ?? ''
        return (
          <FieldShell
            key={p.key}
            label={t(`param.${p.label}`)}
            required={p.required}
            className={WIDTH[p.kind]}
          >
            {(control) => {
              switch (p.kind) {
                case 'date':
                  return <DateInput {...control} value={v} onChange={(x) => set(p.key, x)} />
                case 'party':
                  return (
                    <PartyCombobox
                      {...control}
                      role="supplier"
                      showRoles={false}
                      value={v || null}
                      onChange={(id) => set(p.key, id ?? '')}
                    />
                  )
                case 'item':
                  return (
                    <ItemCombobox
                      {...control}
                      value={v || null}
                      onChange={(id) => set(p.key, id ?? '')}
                    />
                  )
                case 'category':
                  return <CategorySelect {...control} value={v} onChange={(x) => set(p.key, x)} />
                case 'warehouse':
                  return (
                    <WarehouseSelect
                      {...control}
                      value={v || null}
                      onChange={(x) => set(p.key, x ?? '')}
                    />
                  )
                case 'currency':
                  return (
                    <CurrencySelect
                      {...control}
                      value={v || null}
                      onChange={(x) => set(p.key, x ?? '')}
                    />
                  )
                case 'number':
                  return (
                    <Input
                      {...control}
                      type="number"
                      inputMode="numeric"
                      min={p.min}
                      max={p.max}
                      step={1}
                      value={v}
                      onChange={(e) => set(p.key, e.target.value.replace(/[^\d]/g, ''))}
                    />
                  )
                case 'select':
                  return (
                    <select
                      {...control}
                      className={selectClass}
                      value={v}
                      onChange={(e) => set(p.key, e.target.value)}
                    >
                      {(p.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {t(`param.${o.label}`)}
                        </option>
                      ))}
                    </select>
                  )
              }
            }}
          </FieldShell>
        )
      })}
      <Button type="submit" disabled={blocked} title={blocked ? t('hub.required') : undefined}>
        <Play aria-hidden="true" />
        {t('hub.run')}
      </Button>
      {rangeInvalid(value) && (
        <p role="alert" className="w-full text-xs text-danger">
          {t('hub.rangeInvalid')}
        </p>
      )}
    </form>
  )
}
