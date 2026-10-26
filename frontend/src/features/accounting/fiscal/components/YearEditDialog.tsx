import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { DateInput, FieldShell } from '@/components/shared/form'
import { calendarDate, MSG, requiredString, translateMessage } from '@/lib/forms'
import { platform } from '@/platform'
import { fiscalYearsApi } from '../../shared/api'
import { RecordDialog, TextField } from '../../shared/form'
import { useAccT } from '../../shared/i18n'
import { useUpdateFiscalYear } from '../../shared/queries'
import type { FiscalYear } from '../../shared/types'

const schema = z
  .object({
    name: requiredString().max(255, MSG.max),
    start_date: calendarDate(),
    end_date: calendarDate(),
  })
  .refine((v) => v.end_date > v.start_date, { path: ['end_date'], message: MSG.min })

type Values = z.infer<typeof schema>

const toValues = (y: FiscalYear): Values => ({
  name: y.name,
  start_date: y.start_date,
  end_date: y.end_date,
})

/** Name and dates of a year; the API refuses date changes once entries are posted. */
export function YearEditDialog({
  year: initial,
  onClose,
}: {
  year: FiscalYear
  onClose: () => void
}) {
  const t = useAccT()
  const { i18n } = useTranslation('common')
  const [year, setYear] = useState(initial)
  const [reloading, setReloading] = useState(false)
  const update = useUpdateFiscalYear()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(initial) })

  const submit = (v: Values) => {
    const patch: Partial<Values> = {}
    for (const k of Object.keys(v) as (keyof Values)[]) {
      if (v[k] !== toValues(year)[k]) patch[k] = v[k]
    }
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    update.mutate(
      { id: year.id, version: year.version, patch },
      {
        onSuccess: () => {
          platform.notify.success(t('fiscal.toast.updated', { code: year.code }))
          onClose()
        },
      },
    )
  }

  const reload = async () => {
    setReloading(true)
    try {
      const all = await fiscalYearsApi.all()
      const fresh = all.find((y) => y.id === year.id)
      if (fresh) {
        setYear(fresh)
        update.reset()
        form.reset(toValues(fresh))
      }
    } finally {
      setReloading(false)
    }
  }

  const labels = {
    name: t('fiscal.fields.name'),
    start_date: t('fiscal.fields.start'),
    end_date: t('fiscal.fields.end'),
  }

  return (
    <RecordDialog<Values>
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('fiscal.editTitle', { code: year.code })}
      description={
        year.has_posted_entries ? t('fiscal.hints.datesLocked') : t('fiscal.hints.dates')
      }
      form={form}
      onSubmit={submit}
      error={update.error}
      onReload={() => void reload()}
      reloading={reloading}
      busy={update.isPending}
      fieldLabels={labels}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<Values, 'name'>
          name="name"
          label={labels.name}
          required
          className="sm:col-span-2"
        />
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
                    disabled={year.has_posted_entries}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                  />
                )}
              </FieldShell>
            )}
          />
        ))}
      </div>
    </RecordDialog>
  )
}
