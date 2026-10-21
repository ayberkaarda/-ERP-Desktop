import { Loader2, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type ReactNode } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Form, FormErrorSummary } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { createIdempotencyKey, isApiError } from '@/platform'
import { refKeys } from '../hooks/keys'
import { useRefT } from '../i18n'

export interface SubmitContext {
  /** Stable per dialog session: a retried create replays instead of duplicating. */
  idempotencyKey: string
}

interface ResourceDialogProps<V extends FieldValues> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  form: UseFormReturn<V>
  /** Throw (the API error) to keep the dialog open and show it. */
  onSubmit: (values: V, ctx: SubmitContext) => Promise<unknown>
  /** Re-reads the record after a VERSION_CONFLICT so the user can reapply the change. */
  onReload?: () => Promise<void>
  fieldLabels?: Record<string, string>
  /** Maps an API field name to a form field (nested payloads, renamed fields). */
  mapField?: (serverField: string) => string | null
  submitLabel?: string
  children: ReactNode
  wide?: boolean
}

/** Modal form shell: server field errors, VERSION_CONFLICT reload prompt, idempotent creates. */
export function ResourceDialog<V extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  onReload,
  fieldLabels,
  mapField,
  submitLabel,
  children,
  wide = false,
}: ResourceDialogProps<V>) {
  const t = useRefT()
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  // The key belongs to one exact payload: a changed payload gets a new key, a retry of the same
  // payload replays the earlier request.
  const attempt = useRef<{ hash: string; key: string } | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [reloadFailed, setReloadFailed] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  const submitting = form.formState.isSubmitting
  const busy = submitting || reloading

  const handleSubmit = async (values: V) => {
    setError(null)
    setConflict(false)
    setUncertain(false)
    const hash = JSON.stringify(values)
    if (attempt.current?.hash !== hash) attempt.current = { hash, key: createIdempotencyKey() }
    try {
      await onSubmit(values, { idempotencyKey: attempt.current.key })
      attempt.current = null
      onOpenChange(false)
    } catch (e) {
      if (isApiError(e) && e.code === 'VERSION_CONFLICT') {
        setConflict(true)
      } else if (!isApiError(e) || e.status === 0 || e.status >= 500) {
        // The request may have been applied although the answer was lost: refresh the lists so
        // the user can check before submitting a different payload.
        setUncertain(true)
        void queryClient.invalidateQueries({ queryKey: refKeys.all })
      } else {
        setError(e)
      }
    }
  }

  const reload = async () => {
    if (!onReload) return
    setReloading(true)
    setReloadFailed(false)
    try {
      await onReload()
      setConflict(false)
    } catch {
      setReloadFailed(true)
    } finally {
      setReloading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className={wide ? 'max-w-2xl' : undefined} closeLabel={tc('actions.close')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>
        <Form form={form} onSubmit={handleSubmit} aria-label={title} className="space-y-4">
          {conflict && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
            >
              <div>
                <p className="font-semibold">{t('conflict.title')}</p>
                <p>{t('conflict.body')}</p>
              </div>
              {onReload && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={reloading}
                  onClick={() => void reload()}
                >
                  <RefreshCw
                    className={reloading ? 'animate-spin' : undefined}
                    aria-hidden="true"
                  />
                  {t('conflict.reload')}
                </Button>
              )}
            </div>
          )}
          {reloadFailed && (
            <p role="alert" className="text-sm text-danger">
              {t('conflict.reloadFailed')}
            </p>
          )}
          {uncertain && (
            <p role="alert" className="text-sm text-warning-soft-foreground">
              {t('errors.uncertain')}
            </p>
          )}
          <FormErrorSummary error={error} fieldLabels={fieldLabels} mapField={mapField} />
          <div className="grid gap-4 sm:grid-cols-2">{children}</div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {submitLabel ?? tc('actions.save')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
