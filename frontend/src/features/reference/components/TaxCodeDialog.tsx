import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { taxCodesApi } from '../api/resources'
import { useCreateTaxCode, useUpdateTaxCode } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { taxCodeSchema, toTaxCodeInput, type TaxCodeFormValues } from '../schemas'
import { TAX_TYPES, type TaxCode } from '../types'
import { CheckField, DateField, DecimalField, SelectField, TextField } from './fields'
import { ResourceDialog } from './ResourceDialog'
import { useReloadableRecord } from './useEditor'

const toValues = (c: TaxCode | null): TaxCodeFormValues => ({
  type: c?.type ?? 'vat',
  code: c?.code ?? '',
  name: c?.name ?? '',
  rate: c?.rate ?? '',
  numerator: c?.numerator != null ? String(c.numerator) : '',
  denominator: c?.denominator != null ? String(c.denominator) : '',
  effective_from: c?.effective_from ?? '',
  effective_to: c?.effective_to ?? '',
  is_active: c?.is_active ?? true,
})

interface TaxCodeDialogProps {
  record: TaxCode | null
  onClose: () => void
}

/** Create/edit of company-specific tax codes; global rows never reach this dialog. */
export function TaxCodeDialog({ record: initial, onClose }: TaxCodeDialogProps) {
  const t = useRefT()
  const create = useCreateTaxCode()
  const update = useUpdateTaxCode()
  const form = useForm<TaxCodeFormValues>({
    resolver: zodResolver(taxCodeSchema),
    defaultValues: toValues(initial),
  })
  const { record, reload } = useReloadableRecord(
    initial,
    (r) => taxCodesApi.get(r.id),
    form.reset,
    toValues,
  )
  const type = useWatch({ control: form.control, name: 'type' })

  return (
    <ResourceDialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title={record ? t('taxCodes.edit') : t('taxCodes.new')}
      description={t('taxCodes.customHint')}
      form={form}
      onReload={reload}
      fieldLabels={{
        type: t('taxCodes.type'),
        code: t('fields.code'),
        name: t('fields.name'),
        rate: t('taxCodes.rate'),
        numerator: t('taxCodes.numerator'),
        denominator: t('taxCodes.denominator'),
        effective_from: t('taxCodes.effectiveFrom'),
        effective_to: t('taxCodes.effectiveTo'),
      }}
      onSubmit={async (values, { idempotencyKey }) => {
        const input = toTaxCodeInput(values)
        if (record) {
          await update.mutateAsync({ id: record.id, version: record.version, patch: input })
        } else {
          await create.mutateAsync({ input, key: idempotencyKey })
        }
      }}
    >
      <SelectField<TaxCodeFormValues>
        name="type"
        label={t('taxCodes.type')}
        required
        options={TAX_TYPES.map((v) => ({ value: v, label: t(`taxCodes.types.${v}`) }))}
      />
      <TextField<TaxCodeFormValues>
        name="code"
        label={t('fields.code')}
        required
        maxLength={32}
        uppercase
      />
      <TextField<TaxCodeFormValues>
        name="name"
        label={t('fields.name')}
        required
        className="sm:col-span-2"
      />
      <DecimalField<TaxCodeFormValues>
        name="rate"
        label={t('taxCodes.rate')}
        required={type === 'vat'}
        scale={4}
        displayMinFraction={2}
        suffix="%"
      />
      {type === 'withholding' && (
        <>
          <DecimalField<TaxCodeFormValues>
            name="numerator"
            label={t('taxCodes.numerator')}
            required
            scale={0}
          />
          <DecimalField<TaxCodeFormValues>
            name="denominator"
            label={t('taxCodes.denominator')}
            required
            scale={0}
          />
        </>
      )}
      <DateField<TaxCodeFormValues> name="effective_from" label={t('taxCodes.effectiveFrom')} />
      <DateField<TaxCodeFormValues> name="effective_to" label={t('taxCodes.effectiveTo')} />
      <CheckField<TaxCodeFormValues> name="is_active" label={t('fields.active')} />
    </ResourceDialog>
  )
}
