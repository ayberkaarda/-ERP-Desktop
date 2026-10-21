import { Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { ItemCombobox } from '@/features/catalog'
import { CategorySelect, WarehouseSelect } from '../../documents/components/pickers'
import { selectClass } from '../../documents/lib/ui'
import type { ParamDef, ReportDef } from '../definitions'
import { missingRequired, type ParamRecord } from '../lib/params'

interface ReportParamsFormProps {
  def: ReportDef
  value: ParamRecord
  onChange: (next: ParamRecord) => void
  onSubmit: () => void
}

const WIDTH: Record<ParamDef['kind'], string> = {
  date: 'w-40',
  warehouse: 'w-56',
  category: 'w-56',
  item: 'w-72',
  number: 'w-28',
  select: 'w-44',
  checkbox: '',
}

/** Parameter form of a report, built from its definition; Enter or "Run" applies it. */
export function ReportParamsForm({ def, value, onChange, onSubmit }: ReportParamsFormProps) {
  const { t } = useTranslation('inventoryDocs')
  const set = (key: string, v: string) => onChange({ ...value, [key]: v })
  const missing = missingRequired(def, value)

  const field = (p: ParamDef) => {
    const v = value[p.key] ?? ''
    const label = t(`param.${p.label}`)
    if (p.kind === 'checkbox') {
      return (
        <label key={p.key} className="flex h-control items-center gap-2 text-sm">
          <Checkbox
            checked={v === '1'}
            onChange={(e) => set(p.key, e.target.checked ? '1' : '0')}
          />
          {label}
        </label>
      )
    }
    return (
      <FieldShell key={p.key} label={label} required={p.required} className={WIDTH[p.kind]}>
        {(control) => {
          switch (p.kind) {
            case 'date':
              return <DateInput {...control} value={v} onChange={(x) => set(p.key, x)} />
            case 'warehouse':
              return (
                <WarehouseSelect {...control} clearable value={v} onChange={(x) => set(p.key, x)} />
              )
            case 'category':
              return <CategorySelect {...control} value={v} onChange={(x) => set(p.key, x)} />
            case 'item':
              return (
                <ItemCombobox
                  {...control}
                  value={v || null}
                  type="stock"
                  onChange={(id) => set(p.key, id ?? '')}
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
  }

  return (
    <form
      aria-label={t('reports.parameters')}
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3 print:hidden"
      onSubmit={(e) => {
        e.preventDefault()
        if (missing.length === 0) onSubmit()
      }}
    >
      {def.params.map(field)}
      <Button
        type="submit"
        disabled={missing.length > 0}
        title={missing.length > 0 ? t('reports.required') : undefined}
      >
        <Play aria-hidden="true" />
        {t('reports.run')}
      </Button>
    </form>
  )
}
