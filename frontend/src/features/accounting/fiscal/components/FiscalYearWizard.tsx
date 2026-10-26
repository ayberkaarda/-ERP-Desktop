import { zodResolver } from '@hookform/resolvers/zod'
import { CalendarCheck2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { z } from 'zod'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, toIsoDate, useIntlLocale } from '@/lib/datetime'
import { calendarDate, MSG, requiredString, translateMessage } from '@/lib/forms'
import { platform } from '@/platform'
import { CheckboxField, RecordDialog, TextField } from '../../shared/form'
import { usePayloadKeys } from '../../shared/idempotency'
import { useAccT } from '../../shared/i18n'
import { useCreateFiscalYear, usePeriods } from '../../shared/queries'
import type { AccountingPeriod, FiscalYear, FiscalYearInput } from '../../shared/types'
import { overlaps, planPeriods, suggestNextYear, type PlannedPeriod } from '../lib/periods'
import { PeriodStatusBadge } from '../../shared/PeriodStatusBadge'

const schema = z
  .object({
    code: requiredString().regex(/^\d{4}$/, 'validation.invalid'),
    name: requiredString().max(255, MSG.max),
    start_date: calendarDate(),
    end_date: calendarDate(),
    adjustment_period: z.boolean(),
  })
  .refine((v) => v.end_date > v.start_date, { path: ['end_date'], message: MSG.min })

type Values = z.infer<typeof schema>

function PeriodTable({
  periods,
  caption,
}: {
  periods: readonly (PlannedPeriod | AccountingPeriod)[]
  caption: string
}) {
  const t = useAccT()
  const locale = useIntlLocale()
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-border">
      <table className="w-full text-table">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-sunken text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-1.5">
              {t('periods.fields.number')}
            </th>
            <th scope="col" className="px-3 py-1.5">
              {t('periods.fields.start')}
            </th>
            <th scope="col" className="px-3 py-1.5">
              {t('periods.fields.end')}
            </th>
            <th scope="col" className="px-3 py-1.5">
              {t('periods.fields.status')}
            </th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p.number} className="border-t border-border">
              <td className="px-3 py-1.5 tabular-nums">
                {p.number === 13 ? t('periods.adjustment') : p.number}
              </td>
              <td className="px-3 py-1.5">{formatDate(p.start_date, locale)}</td>
              <td className="px-3 py-1.5">{formatDate(p.end_date, locale)}</td>
              <td className="px-3 py-1.5">
                {'status' in p ? (
                  <PeriodStatusBadge status={p.status} />
                ) : (
                  <span className="text-muted-foreground">{t('fiscal.planned')}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CreatedYear({ year, onClose }: { year: FiscalYear; onClose: () => void }) {
  const t = useAccT()
  const periods = usePeriods(year.periods?.length ? null : year.id)
  const list = year.periods?.length ? year.periods : periods.data
  return (
    <div className="space-y-4">
      <p role="status" className="flex items-center gap-2 text-sm">
        <CalendarCheck2 className="size-4 text-success" aria-hidden="true" />
        {t('fiscal.wizard.created', { code: year.code, count: list?.length ?? 0 })}
      </p>
      {periods.isLoading && <Skeleton className="h-40 w-full" />}
      {list && (
        <PeriodTable
          periods={[...list].sort((a, b) => a.number - b.number)}
          caption={t('fiscal.wizard.generated')}
        />
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" asChild>
          <Link to={`/accounting/periods?year=${encodeURIComponent(year.id)}`}>
            {t('fiscal.openBoard')}
          </Link>
        </Button>
        <Button onClick={onClose}>{t('common.done')}</Button>
      </div>
    </div>
  )
}

/** Create a fiscal year: dates and options with a preview of the periods, then the result. */
export function FiscalYearWizard({
  years,
  onClose,
}: {
  years: readonly FiscalYear[]
  onClose: () => void
}) {
  const t = useAccT()
  const { i18n } = useTranslation('common')
  const keyFor = usePayloadKeys()
  const create = useCreateFiscalYear()
  const [created, setCreated] = useState<FiscalYear | null>(null)
  const suggestion = useMemo(() => suggestNextYear(years, toIsoDate(new Date())), [years])
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...suggestion,
      name: t('fiscal.defaultName', { code: suggestion.code }),
      adjustment_period: false,
    },
  })
  const v = useWatch({ control: form.control })
  const planned = useMemo(
    () => planPeriods(v.start_date ?? '', v.end_date ?? '', Boolean(v.adjustment_period)),
    [v.start_date, v.end_date, v.adjustment_period],
  )
  const clash = years.find(
    (y) =>
      v.start_date && v.end_date && overlaps(v.start_date, v.end_date, y.start_date, y.end_date),
  )

  const submit = (values: Values) => {
    if (clash) {
      form.setError('start_date', {
        type: 'overlap',
        message: t('fiscal.wizard.overlap', { code: clash.code }),
      })
      return
    }
    const input: FiscalYearInput = { ...values, code: values.code.trim(), name: values.name.trim() }
    create.mutate(
      { input, key: keyFor(input) },
      {
        onSuccess: (year) => {
          platform.notify.success(t('fiscal.toast.created', { code: year.code }))
          setCreated(year)
        },
      },
    )
  }

  const labels = {
    code: t('fiscal.fields.code'),
    name: t('fiscal.fields.name'),
    start_date: t('fiscal.fields.start'),
    end_date: t('fiscal.fields.end'),
    adjustment_period: t('fiscal.fields.adjustment'),
  }

  if (created) {
    return (
      <RecordDialogShell title={t('fiscal.wizard.title')} onClose={onClose}>
        <CreatedYear year={created} onClose={onClose} />
      </RecordDialogShell>
    )
  }

  return (
    <RecordDialog<Values>
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('fiscal.wizard.title')}
      description={t('fiscal.wizard.body')}
      form={form}
      onSubmit={submit}
      error={create.error}
      busy={create.isPending}
      fieldLabels={labels}
      className="max-w-2xl"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<Values, 'code'>
          name="code"
          label={labels.code}
          required
          input={{ maxLength: 4, inputMode: 'numeric', className: 'font-code' }}
        />
        <TextField<Values, 'name'> name="name" label={labels.name} required />
        {(['start_date', 'end_date'] as const).map((name) => (
          <Controller
            key={name}
            control={form.control}
            name={name}
            render={({ field, fieldState }) => (
              <FieldShell
                label={labels[name]}
                required
                error={translateMessage(i18n, fieldState.error?.message)}
              >
                {(control) => (
                  <DateInput
                    {...control}
                    ref={field.ref}
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              </FieldShell>
            )}
          />
        ))}
        <CheckboxField<Values>
          name="adjustment_period"
          label={labels.adjustment_period}
          description={t('fiscal.hints.adjustment')}
          className="sm:col-span-2"
        />
      </div>
      {clash && (
        <p role="alert" className="text-sm text-danger">
          {t('fiscal.wizard.overlap', { code: clash.code })}
        </p>
      )}
      <section aria-label={t('fiscal.wizard.preview')} className="space-y-2">
        <h3 className="text-sm font-semibold">{t('fiscal.wizard.preview')}</h3>
        {planned.length > 0 ? (
          <PeriodTable periods={planned} caption={t('fiscal.wizard.preview')} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('fiscal.wizard.noPreview')}</p>
        )}
      </section>
    </RecordDialog>
  )
}

function RecordDialogShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const { t } = useTranslation('common')
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('actions.close')} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
