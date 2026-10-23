import { useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { duplicateSerials, parseSerials } from '../lib/lines'

interface SerialsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: string
  quantity: string
  value: string
  onSave: (text: string) => void
}

/** Serial entry for one received line: one per row (scanner friendly), counted against quantity. */
export function SerialsDialog({
  open,
  onOpenChange,
  item,
  quantity,
  value,
  onSave,
}: SerialsDialogProps) {
  const { t } = useTranslation('purchasing-docs')
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(open)
  if (open !== seen) {
    // Each opening starts from the line's current serials.
    setSeen(open)
    if (open) setText(value)
  }
  const serials = parseSerials(text)
  const dup = duplicateSerials(serials)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('receipt.serialsTitle', { item })}</DialogTitle>
          <DialogDescription>{t('receipt.serialsBody')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="receipt-serials">{t('fields.serials')}</Label>
          <Textarea
            id="receipt-serials"
            rows={8}
            value={text}
            autoFocus
            className="font-code"
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-xs text-muted-foreground tabular-nums" data-testid="serial-count">
            {t('receipt.serialCount', { count: serials.length, quantity })}
          </p>
          {dup.length > 0 && (
            <p role="alert" className="text-xs text-danger">
              {t('validation.serialDuplicate', { serial: dup.join(', ') })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave(serials.join('\n'))
              onOpenChange(false)
            }}
          >
            {t('actions.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
