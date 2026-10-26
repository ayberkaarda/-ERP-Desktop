import { Loader2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface ConfirmDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Optional element that opens the dialog (uncontrolled use). */
  trigger?: ReactNode
  title?: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'primary'
  /** May return a promise: the dialog stays open and busy until it settles, closing on success. */
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open: openProp,
  onOpenChange,
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  onConfirm,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common')
  const [innerOpen, setInnerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = openProp ?? innerOpen
  const heading = title ?? t('confirm.title')

  const setOpen = (next: boolean) => {
    if (busy) return
    setInnerOpen(next)
    onOpenChange?.(next)
  }

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
      setBusy(false)
      setInnerOpen(false)
      onOpenChange?.(false)
    } catch {
      // The caller reports the failure; keep the dialog so the user can retry or cancel.
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent aria-busy={busy}>
        <div className="space-y-1.5">
          <AlertDialogTitle>{heading}</AlertDialogTitle>
          <AlertDialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? heading}
          </AlertDialogDescription>
        </div>
        <div className="flex justify-end gap-2">
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={busy}>
              {cancelLabel ?? t('confirm.cancel')}
            </Button>
          </AlertDialogCancel>
          <Button variant={tone} disabled={busy} onClick={() => void confirm()}>
            {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
            {confirmLabel ?? t('confirm.confirm')}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
