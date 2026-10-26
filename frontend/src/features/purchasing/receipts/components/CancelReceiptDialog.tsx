import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DateInput, FieldShell } from '@/components/shared/form'
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
import { ActionError } from '@/features/sales/invoices/kit/components/ActionError'
import { VersionConflictAlert } from '@/features/sales/shared/components/common'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { toIsoDate } from '@/lib/datetime'
import { platform } from '@/platform'
import { isVersionConflict } from '../../invoices/kit/http'
import { activeCompany, invalidatePurchEffects, purchKeys } from '../../invoices/kit/keys'
import { receiptsApi } from '../api'
import type { CancelInput, Receipt } from '../types'

interface CancelReceiptDialogProps {
  receipt: Receipt
  open: boolean
  onOpenChange: (open: boolean) => void
  onReload: () => void
}

/**
 * POST /purchase-receipts/{id}/cancel. A draft is simply cancelled; a posted receipt is reversed
 * (stock out at the receipt cost and the GRNI accrual reversed) with a required reason and date.
 */
export function CancelReceiptDialog({
  receipt,
  open,
  onOpenChange,
  onReload,
}: CancelReceiptDialogProps) {
  const { t } = useTranslation('purchasing-docs')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const posted = receipt.status === 'posted'
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(() => toIsoDate(new Date()))
  const [touched, setTouched] = useState(false)
  const short = posted && reason.trim().length < 3
  const badDate = posted && (date === '' || date < receipt.document_date)

  const mutation = useMutation({
    mutationFn: ({ body }: { body: CancelInput; company: string }) =>
      receiptsApi.cancel(receipt.id, body, keyFor({ id: receipt.id, ...body })),
    onSuccess: (saved, { company }) => {
      keyFor.reset()
      queryClient.setQueryData(purchKeys.detail('receipts', saved.id, company), saved)
      invalidatePurchEffects(queryClient, company)
      if (activeCompany() !== company) return
      setReason('')
      setTouched(false)
      onOpenChange(false)
      platform.notify.success(posted ? t('receipt.reversed') : t('receipt.cancelled'))
    },
  })
  const conflict = isVersionConflict(mutation.error)

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    setTouched(true)
    if (short || badDate) return
    const body: CancelInput = { version: receipt.version }
    if (posted) {
      body.reason = reason.trim()
      body.date = date
    } else if (reason.trim()) {
      body.reason = reason.trim()
    }
    mutation.mutate({ body, company: activeCompany() })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent closeLabel={t('actions.close')} aria-busy={mutation.isPending}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {posted
                ? t('receipt.reverseTitle', { number: receipt.number ?? '' })
                : t('receipt.cancelTitle')}
            </DialogTitle>
            <DialogDescription>
              {posted ? t('receipt.reverseBody') : t('receipt.cancelBody')}
            </DialogDescription>
          </DialogHeader>
          {posted && (
            <FieldShell
              label={t('reverse.date')}
              required
              error={touched && badDate ? t('validation.reverseDate') : undefined}
            >
              {(control) => (
                <DateInput
                  {...control}
                  value={date}
                  min={receipt.document_date}
                  onChange={setDate}
                />
              )}
            </FieldShell>
          )}
          <FieldShell
            label={t('fields.reason')}
            required={posted}
            error={touched && short ? t('validation.reason') : undefined}
          >
            {(control) => (
              <Textarea
                {...control}
                value={reason}
                rows={3}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FieldShell>
          {conflict ? (
            <VersionConflictAlert
              onReload={() => {
                mutation.reset()
                onOpenChange(false)
                onReload()
              }}
            />
          ) : (
            <ActionError error={mutation.error} />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={mutation.isPending || conflict}>
              {mutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {posted ? t('receipt.reverseConfirm') : t('receipt.cancelConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
