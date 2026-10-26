import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { VersionConflictAlert } from '@/features/sales/shared/components/common'
import { usePayloadKeys } from '@/features/sales/shared/lib/idempotency'
import { toIsoDate } from '@/lib/datetime'
import { calendarDate, snakeToCamelPath } from '@/lib/forms'
import { platform } from '@/platform'
import { invoicesApi } from '../api'
import { isVersionConflict } from '../kit/http'
import { activeCompany, invalidatePurchEffects, purchKeys } from '../kit/keys'
import type { Invoice } from '../types'

interface ReverseInvoiceDialogProps {
  invoice: Invoice
  open: boolean
  onOpenChange: (open: boolean) => void
  onReload: () => void
}

interface ReverseValues {
  date: string
  reason: string
  reverseStock: boolean
}

/**
 * POST /purchase-invoices/{id}/reverse {version, date, reason, reverse_stock}: a reversing journal
 * entry; with reverse_stock the receipts this invoice posted itself (receive on invoice) are
 * cancelled too. Refused while payments or returns exist.
 */
export function ReverseInvoiceDialog({
  invoice,
  open,
  onOpenChange,
  onReload,
}: ReverseInvoiceDialogProps) {
  const { t } = useTranslation('purchasing-docs')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const schema = z.object({
    date: calendarDate({ min: invoice.document_date }),
    reason: z.string().trim().min(3, t('validation.reason')).max(1000),
    reverseStock: z.boolean(),
  })
  const form = useForm<ReverseValues>({
    resolver: zodResolver(schema),
    defaultValues: { date: toIsoDate(new Date()), reason: '', reverseStock: false },
  })
  const reverseStock = useWatch({ control: form.control, name: 'reverseStock' })
  const mutation = useMutation({
    mutationFn: ({ v }: { v: ReverseValues; company: string }) => {
      const body = {
        version: invoice.version,
        date: v.date,
        reason: v.reason.trim(),
        reverse_stock: v.reverseStock,
      }
      return invoicesApi.reverse(invoice.id, body, keyFor({ id: invoice.id, ...body }))
    },
    onSuccess: (reversed, { company }) => {
      queryClient.setQueryData(purchKeys.detail('invoices', reversed.id, company), reversed)
      invalidatePurchEffects(queryClient, company)
      keyFor.reset()
      if (activeCompany() !== company) return
      onOpenChange(false)
      form.reset()
      platform.notify.success(t('reverse.done'))
    },
  })
  const conflict = isVersionConflict(mutation.error)

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent closeLabel={t('actions.close')}>
        <Form
          form={form}
          onSubmit={(v) => mutation.mutate({ v, company: activeCompany() })}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t('reverse.title', { number: invoice.number ?? '' })}</DialogTitle>
            <DialogDescription>{t('reverse.body')}</DialogDescription>
          </DialogHeader>
          {conflict ? (
            <VersionConflictAlert
              onReload={() => {
                mutation.reset()
                onOpenChange(false)
                onReload()
              }}
            />
          ) : (
            <FormErrorSummary
              error={mutation.error}
              mapField={(p) => (p === 'reverse_stock' ? 'reverseStock' : snakeToCamelPath(p))}
              fieldLabels={{
                date: t('reverse.date'),
                reason: t('fields.reason'),
                reverseStock: t('reverse.stock'),
              }}
            />
          )}
          <FormField<ReverseValues, 'date'>
            name="date"
            label={t('reverse.date')}
            required
            render={({ field, control }) => (
              <DateInput
                {...control}
                ref={field.ref}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <FormField<ReverseValues, 'reason'>
            name="reason"
            label={t('fields.reason')}
            required
            render={({ field, control }) => (
              <Textarea {...control} {...field} rows={3} maxLength={1000} />
            )}
          />
          {invoice.receive_on_invoice && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={reverseStock}
                onChange={(e) => form.setValue('reverseStock', e.target.checked)}
              />
              <span>
                {t('reverse.stock')}
                <span className="block text-xs text-muted-foreground">
                  {t('reverse.stockHint')}
                </span>
              </span>
            </label>
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
              {t('reverse.confirm')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
