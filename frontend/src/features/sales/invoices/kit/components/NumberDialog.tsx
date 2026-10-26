import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface NumberDialogProps {
  /** The number assigned at post / issue; null closes the dialog. */
  number: string | null
  title: string
  onClose: () => void
}

/** Shows the gapless number a document received when it was posted or issued. */
export function NumberDialog({ number, title, onClose }: NumberDialogProps) {
  const { t } = useTranslation('sales-docs')
  return (
    <Dialog open={number !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
            {title}
          </DialogTitle>
          <DialogDescription>{t('numbered.body', { number: number ?? '' })}</DialogDescription>
        </DialogHeader>
        <p className="text-center font-code text-2xl font-semibold" data-testid="assigned-number">
          {number}
        </p>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            {t('actions.ok')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
