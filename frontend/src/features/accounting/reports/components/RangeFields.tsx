import { useTranslation } from 'react-i18next'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { usePeriods } from '../../journal/hooks/queries'
import { errorMessage } from '../../journal/lib/errors'
import { selectClass } from '../../journal/lib/ui'
import type { ParamRecord } from '../lib/params'

const nonEmpty = (v: string | undefined) => (v === '' ? undefined : v)

interface RangeFieldsProps {
  value: ParamRecord
  onChange: (patch: ParamRecord) => void
  /** Journal book and ledger also work by period, but a range is the default for them. */
  allowPeriod?: boolean
}

/** Period or inclusive date range picker shared by the reports. */
export function RangeFields({ value, onChange, allowPeriod = true }: RangeFieldsProps) {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  const periods = usePeriods()
  const mode = allowPeriod && value.mode === 'period' ? 'period' : 'range'

  return (
    <>
      {allowPeriod && (
        <fieldset className="flex items-end gap-3">
          <legend className="sr-only">{t('reports.rangeMode')}</legend>
          {(['range', 'period'] as const).map((m) => (
            <label key={m} className="flex h-control items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="range-mode"
                value={m}
                checked={mode === m}
                className="accent-primary"
                onChange={() => onChange({ mode: m })}
              />
              {t(`reports.mode.${m}`)}
            </label>
          ))}
        </fieldset>
      )}
      {mode === 'period' && periods.isError && !periods.data ? (
        <div role="alert" className="flex h-control items-center gap-2 text-sm text-danger">
          <span>{errorMessage(periods.error, t('reports.periodsFailed'))}</span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void periods.refetch()}
          >
            {t('actions.retry')}
          </Button>
        </div>
      ) : mode === 'period' ? (
        <FieldShell label={t('reports.period')} className="w-64" required>
          {(control) => (
            <select
              {...control}
              className={selectClass}
              value={value.period_id ?? ''}
              onChange={(e) => onChange({ period_id: e.target.value })}
            >
              <option value="">
                {periods.isPending ? t('reports.loading') : t('reports.choosePeriod')}
              </option>
              {(periods.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {t('reports.periodOption', {
                    year: p.fiscal_year_code ?? p.start_date.slice(0, 4),
                    number: String(p.number).padStart(2, '0'),
                    from: formatDate(p.start_date, locale),
                    to: formatDate(p.end_date, locale),
                  })}
                </option>
              ))}
            </select>
          )}
        </FieldShell>
      ) : (
        <>
          <FieldShell label={t('filters.dateFrom')} className="w-40" required>
            {(control) => (
              <DateInput
                {...control}
                value={value.date_from ?? ''}
                max={nonEmpty(value.date_to)}
                onChange={(v) => onChange({ date_from: v })}
              />
            )}
          </FieldShell>
          <FieldShell label={t('filters.dateTo')} className="w-40" required>
            {(control) => (
              <DateInput
                {...control}
                value={value.date_to ?? ''}
                min={nonEmpty(value.date_from)}
                onChange={(v) => onChange({ date_to: v })}
              />
            )}
          </FieldShell>
        </>
      )}
    </>
  )
}
