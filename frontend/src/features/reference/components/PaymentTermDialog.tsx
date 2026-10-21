import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { paymentTermsApi } from '../api/resources'
import { useCreatePaymentTerm, useUpdatePaymentTerm } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { paymentTermSchema, toPaymentTermInput, type PaymentTermFormValues } from '../schemas'
import type { PaymentTerm } from '../types'
import { CheckField, DecimalField, TextField } from './fields'
import { ResourceDialog } from './ResourceDialog'
import { useReloadableRecord } from './useEditor'

const toValues = (p: PaymentTerm | null): PaymentTermFormValues => ({
  code: p?.code ?? '',
  name: p?.name ?? '',
  due_days: p ? String(p.due_days) : '30',
  discount_percent: p?.discount_percent ?? '',
  discount_days: p?.discount_days != null ? String(p.discount_days) : '',
  is_active: p?.is_active ?? true,
})

interface PaymentTermDialogProps {
  record: PaymentTerm | null
  onClose: () => void
}

export function PaymentTermDialog({ record: initial, onClose }: PaymentTermDialogProps) {
  const t = useRefT()
  const create = useCreatePaymentTerm()
  const update = useUpdatePaymentTerm()
  const form = useForm<PaymentTermFormValues>({
    resolver: zodResolver(paymentTermSchema),
    defaultValues: toValues(initial),
  })
  const { record, reload } = useReloadableRecord(
    initial,
    (r) => paymentTermsApi.get(r.id),
    form.reset,
    toValues,
  )

  return (
    <ResourceDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={record ? t('paymentTerms.edit') : t('paymentTerms.new')}
      form={form}
      onReload={reload}
      fieldLabels={{
        code: t('fields.code'),
        name: t('fields.name'),
        due_days: t('paymentTerms.dueDays'),
        discount_percent: t('paymentTerms.discountPercent'),
        discount_days: t('paymentTerms.discountDays'),
      }}
      onSubmit={async (values, { idempotencyKey }) => {
        const input = toPaymentTermInput(values)
        if (record) {
          await update.mutateAsync({ id: record.id, version: record.version, patch: input })
        } else {
          await create.mutateAsync({ input, key: idempotencyKey })
        }
      }}
    >
      <TextField<PaymentTermFormValues>
        name="code"
        label={t('fields.code')}
        required
        maxLength={32}
        autoFocus
        uppercase
      />
      <TextField<PaymentTermFormValues> name="name" label={t('fields.name')} required />
      <DecimalField<PaymentTermFormValues>
        name="due_days"
        label={t('paymentTerms.dueDays')}
        required
        scale={0}
      />
      <DecimalField<PaymentTermFormValues>
        name="discount_percent"
        label={t('paymentTerms.discountPercent')}
        scale={4}
        displayMinFraction={2}
        suffix="%"
      />
      <DecimalField<PaymentTermFormValues>
        name="discount_days"
        label={t('paymentTerms.discountDays')}
        scale={0}
      />
      <CheckField<PaymentTermFormValues> name="is_active" label={t('fields.active')} />
    </ResourceDialog>
  )
}
