import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimal } from '@/lib/money'
import { platform } from '@/platform'
import { ActionDialog } from '../../shared/ActionDialog'
import { errorMessage } from '../../shared/errors'
import { usePayloadKeys } from '../../shared/idempotency'
import { useAccT } from '../../shared/i18n'
import { useAccKeys } from '../../shared/keys'
import {
  useClosingPreview,
  useFiscalYears,
  usePeriods,
  useYearTransition,
} from '../../shared/queries'
import type { ClosingPreview, FiscalYear } from '../../shared/types'

function PreviewBlock({ preview }: { preview: ClosingPreview }) {
  const t = useAccT()
  const locale = useIntlLocale()
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {t('fiscal.close.result', {
          amount: formatDecimal(preview.result, 2, locale),
          side: preview.result_side
            ? t(`accounts.side.${preview.result_side}`)
            : t('accounts.side.zero'),
          account: preview.result_account_code ?? '—',
        })}
      </p>
      <table className="w-full text-table">
        <caption className="sr-only">{t('fiscal.close.previewTitle')}</caption>
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-1 pr-2">
              {t('fiscal.close.entry')}
            </th>
            <th scope="col" className="py-1 pr-2">
              {t('fiscal.close.date')}
            </th>
            <th scope="col" className="py-1 pr-2 text-right">
              {t('fiscal.close.lines')}
            </th>
            <th scope="col" className="py-1 text-right">
              {t('fiscal.close.total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {preview.entries.map((e) => (
            <tr key={`${e.entry_type}-${e.description}`} className="border-t border-border">
              <td className="py-1 pr-2">
                <span className="font-medium">{t(`fiscal.close.types.${e.entry_type}`)}</span>
                <span className="block text-xs text-muted-foreground">{e.description}</span>
              </td>
              <td className="py-1 pr-2">{formatDate(e.entry_date, locale)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{e.line_count}</td>
              <td className="py-1 text-right tabular-nums">
                {formatDecimal(e.total_debit, 2, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {preview.warnings.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-warning-soft-foreground">
          {preview.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Close (runs the closing procedure) or reopen (with an audited reason) a fiscal year. */
export function YearTransitionDialog({
  year,
  action,
  onClose,
}: {
  year: FiscalYear
  action: 'close' | 'reopen'
  onClose: () => void
}) {
  const t = useAccT()
  const qc = useQueryClient()
  const keys = useAccKeys()
  const keyFor = usePayloadKeys()
  const transition = useYearTransition()
  const [ack, setAck] = useState(false)
  // The version the user is confirming against; a newer one elsewhere needs a new confirmation.
  const [base, setBase] = useState(year)
  const years = useFiscalYears()
  const latest = years.data?.find((y) => y.id === year.id)
  const changed = latest !== undefined && latest.version !== base.version
  const adopt = () => {
    if (!latest) return
    setBase(latest)
    setAck(false)
  }
  const preview = useClosingPreview(action === 'close' ? year.id : null)
  const periods = usePeriods(action === 'close' ? year.id : null)
  const notClosed = (periods.data ?? []).filter((p) => p.status !== 'closed')

  const confirm = async (reason: string | null) => {
    const cached = qc.getQueryData<FiscalYear[]>(keys.fiscalYears())?.find((y) => y.id === year.id)
    if (cached && cached.version !== base.version) throw new Error(t('fiscal.changed.body'))
    const fresh = base
    if (action === 'close') {
      await transition.mutateAsync({
        action,
        year: fresh,
        key: keyFor({ id: fresh.id, version: fresh.version, action }),
      })
      platform.notify.success(t('fiscal.toast.closed', { code: year.code }))
    } else {
      const r = reason ?? ''
      await transition.mutateAsync({
        action,
        year: fresh,
        reason: r,
        key: keyFor({ id: fresh.id, version: fresh.version, action, reason: r }),
      })
      platform.notify.success(t('fiscal.toast.reopened', { code: year.code }))
    }
  }

  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(action === 'close' ? 'fiscal.close.title' : 'fiscal.reopen.title', {
        code: year.code,
      })}
      description={t(action === 'close' ? 'fiscal.close.body' : 'fiscal.reopen.body')}
      confirmLabel={t(action === 'close' ? 'fiscal.close.confirm' : 'fiscal.reopen.confirm')}
      tone={action === 'close' ? 'primary' : 'danger'}
      requireReason={action === 'reopen'}
      confirmDisabled={changed || (action === 'close' && !ack)}
      onConfirm={confirm}
      onReload={() => qc.invalidateQueries({ queryKey: keys.fiscalYears() })}
    >
      {changed && (
        <div
          role="alert"
          className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
        >
          <div>
            <p className="font-semibold">{t('fiscal.changed.title')}</p>
            <p>{t('fiscal.changed.body')}</p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={adopt}>
            {t('fiscal.changed.adopt')}
          </Button>
        </div>
      )}
      {action === 'close' && (
        <>
          <section
            aria-label={t('fiscal.close.previewTitle')}
            className="space-y-2 rounded-md border border-border p-3"
          >
            <h3 className="text-sm font-semibold">{t('fiscal.close.previewTitle')}</h3>
            {preview.isLoading && <Skeleton className="h-20 w-full" />}
            {preview.isError && (
              <p className="text-sm text-danger">
                {errorMessage(preview.error, t('fiscal.close.previewFailed'))}
              </p>
            )}
            {preview.data && <PreviewBlock preview={preview.data} />}
            {preview.data === null && (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>{t('fiscal.close.noPreview')}</p>
                <ol className="list-decimal pl-5">
                  <li>{t('fiscal.close.step1')}</li>
                  <li>{t('fiscal.close.step2')}</li>
                  <li>{t('fiscal.close.step3')}</li>
                  <li>{t('fiscal.close.step4')}</li>
                </ol>
              </div>
            )}
          </section>
          {notClosed.length > 0 && (
            <p role="status" className="text-sm text-warning-soft-foreground">
              {t('fiscal.close.openPeriods', { count: notClosed.length })}
            </p>
          )}
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
            <span>{t('fiscal.close.ack')}</span>
          </label>
        </>
      )}
    </ActionDialog>
  )
}
