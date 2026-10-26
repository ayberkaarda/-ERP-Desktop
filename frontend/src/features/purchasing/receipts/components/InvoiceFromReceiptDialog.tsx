import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
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
import { Input } from '@/components/ui/input'
import { ActionError } from '@/features/sales/invoices/kit/components/ActionError'
import { toIsoDate } from '@/lib/datetime'
import { invoicesApi } from '../../invoices/api'
import { createKeys } from '../../invoices/kit/createKeys'
import { activeCompany, invalidatePurchEffects, purchKeys } from '../../invoices/kit/keys'
import { INVOICES_BASE } from '../../invoices/kit/links'
import type { InvoiceFromReceiptInput } from '../../invoices/types'
import type { Receipt } from '../types'

interface InvoiceFromReceiptDialogProps {
  receipt: Receipt
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * POST /purchase-receipts/{id}/invoice: an invoice draft with every receipt line still open
 * (quantities and prices are adjusted in the invoice editor), then opens it.
 */
export function InvoiceFromReceiptDialog({
  receipt,
  open,
  onOpenChange,
}: InvoiceFromReceiptDialogProps) {
  const { t } = useTranslation('purchasing-docs')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [date, setDate] = useState(() => toIsoDate(new Date()))
  const [due, setDue] = useState('')
  const [number, setNumber] = useState('')
  const mutation = useMutation({
    mutationFn: ({ body, company }: { body: InvoiceFromReceiptInput; company: string }) =>
      invoicesApi.fromReceipt(
        receipt.id,
        body,
        createKeys.keyFor(company, `invoice-from-receipt:${receipt.id}`, body),
      ),
    onSuccess: (inv, { body, company }) => {
      createKeys.release(company, `invoice-from-receipt:${receipt.id}`, body)
      queryClient.setQueryData(purchKeys.detail('invoices', inv.id, company), inv)
      invalidatePurchEffects(queryClient, company)
      if (activeCompany() !== company) return
      onOpenChange(false)
      void navigate(`${INVOICES_BASE}/${inv.id}`)
    },
  })
  const badDue = due !== '' && due < date

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent closeLabel={t('actions.close')} aria-busy={mutation.isPending}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!date || badDue) return
            mutation.mutate({
              body: {
                document_date: date,
                due_date: due || null,
                supplier_invoice_no: number.trim() || null,
                notes: null,
              },
              company: activeCompany(),
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('receipt.invoiceTitle')}</DialogTitle>
            <DialogDescription>{t('receipt.invoiceBody')}</DialogDescription>
          </DialogHeader>
          <FieldShell label={t('fields.supplierInvoiceNo')}>
            {(control) => (
              <Input
                {...control}
                value={number}
                maxLength={64}
                autoComplete="off"
                onChange={(e) => setNumber(e.target.value)}
              />
            )}
          </FieldShell>
          <div className="grid grid-cols-2 gap-3">
            <FieldShell label={t('fields.documentDate')} required>
              {(control) => <DateInput {...control} value={date} onChange={setDate} />}
            </FieldShell>
            <FieldShell
              label={t('fields.dueDate')}
              error={badDue ? t('validation.dueBeforeDate') : undefined}
            >
              {(control) => <DateInput {...control} value={due} min={date} onChange={setDue} />}
            </FieldShell>
          </div>
          <ActionError error={mutation.error} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={mutation.isPending || !date || badDue}>
              {mutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('receipt.invoiceConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
