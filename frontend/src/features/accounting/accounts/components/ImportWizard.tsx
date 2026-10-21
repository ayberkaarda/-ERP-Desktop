import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { platform } from '@/platform'
import { errorMessage, fieldMessages, isUncertain } from '../../shared/errors'
import { usePayloadKeys } from '../../shared/idempotency'
import { useAccT } from '../../shared/i18n'
import { useImportAccounts } from '../../shared/queries'
import type { ImportResult, ImportRowStatus } from '../../shared/types'
import {
  errorReportCsv,
  IMPORT_COLUMNS,
  isAcceptedFile,
  MAX_IMPORT_BYTES,
  saveTextFile,
  templateCsv,
} from '../lib/csv'

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type Step = 'file' | 'review' | 'done'

const STATUS_TONE: Record<ImportRowStatus, 'success' | 'info' | 'neutral' | 'danger'> = {
  create: 'success',
  update: 'info',
  skip: 'neutral',
  error: 'danger',
}

/** Upload -> dry run (validation report) -> import; the report of failed rows downloads as CSV. */
export function ImportWizard({ onClose }: { onClose: () => void }) {
  const t = useAccT()
  const { t: tc } = useTranslation('common')
  const inputId = useId()
  const [step, setStep] = useState<Step>('file')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [report, setReport] = useState<ImportResult | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const keyFor = usePayloadKeys()
  const run = useImportAccounts()

  const pick = (f: File | null) => {
    setReport(null)
    run.reset()
    if (!f) {
      setFile(null)
      return
    }
    if (!isAcceptedFile(f)) setFileError(t('accounts.importWizard.badType'))
    else if (f.size > MAX_IMPORT_BYTES)
      setFileError(t('accounts.importWizard.tooLarge', { mb: 10 }))
    else setFileError(null)
    setFile(f)
  }

  const send = (dryRun: boolean) => {
    if (!file || fileError) return
    const payload = { file: file.name, size: file.size, modified: file.lastModified, dryRun }
    run.mutate(
      { file, dryRun, key: keyFor(payload) },
      {
        onSuccess: (res) => {
          if (dryRun) {
            setReport(res)
            setOnlyErrors(res.failed > 0)
            setStep('review')
          } else {
            setResult(res)
            setStep('done')
            platform.notify.success(
              t('accounts.importWizard.doneToast', { count: res.created + res.updated }),
            )
          }
        },
      },
    )
  }

  const rows = useMemo(
    () =>
      report ? (onlyErrors ? report.rows.filter((r) => r.status === 'error') : report.rows) : [],
    [report, onlyErrors],
  )

  const downloadReport = () => {
    if (!report) return
    saveTextFile(
      errorReportCsv(report.rows, {
        row: t('accounts.importWizard.columns.row'),
        code: t('accounts.fields.code'),
        name: t('accounts.fields.name'),
        errors: t('accounts.importWizard.columns.errors'),
      }),
      `${t('accounts.importWizard.reportFile')}.csv`,
    )
  }

  const busy = run.isPending
  const errorDetails = fieldMessages(run.error)

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        closeLabel={tc('actions.close')}
        className="max-h-[90dvh] max-w-4xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t('accounts.importWizard.title')}</DialogTitle>
          <DialogDescription>{t(`accounts.importWizard.steps.${step}`)}</DialogDescription>
        </DialogHeader>
        <ol className="flex gap-2 text-xs" aria-label={t('accounts.importWizard.progress')}>
          {(['file', 'review', 'done'] as const).map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={
                s === step
                  ? 'rounded-sm bg-primary-soft px-2 py-1 font-medium text-primary-soft-foreground'
                  : 'rounded-sm px-2 py-1 text-muted-foreground'
              }
            >
              {i + 1}. {t(`accounts.importWizard.stepNames.${s}`)}
            </li>
          ))}
        </ol>

        {run.isError && (
          <div
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
          >
            <p>
              {isUncertain(run.error)
                ? t('common.uncertain')
                : errorMessage(run.error, t('common.actionFailed'))}
            </p>
            {errorDetails.length > 0 && (
              <ul className="mt-1 list-disc pl-5">
                {errorDetails.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === 'file' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor={inputId} className="text-sm font-medium">
                {t('accounts.importWizard.file')}
              </label>
              <input
                id={inputId}
                type="file"
                accept={ACCEPT}
                aria-invalid={fileError ? true : undefined}
                aria-describedby={`${inputId}-help`}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-sunken file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              <p
                id={`${inputId}-help`}
                className={fileError ? 'text-xs text-danger' : 'text-xs text-muted-foreground'}
              >
                {fileError ?? t('accounts.importWizard.fileHelp')}
              </p>
            </div>
            <div className="rounded-md bg-surface-sunken p-3 text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">
                {t('accounts.importWizard.columnsTitle')}
              </p>
              <p className="font-code break-words">{IMPORT_COLUMNS.join(', ')}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => saveTextFile(templateCsv(), 'hesap-plani-sablon.csv')}
              >
                <FileSpreadsheet aria-hidden="true" />
                {t('accounts.importWizard.template')}
              </Button>
            </div>
          </div>
        )}

        {step === 'review' && report && (
          <div className="space-y-3">
            <dl
              className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5"
              aria-label={t('accounts.importWizard.summary')}
            >
              {(
                [
                  ['total', report.total],
                  ['created', report.created],
                  ['updated', report.updated],
                  ['skipped', report.skipped],
                  ['failed', report.failed],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="rounded-md bg-surface-sunken p-2">
                  <dt className="text-xs text-muted-foreground">
                    {t(`accounts.importWizard.counts.${k}`)}
                  </dt>
                  <dd
                    className={
                      k === 'failed' && v > 0 ? 'font-semibold text-danger' : 'font-semibold'
                    }
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
                {t('accounts.importWizard.onlyErrors')}
              </label>
              {report.failed > 0 && (
                <Button type="button" variant="secondary" size="sm" onClick={downloadReport}>
                  <Download aria-hidden="true" />
                  {t('accounts.importWizard.downloadReport')}
                </Button>
              )}
            </div>
            <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
              <table className="w-full text-table">
                <caption className="sr-only">{t('accounts.importWizard.resultsCaption')}</caption>
                <thead className="sticky top-0 bg-surface-sunken text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      {t('accounts.importWizard.columns.row')}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t('accounts.fields.code')}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t('accounts.fields.name')}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t('accounts.importWizard.columns.status')}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      {t('accounts.importWizard.columns.errors')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                        {t('accounts.importWizard.noRows')}
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.row} className="border-t border-border align-top">
                      <td className="px-3 py-1.5 tabular-nums">{r.row}</td>
                      <td className="px-3 py-1.5 font-code">{r.code ?? '—'}</td>
                      <td className="px-3 py-1.5">{r.name ?? '—'}</td>
                      <td className="px-3 py-1.5">
                        <Badge tone={STATUS_TONE[r.status]}>
                          {t(`accounts.importWizard.status.${r.status}`)}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 text-danger">
                        {r.errors.length > 0 && (
                          <ul className="space-y-0.5">
                            {r.errors.map((m) => (
                              <li key={m}>{m}</li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.failed > 0 && (
              <p role="status" className="text-sm text-warning-soft-foreground">
                {t('accounts.importWizard.fixFirst')}
              </p>
            )}
          </div>
        )}

        {step === 'done' && result && (
          <p role="status" className="text-sm">
            {t('accounts.importWizard.doneBody', {
              created: result.created,
              updated: result.updated,
              skipped: result.skipped,
            })}
          </p>
        )}

        <DialogFooter>
          {step === 'done' ? (
            <Button type="button" onClick={onClose}>
              {tc('actions.close')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
                {tc('actions.cancel')}
              </Button>
              {step === 'review' && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    setStep('file')
                    run.reset()
                  }}
                >
                  {tc('actions.back')}
                </Button>
              )}
              {step === 'file' ? (
                <Button
                  type="button"
                  disabled={!file || Boolean(fileError) || busy}
                  onClick={() => send(true)}
                >
                  {busy ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload aria-hidden="true" />
                  )}
                  {t('accounts.importWizard.dryRun')}
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={busy || !report || report.failed > 0}
                  onClick={() => send(false)}
                >
                  {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
                  {t('accounts.importWizard.commit')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
