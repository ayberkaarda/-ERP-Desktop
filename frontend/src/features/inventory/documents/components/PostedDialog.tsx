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

/** Shows the number the document received at posting. */
export function PostedDialog({ number, onClose }: { number: string | null; onClose: () => void }) {
  const { t } = useTranslation('inventoryDocs')
  return (
    <Dialog open={number !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
            {t('post.doneTitle')}
          </DialogTitle>
          <DialogDescription>{t('post.doneBody', { number: number ?? '' })}</DialogDescription>
        </DialogHeader>
        <p className="text-center font-code text-2xl font-semibold" data-testid="posted-number">
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
