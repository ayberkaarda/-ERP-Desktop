import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
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
import { toIsoDate } from '@/lib/datetime'
import { calendarDate, snakeToCamelPath } from '@/lib/forms'
import { platform } from '@/platform'
import { VersionConflictAlert } from '../../invoices/kit/components/VersionConflictAlert'
import { isVersionConflict } from '../../invoices/kit/http'
import { usePayloadKeys } from '../../invoices/kit/idempotency'
import { activeCompany, invalidateSalesEffects, salesDocsKeys } from '../../invoices/kit/keys'
import { deliveriesApi, type Delivery } from '../api'

interface CancelDeliveryDialogProps {
  delivery: Delivery
  open: boolean
  onOpenChange: (open: boolean) => void
  onReload: () => void
}

interface CancelValues {
  date: string
  reason: string
}

/**
 * POST /sales-deliveries/{id}/cancel {version, reason, date}: a posted delivery reverses its stock
 * issue and COGS entry (StockService::reverse) and releases the order quantities.
 */
export function CancelDeliveryDialog({
  delivery,
  open,
  onOpenChange,
  onReload,
}: CancelDeliveryDialogProps) {
  const { t } = useTranslation('sales-docs')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const schema = z.object({
    date: calendarDate({ min: delivery.document_date }),
    reason: z.string().trim().min(3, t('validation.reason')).max(1000),
  })
  const form = useForm<CancelValues>({
    resolver: zodResolver(schema),
    defaultValues: { date: toIsoDate(new Date()), reason: '' },
  })
  const mutation = useMutation({
    mutationFn: ({ v }: { v: CancelValues; company: string }) => {
      const body = { version: delivery.version, reason: v.reason.trim(), date: v.date }
      return deliveriesApi.cancel(delivery.id, body, keyFor({ id: delivery.id, ...body }))
    },
    onSuccess: (cancelled, { company }) => {
      queryClient.setQueryData(salesDocsKeys.detail('deliveries', cancelled.id, company), cancelled)
      invalidateSalesEffects(queryClient, company)
      keyFor.reset()
      if (activeCompany() !== company) return
      onOpenChange(false)
      form.reset()
      platform.notify.success(t('delivery.cancelled'))
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
            <DialogTitle>
              {t('delivery.cancelTitle', { number: delivery.number ?? '' })}
            </DialogTitle>
            <DialogDescription>{t('delivery.cancelBody')}</DialogDescription>
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
              mapField={snakeToCamelPath}
              fieldLabels={{ date: t('fields.cancelDate'), reason: t('fields.reason') }}
            />
          )}
          <FormField<CancelValues, 'date'>
            name="date"
            label={t('fields.cancelDate')}
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
          <FormField<CancelValues, 'reason'>
            name="reason"
            label={t('fields.reason')}
            required
            render={({ field, control }) => (
              <Textarea {...control} {...field} rows={3} maxLength={1000} />
            )}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('actions.close')}
            </Button>
            <Button type="submit" variant="danger" disabled={mutation.isPending || conflict}>
              {mutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('delivery.cancelConfirm')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
