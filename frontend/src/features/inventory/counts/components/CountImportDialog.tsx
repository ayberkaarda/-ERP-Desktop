import { useMutation } from '@tanstack/react-query'
import { Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldShell } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { platform } from '@/platform'
import { documentsApi, toDocument } from '../../documents/api/client'
import { activeCompany } from '../../documents/api/keys'
import { usePayloadKeys } from '../../documents/lib/idempotency'
import { trimDecimal } from '../../documents/lib/quantity'
import { ActionError } from '../../documents/components/ActionError'
import type { ImportResult, StockDocument } from '../../documents/types'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

interface CountImportDialogProps {
  document: StockDocument
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `company` is the one the import was started in. */
  onApplied: (doc: StockDocument | null, company: string) => void
}

/** Count CSV: a dry run shows how every row matches; only a clean file can be applied. */
export function CountImportDialog({
  document,
  open,
  onOpenChange,
  onApplied,
}: CountImportDialogProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const keyFor = usePayloadKeys()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  /** The dry run result together with the file it was run on. */
  const [preview, setPreview] = useState<{ file: File; result: ImportResult } | null>(null)
  // The file selected right now, read by late responses to recognise stale ones.
  const selected = useRef<File | null>(null)

  const run = useMutation({
    mutationFn: ({ dryRun, file: target }: { dryRun: boolean; file: File; company: string }) => {
      const key = keyFor({
        doc: document.id,
        version: document.version,
        dryRun,
        name: target.name,
        size: target.size,
        modified: target.lastModified,
      })
      return documentsApi.importLines(document.id, target, {
        dryRun,
        version: document.version,
        idempotencyKey: key,
      })
    },
    onSuccess: (result, { dryRun, file: target, company }) => {
      if (dryRun) {
        // A response for a file that is no longer selected is ignored.
        if (selected.current === target) setPreview({ file: target, result })
        return
      }
      platform.notify.success(t('import.applied', { count: result.valid }))
      onApplied(result.document ? toDocument(result.document) : null, company)
      close()
    },
  })

  const close = () => {
    selected.current = null
    setFile(null)
    setPreview(null)
    setFileError(null)
    run.reset()
    onOpenChange(false)
  }

  const pick = (picked: File | null) => {
    setPreview(null)
    run.reset()
    setFileError(null)
    let next = picked
    if (picked && !picked.name.toLowerCase().endsWith('.csv')) {
      next = null
      setFileError(t('import.wrongType'))
    } else if (picked && picked.size > MAX_IMPORT_BYTES) {
      next = null
      setFileError(t('import.tooLarge'))
    }
    selected.current = next
    setFile(next)
  }

  const result = preview?.file === file ? preview.result : null
  const canApply = result !== null && result.invalid === 0 && result.valid > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : !run.isPending && close())}
    >
      <DialogContent closeLabel={t('actions.close')} className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.body')}</DialogDescription>
        </DialogHeader>
        <FieldShell label={t('import.file')} error={fileError ?? undefined}>
          {(control) => (
            <Input
              {...control}
              type="file"
              accept=".csv,text/csv"
              disabled={run.isPending}
              onChange={(e) => pick(e.target.files?.[0] ?? null)}
            />
          )}
        </FieldShell>
        <ActionError error={run.error} />
        {result && (
          <div className="space-y-2">
            <p role="status" className="text-sm">
              {t('import.summary', { valid: result.valid, invalid: result.invalid })}
            </p>
            {result.invalid > 0 && <p className="text-sm text-danger">{t('import.hasErrors')}</p>}
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table className="w-full text-table" aria-label={t('import.result')}>
                <thead className="sticky top-0 bg-surface-sunken text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-2 py-1 text-right">
                      {t('import.row')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-left">
                      {t('lines.item')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-left">
                      {t('lines.lot')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-left">
                      {t('lines.location')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-right">
                      {t('count.counted')}
                    </th>
                    <th scope="col" className="px-2 py-1 text-left">
                      {t('import.result')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => (
                    <tr key={r.row} className="border-t border-border">
                      <td className="px-2 py-1 text-right tabular-nums">{r.row}</td>
                      <td className="px-2 py-1 font-code">{r.item_code}</td>
                      <td className="px-2 py-1 font-code">{r.lot_no}</td>
                      <td className="px-2 py-1">{r.location_code}</td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {r.counted_quantity
                          ? formatDecimalDisplay(trimDecimal(r.counted_quantity), {
                              locale,
                              minFraction: 0,
                              maxFraction: 6,
                            })
                          : ''}
                      </td>
                      <td className="px-2 py-1">
                        {r.status === 'ok' ? (
                          <Badge tone="success">{t('import.ok')}</Badge>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone="danger">{t('import.error')}</Badge>
                            <span className="text-xs text-danger">{r.message}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={run.isPending} onClick={close}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!file || run.isPending}
            onClick={() => file && run.mutate({ dryRun: true, file, company: activeCompany() })}
          >
            {run.isPending && run.variables.dryRun ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Upload aria-hidden="true" />
            )}
            {t('import.dryRun')}
          </Button>
          <Button
            type="button"
            disabled={!canApply || run.isPending}
            onClick={() =>
              preview && run.mutate({ dryRun: false, file: preview.file, company: activeCompany() })
            }
          >
            {run.isPending && !run.variables.dryRun && (
              <Loader2 className="animate-spin" aria-hidden="true" />
            )}
            {t('import.apply', { count: result?.valid ?? 0 })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
