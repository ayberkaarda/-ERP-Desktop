import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldShell } from '@/components/shared/form'
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
import { platform } from '@/platform'
import { documentsApi } from '../../documents/api/client'
import { activeCompany, invDocsKeys } from '../../documents/api/keys'
import { useEnrich } from '../../documents/hooks/queries'
import { usePayloadKeys } from '../../documents/lib/idempotency'
import { ActionError } from '../../documents/components/ActionError'
import type { ImportResult, StockDocument } from '../../documents/types'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

interface CountImportDialogProps {
  document: StockDocument
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `company` is the one the import was started in; `doc` is the reloaded count. */
  onApplied: (doc: StockDocument | null, company: string) => void
}

/**
 * Count CSV (POST /stock-documents/{id}/import): a dry run reports the rows and their errors;
 * only a clean file can be applied. The API answers with counts only, so the count is reloaded.
 */
export function CountImportDialog({
  document,
  open,
  onOpenChange,
  onApplied,
}: CountImportDialogProps) {
  const { t } = useTranslation('inventoryDocs')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const enrich = useEnrich()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  /** The dry run result together with the file it was run on. */
  const [preview, setPreview] = useState<{ file: File; result: ImportResult } | null>(null)
  // The file selected right now, read by late responses to recognise stale ones.
  const selected = useRef<File | null>(null)

  const run = useMutation({
    mutationFn: async ({
      dryRun,
      file: target,
      company,
    }: {
      dryRun: boolean
      file: File
      company: string
    }) => {
      const key = keyFor({
        doc: document.id,
        version: document.version,
        dryRun,
        name: target.name,
        size: target.size,
        modified: target.lastModified,
      })
      const result = await documentsApi.importLines(document.id, target, {
        dryRun,
        version: document.version,
        idempotencyKey: key,
      })
      if (dryRun || !result.applied) return { result, doc: null }
      const doc = await documentsApi
        .get(document.id)
        .then((fresh) => enrich(fresh, company))
        .catch(() => null)
      return { result, doc }
    },
    onSuccess: ({ result, doc }, { dryRun, file: target, company }) => {
      if (dryRun || !result.applied) {
        // A response for a file that is no longer selected is ignored.
        if (selected.current === target) setPreview({ file: target, result })
        return
      }
      if (doc) queryClient.setQueryData(invDocsKeys.document(doc.id, company), doc)
      platform.notify.success(t('import.applied', { count: result.valid }))
      onApplied(doc, company)
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
  const canApply = result !== null && result.errors.length === 0 && result.valid > 0

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
              {t('import.summary', { valid: result.valid, rows: result.rows })}
            </p>
            {result.errors.length > 0 && (
              <>
                <p className="text-sm text-danger">{t('import.hasErrors')}</p>
                <div className="max-h-72 overflow-auto rounded-md border border-border">
                  <table className="w-full text-table" aria-label={t('import.result')}>
                    <thead className="sticky top-0 bg-surface-sunken text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-2 py-1 text-right">
                          {t('import.row')}
                        </th>
                        <th scope="col" className="px-2 py-1 text-left">
                          {t('import.column')}
                        </th>
                        <th scope="col" className="px-2 py-1 text-left">
                          {t('import.message')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((e, i) => (
                        <tr key={`${e.row}-${e.field}-${i}`} className="border-t border-border">
                          <td className="px-2 py-1 text-right tabular-nums">{e.row}</td>
                          <td className="px-2 py-1 font-code">{e.field}</td>
                          <td className="px-2 py-1 text-danger">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
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
