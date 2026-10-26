import { useState } from 'react'
import type { Kind } from './types'
import { control, Field } from './ui'
import { useEdocT } from './hooks'
import { Button } from '@/components/ui/button'
import { addressKeys, type addresses, type MetadataValues } from './metadata'
export function MetadataFields({
  kind,
  profile,
  values,
  onChange,
  lines = [],
  disabled = false,
}: {
  kind: Kind
  profile: string
  values: MetadataValues
  onChange: (values: MetadataValues) => void
  lines?: { id: string; name: string }[]
  disabled?: boolean
}) {
  const t = useEdocT()
  const [units, setUnits] = useState(
    Math.max(1, Object.keys(values).filter((key) => /^unit\.\d+\.from$/.test(key)).length),
  )
  const field = (
    key: string,
    options: { type?: string; required?: boolean; pattern?: string; maxLength?: number } = {},
  ) => (
    <Field key={key} label={t(key)}>
      <input
        className={control}
        type={options.type ?? 'text'}
        value={values[key] ?? ''}
        onChange={(event) =>
          onChange({
            ...values,
            [key]: ['vehicle_plate', 'payment_iban'].includes(key)
              ? event.target.value.replace(/\s/g, '').toUpperCase()
              : ['export_delivery_terms', 'export_package_type'].includes(key)
                ? event.target.value.toUpperCase()
                : event.target.value,
          })
        }
        disabled={disabled}
        required={options.required}
        pattern={options.pattern}
        maxLength={options.maxLength ?? 200}
        step={options.type === 'time' ? '1' : undefined}
      />
    </Field>
  )
  const address = (prefix: (typeof addresses)[number]) => (
    <fieldset key={prefix} className="space-y-3 rounded border border-border p-3">
      <legend className="px-1 text-sm font-medium">{t(prefix)}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {addressKeys.map((key) => (
          <Field key={key} label={t(key)}>
            <input
              className={control}
              value={values[`${prefix}.${key}`] ?? ''}
              onChange={(event) =>
                onChange({
                  ...values,
                  [`${prefix}.${key}`]:
                    key === 'country_code' ? event.target.value.toUpperCase() : event.target.value,
                })
              }
              maxLength={key === 'country_code' ? 2 : 200}
              pattern={key === 'country_code' ? '[A-Z]{2}' : undefined}
              disabled={disabled}
            />
          </Field>
        ))}
      </div>
    </fieldset>
  )
  return (
    <div className="space-y-4">
      {profile === 'KAMU' && (
        <div className="grid gap-3 sm:grid-cols-2">
          {field('payment_iban', { required: true, pattern: 'TR[0-9]{24}', maxLength: 26 })}
        </div>
      )}
      {profile === 'IHRACAT' && (
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold">{t('exportDetails')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('export_delivery_terms', { required: true, pattern: '[A-Z]{3}', maxLength: 3 })}
            <Field label={t('export_transport_mode')}>
              <select
                className={control}
                value={values.export_transport_mode ?? ''}
                disabled={disabled}
                required
                onChange={(event) =>
                  onChange({ ...values, export_transport_mode: event.target.value })
                }
              >
                <option value="">{t('choose')}</option>
                {['1', '2', '3', '4', '5', '7', '8', '9'].map((code) => (
                  <option key={code} value={code}>
                    {t(`transport_${code}`)}
                  </option>
                ))}
              </select>
            </Field>
            {field('export_package_type', { required: true, pattern: '[A-Z0-9]{2}', maxLength: 2 })}
            {field('export_package_quantity', { required: true, pattern: '[0-9]+([.][0-9]+)?' })}
            {field('export_package_id', { required: true, maxLength: 50 })}
            {field('export_gtip', { pattern: '[0-9]{12}', maxLength: 12 })}
          </div>
          <p className="text-xs text-muted-foreground">{t('gtipHelp')}</p>
          {lines.length > 0 && (
            <div className="max-h-80 space-y-2 overflow-auto">
              {lines.map((line) => (
                <Field key={line.id} label={`${t('gtip')} · ${line.id} · ${line.name}`}>
                  <input
                    className={control}
                    value={values[`gtip.${line.id}`] ?? ''}
                    onChange={(event) =>
                      onChange({ ...values, [`gtip.${line.id}`]: event.target.value })
                    }
                    pattern="[0-9]{12}"
                    maxLength={12}
                    required={!values.export_gtip}
                    disabled={disabled}
                  />
                </Field>
              ))}
            </div>
          )}
          {address('export_delivery_address')}
        </fieldset>
      )}
      {kind === 'e_despatch' && (
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-semibold">{t('shipment')}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {field('actual_despatch_date', { type: 'date', required: true })}
            {field('actual_despatch_time', { type: 'time', required: true })}
            {field('driver_first_name', { required: true })}
            {field('driver_last_name', { required: true })}
            {field('driver_tax_number', { required: true, pattern: '[0-9]{11}', maxLength: 11 })}
            {field('vehicle_plate', { required: true, pattern: '[A-Z0-9]{5,15}', maxLength: 15 })}
          </div>
          {address('delivery_address')}
        </fieldset>
      )}
      <details className="rounded border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">{t('additionalDetails')}</summary>
        <p className="my-3 text-xs text-muted-foreground">{t('addressHelp')}</p>
        <div className="space-y-4">
          {address('supplier_address')}
          {address('customer_address')}
          <div className="grid gap-3 sm:grid-cols-2">
            {field('issue_time', { type: 'time' })}
            {kind !== 'e_despatch' && field('original_invoice_number', { maxLength: 50 })}
            {kind !== 'e_despatch' && field('original_invoice_date', { type: 'date' })}
            {field('tax_exemption_code', { pattern: '[0-9]{3}', maxLength: 3 })}
            {field('tax_exemption_reason', { maxLength: 500 })}
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">{t('unitMapping')}</legend>
            {Array.from({ length: units }, (_, index) => (
              <div key={index} className="grid gap-3 sm:grid-cols-2">
                <Field label={`${t('localUnit')} ${index + 1}`}>
                  <input
                    className={control}
                    value={values[`unit.${index}.from`] ?? ''}
                    onChange={(event) =>
                      onChange({ ...values, [`unit.${index}.from`]: event.target.value })
                    }
                    disabled={disabled}
                    maxLength={20}
                  />
                </Field>
                <Field label={`${t('ublUnit')} ${index + 1}`}>
                  <input
                    className={control}
                    value={values[`unit.${index}.to`] ?? ''}
                    onChange={(event) =>
                      onChange({ ...values, [`unit.${index}.to`]: event.target.value })
                    }
                    disabled={disabled}
                    maxLength={10}
                  />
                </Field>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled || units >= 30}
              onClick={() => setUnits((value) => value + 1)}
            >
              {t('addUnit')}
            </Button>
          </fieldset>
        </div>
      </details>
    </div>
  )
}
