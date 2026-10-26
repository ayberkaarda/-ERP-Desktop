import { Loader2 } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { VersionConflictAlert } from './components'
import { errorMessage, fieldMessages, isVersionConflict } from './errors'
import { useAccT } from './i18n'

export const MIN_REASON_LENGTH = 5
export const MAX_REASON_LENGTH = 500

interface ActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  /** Asks for a reason (reopen); it is passed to onConfirm trimmed. */
  requireReason?: boolean
  /** Throw (the API error) to keep the dialog open and show why it failed. */
  onConfirm: (reason: string | null) => Promise<unknown>
  /** VERSION_CONFLICT: re-read the record; the dialog stays open on the fresh copy. */
  onReload?: () => Promise<unknown>
  /** Custom rendering of a domain refusal (e.g. drafts blocking a period close). */
  renderError?: (error: unknown) => ReactNode | null
  /** Extra content above the form (previews, blocked reasons). */
  children?: ReactNode
  confirmDisabled?: boolean
}

/** Confirmation for state transitions (close, reopen) with an optional audited reason. */
export function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'primary',
  requireReason = false,
  onConfirm,
  onReload,
  renderError,
  children,
  confirmDisabled = false,
}: ActionDialogProps) {
  const t = useAccT()
  const { t: tc } = useTranslation('common')
  const formId = useId()
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [reloading, setReloading] = useState(false)

  const trimmed = reason.trim()
  const reasonError =
    requireReason && touched && trimmed.length < MIN_REASON_LENGTH
      ? t('common.reasonTooShort', { min: MIN_REASON_LENGTH })
      : undefined

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setTouched(true)
    if (requireReason && trimmed.length < MIN_REASON_LENGTH) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(requireReason ? trimmed : null)
      setBusy(false)
      onOpenChange(false)
    } catch (err) {
      setBusy(false)
      setError(err)
    }
  }

  const reload = async () => {
    if (!onReload) return
    setReloading(true)
    try {
      await onReload()
      setError(null)
    } finally {
      setReloading(false)
    }
  }

  const custom = error && renderError ? renderError(error) : null
  let errorBlock: ReactNode = null
  if (error && isVersionConflict(error)) {
    errorBlock = (
      <VersionConflictAlert
        busy={reloading}
        onReload={onReload ? () => void reload() : undefined}
      />
    )
  } else if (custom) {
    errorBlock = custom
  } else if (error) {
    const details = fieldMessages(error)
    errorBlock = (
      <div
        role="alert"
        className="rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
      >
        <p>{errorMessage(error, t('common.actionFailed'))}</p>
        {details.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {details.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent closeLabel={tc('actions.close')} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          noValidate
          aria-label={title}
          className="space-y-4"
          onSubmit={(e) => void submit(e)}
        >
          {children}
          {errorBlock}
          {requireReason && (
            <FieldShell label={t('common.reason')} required error={reasonError}>
              {(control) => (
                <Textarea
                  {...control}
                  value={reason}
                  maxLength={MAX_REASON_LENGTH}
                  autoFocus
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={() => setTouched(true)}
                />
              )}
            </FieldShell>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {tc('actions.cancel')}
            </Button>
            <Button
              type="submit"
              variant={tone}
              disabled={busy || confirmDisabled || (error !== null && isVersionConflict(error))}
            >
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
