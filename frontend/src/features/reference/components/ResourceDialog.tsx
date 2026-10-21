import { Loader2, RefreshCw } from 'lucide-react'
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
  onReload?: () => void
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
  const keyRef = useRef(createIdempotencyKey())
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState(false)
  const submitting = form.formState.isSubmitting

  const handleSubmit = async (values: V) => {
    setError(null)
    setConflict(false)
    try {
      await onSubmit(values, { idempotencyKey: keyRef.current })
      keyRef.current = createIdempotencyKey()
      onOpenChange(false)
    } catch (e) {
      if (isApiError(e) && e.code === 'VERSION_CONFLICT') setConflict(true)
      else setError(e)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
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
                  onClick={() => {
                    setConflict(false)
                    onReload()
                  }}
                >
                  <RefreshCw aria-hidden="true" />
                  {t('conflict.reload')}
                </Button>
              )}
            </div>
          )}
          <FormErrorSummary error={error} fieldLabels={fieldLabels} mapField={mapField} />
          <div className="grid gap-4 sm:grid-cols-2">{children}</div>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="animate-spin" aria-hidden="true" />}
              {submitLabel ?? tc('actions.save')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
