import { useQueryClient } from '@tanstack/react-query'
import { Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
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
import { isApiError, platform } from '@/platform'
import { accountsApi } from '../../shared/api'
import { errorMessage, fieldMessages, isUncertain } from '../../shared/errors'
import { usePayloadKeys } from '../../shared/idempotency'
import { useAccT } from '../../shared/i18n'
import { useAccKeys } from '../../shared/keys'
import type { ImportResult, ImportRowResult, ImportRowStatus } from '../../shared/types'
import {
  errorReportCsv,
  IMPORT_COLUMNS,
  isAcceptedFile,
  MAX_IMPORT_BYTES,
  saveTextFile,
  templateCsv,
} from '../lib/csv'
import { hashFile } from '../lib/fileHash'

const ACCEPT =
  '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
/** Rows per page of the results table; a chart can have thousands of lines. */
export const RESULT_PAGE_SIZE = 100

type Step = 'file' | 'review' | 'done'

const STATUS_TONE: Record<ImportRowStatus, 'success' | 'info' | 'neutral' | 'danger'> = {
  create: 'success',
  update: 'info',
  skip: 'neutral',
  error: 'danger',
}

/** The selected upload; `gen` changes on every pick so late answers for older picks are dropped. */
interface Picked {
  file: File
  gen: number
  hash: string | null
  error: string | null
}

/** A server answer and the content it belongs to. */
interface Tagged {
  hash: string
  result: ImportResult
}

function ResultsTable({ rows }: { rows: readonly ImportRowResult[] }) {
  const t = useAccT()
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / RESULT_PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const visible = rows.slice(current * RESULT_PAGE_SIZE, (current + 1) * RESULT_PAGE_SIZE)
  return (
    <div className="space-y-2">
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
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  {t('accounts.importWizard.noRows')}
                </td>
              </tr>
            )}
            {visible.map((r) => (
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
      {pages > 1 && (
        <nav
          aria-label={t('accounts.importWizard.pager')}
          className="flex items-center justify-end gap-2 text-sm"
        >
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {t('accounts.importWizard.prevPage')}
          </Button>
          <span aria-live="polite">
            {t('accounts.importWizard.pageOf', { page: current + 1, pages })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            {t('accounts.importWizard.nextPage')}
          </Button>
        </nav>
      )}
    </div>
  )
}

/** Upload -> dry run (validation report) -> import; the report of failed rows downloads as CSV. */
export function ImportWizard({ onClose }: { onClose: () => void }) {
  const t = useAccT()
  const { t: tc } = useTranslation('common')
  const qc = useQueryClient()
  const keys = useAccKeys()
  const inputId = useId()
  const [step, setStep] = useState<Step>('file')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [report, setReport] = useState<Tagged | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const keyFor = usePayloadKeys()
  const gen = useRef(0)
  const inflight = useRef<AbortController | null>(null)

  // Leaving the wizard cancels whatever is still on the wire.
  useEffect(() => () => inflight.current?.abort(), [])

  const pick = (f: File | null) => {
    gen.current += 1
    const mine = gen.current
    inflight.current?.abort()
    setReport(null)
    setError(null)
    if (!f) {
      setPicked(null)
      return
    }
    let fileError: string | null = null
    if (!isAcceptedFile(f)) fileError = t('accounts.importWizard.badType')
    else if (f.size > MAX_IMPORT_BYTES) fileError = t('accounts.importWizard.tooLarge', { mb: 10 })
    setPicked({ file: f, gen: mine, hash: null, error: fileError })
    if (fileError) return
    hashFile(f).then(
      (hash) => {
        if (gen.current === mine) setPicked((p) => (p?.gen === mine ? { ...p, hash } : p))
      },
      () => {
        if (gen.current === mine)
          setPicked((p) => (p?.gen === mine ? { ...p, error: t('common.actionFailed') } : p))
      },
    )
  }

  const send = async (dryRun: boolean) => {
    if (!picked?.hash || picked.error) return
    const { file, hash, gen: mine } = picked
    if (!dryRun && report?.hash !== hash) return
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    setPending(true)
    setError(null)
    try {
      const res = await accountsApi.import(
        file,
        dryRun,
        keyFor({ hash, dryRun }),
        controller.signal,
      )
      // An answer for an older pick (or a cancelled request) never reaches the screen.
      if (gen.current !== mine || controller.signal.aborted) return
      if (dryRun) {
        setReport({ hash, result: res })
        setOnlyErrors(res.failed > 0)
        setStep('review')
        return
      }
      void qc.invalidateQueries({ queryKey: keys.accounts() })
      setResult(res)
      setOnlyErrors(res.failed > 0)
      setStep('done')
      if (res.failed > 0) {
        platform.notify.warning(t('accounts.importWizard.partialToast', { failed: res.failed }))
      } else {
        platform.notify.success(
          t('accounts.importWizard.doneToast', { count: res.created + res.updated }),
        )
      }
    } catch (err) {
      if (gen.current !== mine || controller.signal.aborted) return
      if (isApiError(err) && err.code === 'ERR_CANCELED') return
      setError(err)
    } finally {
      if (inflight.current === controller) {
        inflight.current = null
        setPending(false)
      }
    }
  }

  const shown = step === 'done' ? result : (report?.result ?? null)
  const rows = useMemo(
    () => (shown ? (onlyErrors ? shown.rows.filter((r) => r.status === 'error') : shown.rows) : []),
    [shown, onlyErrors],
  )

  const downloadReport = () => {
    if (!shown) return
    saveTextFile(
      errorReportCsv(shown.rows, {
        row: t('accounts.importWizard.columns.row'),
        code: t('accounts.fields.code'),
        name: t('accounts.fields.name'),
        errors: t('accounts.importWizard.columns.errors'),
      }),
      `${t('accounts.importWizard.reportFile')}.csv`,
    )
  }

  const close = () => {
    inflight.current?.abort()
    onClose()
  }

  const hashing = Boolean(picked && !picked.hash && !picked.error)
  const busy = pending || hashing
  const errorDetails = fieldMessages(error)
  const reportMatches = Boolean(report && picked?.hash && report.hash === picked.hash)

  const summary = (r: ImportResult) => (
    <dl
      className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5"
      aria-label={t('accounts.importWizard.summary')}
    >
      {(
        [
          ['total', r.total],
          ['created', r.created],
          ['updated', r.updated],
          ['skipped', r.skipped],
          ['failed', r.failed],
        ] as const
      ).map(([k, v]) => (
        <div key={k} className="rounded-md bg-surface-sunken p-2">
          <dt className="text-xs text-muted-foreground">
            {t(`accounts.importWizard.counts.${k}`)}
          </dt>
          <dd className={k === 'failed' && v > 0 ? 'font-semibold text-danger' : 'font-semibold'}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  )

  const rowsBlock = (r: ImportResult) => (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
          {t('accounts.importWizard.onlyErrors')}
        </label>
        {r.failed > 0 && (
          <Button type="button" variant="secondary" size="sm" onClick={downloadReport}>
            <Download aria-hidden="true" />
            {t('accounts.importWizard.downloadReport')}
          </Button>
        )}
      </div>
      <ResultsTable key={`${step}-${String(onlyErrors)}`} rows={rows} />
    </>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && close()}>
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

        {error !== null && (
          <div
            role="alert"
            className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
          >
            <p>
              {isUncertain(error)
                ? t('common.uncertain')
                : errorMessage(error, t('common.actionFailed'))}
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
                disabled={pending}
                aria-invalid={picked?.error ? true : undefined}
                aria-describedby={`${inputId}-help`}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-sunken file:px-3 file:py-1.5 file:text-sm"
                onChange={(e) => pick(e.target.files?.[0] ?? null)}
              />
              <p
                id={`${inputId}-help`}
                className={picked?.error ? 'text-xs text-danger' : 'text-xs text-muted-foreground'}
              >
                {picked?.error ?? t('accounts.importWizard.fileHelp')}
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
            <p className="text-xs text-muted-foreground">
              {t('accounts.importWizard.reportFor', { name: picked?.file.name ?? '' })}
            </p>
            {summary(report.result)}
            {rowsBlock(report.result)}
            {report.result.failed > 0 && (
              <p role="status" className="text-sm text-warning-soft-foreground">
                {t('accounts.importWizard.fixFirst')}
              </p>
            )}
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-3">
            <p role="status" className="text-sm">
              {t('accounts.importWizard.doneBody', {
                created: result.created,
                updated: result.updated,
                skipped: result.skipped,
              })}
            </p>
            {result.failed > 0 && (
              <>
                <p role="alert" className="text-sm text-danger">
                  {t('accounts.importWizard.partialBody', { failed: result.failed })}
                </p>
                {summary(result)}
                {rowsBlock(result)}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'done' ? (
            <Button type="button" onClick={close}>
              {tc('actions.close')}
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={close}>
                {tc('actions.cancel')}
              </Button>
              {step === 'review' && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setStep('file')
                    setError(null)
                  }}
                >
                  {tc('actions.back')}
                </Button>
              )}
              {step === 'file' ? (
                <Button
                  type="button"
                  disabled={!picked?.hash || Boolean(picked.error) || busy}
                  onClick={() => void send(true)}
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
                  disabled={busy || !reportMatches || (report?.result.failed ?? 1) > 0}
                  onClick={() => void send(false)}
                >
                  {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
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
