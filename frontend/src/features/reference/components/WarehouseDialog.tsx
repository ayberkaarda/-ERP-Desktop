import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { warehousesApi } from '../api/resources'
import { useCreateWarehouse, useUpdateWarehouse } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { toWarehouseInput, warehouseSchema, type WarehouseFormValues } from '../schemas'
import { NEGATIVE_STOCK_POLICIES, type Warehouse } from '../types'
import { CheckField, SelectField, TextField } from './fields'
import { ResourceDialog } from './ResourceDialog'
import { useReloadableRecord } from './useEditor'

const toValues = (w: Warehouse | null): WarehouseFormValues => ({
  code: w?.code ?? '',
  name: w?.name ?? '',
  negative_stock_policy: w?.negative_stock_policy ?? 'block',
  is_active: w?.is_active ?? true,
  is_default: w?.is_default ?? false,
  line1: w?.address?.line1 ?? '',
  line2: w?.address?.line2 ?? '',
  district: w?.address?.district ?? '',
  city: w?.address?.city ?? '',
  postal_code: w?.address?.postal_code ?? '',
  country: w?.address?.country ?? '',
})

// The API nests the address; the form keeps it flat.
const mapServerField = (field: string) =>
  field.startsWith('address.') ? field.slice('address.'.length) : field

interface WarehouseDialogProps {
  record: Warehouse | null
  onClose: () => void
}

export function WarehouseDialog({ record: initial, onClose }: WarehouseDialogProps) {
  const t = useRefT()
  const create = useCreateWarehouse()
  const update = useUpdateWarehouse()
  const form = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: toValues(initial),
  })
  const { record, reload } = useReloadableRecord(
    initial,
    (r) => warehousesApi.get(r.id),
    form.reset,
    toValues,
  )

  return (
    <ResourceDialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title={record ? t('warehouses.edit') : t('warehouses.new')}
      form={form}
      onReload={reload}
      mapField={mapServerField}
      fieldLabels={{
        code: t('fields.code'),
        name: t('fields.name'),
        negative_stock_policy: t('warehouses.negativeStock'),
        line1: t('warehouses.address.line1'),
        country: t('warehouses.address.country'),
      }}
      onSubmit={async (values, { idempotencyKey }) => {
        const input = toWarehouseInput(values)
        if (record) {
          await update.mutateAsync({ id: record.id, version: record.version, patch: input })
        } else {
          await create.mutateAsync({ input, key: idempotencyKey })
        }
      }}
    >
      <TextField<WarehouseFormValues>
        name="code"
        label={t('fields.code')}
        required
        maxLength={32}
        autoFocus
        uppercase
      />
      <TextField<WarehouseFormValues> name="name" label={t('fields.name')} required />
      <SelectField<WarehouseFormValues>
        name="negative_stock_policy"
        label={t('warehouses.negativeStock')}
        required
        options={NEGATIVE_STOCK_POLICIES.map((v) => ({
          value: v,
          label: t(`warehouses.policies.${v}`),
        }))}
      />
      <div className="flex items-end gap-6">
        <CheckField<WarehouseFormValues> name="is_active" label={t('fields.active')} />
        <CheckField<WarehouseFormValues> name="is_default" label={t('warehouses.default')} />
      </div>
      <TextField<WarehouseFormValues>
        name="line1"
        label={t('warehouses.address.line1')}
        className="sm:col-span-2"
      />
      <TextField<WarehouseFormValues>
        name="line2"
        label={t('warehouses.address.line2')}
        className="sm:col-span-2"
      />
      <TextField<WarehouseFormValues> name="district" label={t('warehouses.address.district')} />
      <TextField<WarehouseFormValues> name="city" label={t('warehouses.address.city')} />
      <TextField<WarehouseFormValues>
        name="postal_code"
        label={t('warehouses.address.postalCode')}
      />
      <TextField<WarehouseFormValues>
        name="country"
        label={t('warehouses.address.country')}
        maxLength={2}
        uppercase
      />
    </ResourceDialog>
  )
}
