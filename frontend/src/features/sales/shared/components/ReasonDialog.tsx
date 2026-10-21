import { Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
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
import { errorMessage } from '../lib/errors'

interface ReasonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  label: string
  confirmLabel: string
  tone?: 'danger' | 'primary'
  minLength?: number
  /** Extra content above the reason (a breakdown, a summary). */
  children?: ReactNode
  /** Rejecting keeps the dialog open with the error shown. */
  onConfirm: (reason: string) => Promise<void>
}

/** Asks for a reason (reject, cancel, credit override) and runs the action with it. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  confirmLabel,
  tone = 'primary',
  minLength = 3,
  children,
  onConfirm,
}: ReasonDialogProps) {
  const { t } = useTranslation('sales-shared')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const short = reason.trim().length < minLength

  const setOpen = (next: boolean) => {
    if (busy) return
    if (!next) {
      setReason('')
      setError(null)
      setTouched(false)
    }
    onOpenChange(next)
  }

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setTouched(true)
    if (short) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      setBusy(false)
      setReason('')
      setTouched(false)
      onOpenChange(false)
    } catch (err) {
      setBusy(false)
      setError(errorMessage(err, t('errors.generic')))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent closeLabel={t('actions.close')} aria-busy={busy}>
        <form onSubmit={(e) => void submit(e)} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children}
          <FieldShell
            label={label}
            required
            error={touched && short ? t('reason.tooShort', { min: minLength }) : undefined}
          >
            {(control) => (
              <Textarea
                {...control}
                value={reason}
                rows={3}
                maxLength={1000}
                autoFocus
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FieldShell>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" variant={tone} disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
