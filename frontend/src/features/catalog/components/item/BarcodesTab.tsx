import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Plus, Star, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FormField } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { barcodesApi } from '../../api/client'
import { catalogKeys } from '../../api/keys'
import {
  useBarcodes,
  useIdempotencyKey,
  useInvalidate,
  useItemUnits,
  useUnits,
  useVariants,
} from '../../hooks/queries'
import { detectBarcodeType, validateBarcode } from '../../lib/barcode'
import { errorMessage } from '../../lib/errors'
import { barcodeSchema, type BarcodeValues } from '../../schemas'
import { BARCODE_TYPES, type Item, type ItemBarcode } from '../../types'
import { CheckboxField, SelectField } from '../fields'
import { RecordDialog } from '../RecordDialog'
import { SubTable } from './SubTable'

export function BarcodesTab({ item }: { item: Item }) {
  const { t } = useTranslation('catalog')
  const barcodes = useBarcodes(item.id)
  const units = useUnits()
  const variants = useVariants(item.id)
  const invalidate = useInvalidate()
  const canEdit = usePermission('items.update')
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<ItemBarcode | null>(null)
  const unitCode = new Map((units.data ?? []).map((u) => [u.id, u.code]))
  const sku = new Map((variants.data ?? []).map((v) => [v.id, v.sku]))

  const remove = useMutation({
    mutationFn: (b: ItemBarcode) => barcodesApi.remove(item.id, b.id),
    onSuccess: async () => {
      platform.notify.success(t('toast.deleted'))
      await invalidate(catalogKeys.barcodes(item.id))
    },
    onError: (e) => platform.notify.error(errorMessage(e, t('errors.deleteFailed'))),
  })
  const makePrimary = useMutation({
    mutationFn: (b: ItemBarcode) =>
      barcodesApi.update(item.id, b.id, { is_primary: true, version: b.version }),
    onSuccess: async () => {
      await invalidate(catalogKeys.barcodes(item.id))
    },
    onError: (e) => platform.notify.error(errorMessage(e, t('errors.saveFailed'))),
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('barcode.help')}</p>
        {canEdit && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            {t('barcode.add')}
          </Button>
        )}
      </div>
      <SubTable
        label={t('items.tabs.barcodes')}
        query={barcodes}
        empty={t('barcode.empty')}
        headers={[
          t('fields.barcode'),
          t('fields.barcodeType'),
          t('fields.unit'),
          t('fields.variant'),
        ]}
        rows={(barcodes.data ?? []).map((b) => ({
          id: b.id,
          cells: [
            <span key="code" className="flex items-center gap-2">
              <span className="font-code">{b.barcode}</span>
              {b.is_primary && <Badge tone="primary">{t('barcode.primary')}</Badge>}
            </span>,
            t(`barcode.type.${b.type}`),
            <span key="u" className="font-code">
              {unitCode.get(b.unit_id) ?? '—'}
            </span>,
            b.variant_id ? (sku.get(b.variant_id) ?? '—') : t('barcode.allVariants'),
          ],
          actions: canEdit ? (
            <>
              {!b.is_primary && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('barcode.makePrimary', { code: b.barcode })}
                  onClick={() => makePrimary.mutate(b)}
                >
                  <Star aria-hidden="true" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('barcode.remove', { code: b.barcode })}
                onClick={() => setDeleting(b)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </>
          ) : null,
        }))}
      />
      {adding && <BarcodeDialog item={item} onClose={() => setAdding(false)} />}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('barcode.removeTitle')}
        description={deleting ? t('barcode.removeBody', { code: deleting.barcode }) : undefined}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting)
        }}
      />
    </div>
  )
}

function BarcodeDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { t } = useTranslation('catalog')
  const invalidate = useInvalidate()
  const idem = useIdempotencyKey()
  const units = useUnits()
  const itemUnits = useItemUnits(item.id)
  const variants = useVariants(item.id)
  const existing = useBarcodes(item.id)
  const form = useForm<BarcodeValues>({
    resolver: zodResolver(barcodeSchema),
    defaultValues: {
      barcode: '',
      type: 'ean13',
      unit_id: item.base_unit_id,
      variant_id: '',
      is_primary: (existing.data ?? []).length === 0,
    },
  })
  const [barcode, type] = useWatch({ control: form.control, name: ['barcode', 'type'] })
  const check = validateBarcode(barcode, type)

  // Base unit plus the item's alternate units: a barcode labels one packaging level.
  const unitOptions = useMemo(() => {
    const allowed = new Set([item.base_unit_id, ...(itemUnits.data ?? []).map((u) => u.unit_id)])
    return (units.data ?? [])
      .filter((u) => allowed.has(u.id))
      .map((u) => ({ value: u.id, label: `${u.code} · ${u.name}` }))
  }, [units.data, itemUnits.data, item.base_unit_id])

  const save = useMutation({
    mutationFn: (v: BarcodeValues) => {
      const input = {
        barcode: v.barcode.trim(),
        type: v.type,
        unit_id: v.unit_id,
        variant_id: v.variant_id || null,
        is_primary: v.is_primary,
      }
      return barcodesApi.create(item.id, input, idem.current(input))
    },
    onSuccess: async () => {
      idem.reset()
      platform.notify.success(t('toast.saved'))
      await invalidate(catalogKeys.barcodes(item.id))
      onClose()
    },
  })

  let hint: string | undefined
  if (check.problem === 'checkDigit' && check.expected !== undefined)
    hint = t('barcode.expectedDigit', { digit: check.expected })
  else if (check.ok && type !== 'other' && barcode.trim() !== '') hint = t('barcode.valid')
  else if (type !== 'other' && check.expectedLength)
    hint = t('barcode.lengthHint', { count: check.expectedLength })

  return (
    <RecordDialog<BarcodeValues>
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('barcode.newTitle')}
      form={form}
      onSubmit={(v) => save.mutate(v)}
      error={save.error}
      busy={save.isPending}
      fieldLabels={{ barcode: t('fields.barcode'), unit_id: t('fields.unit') }}
    >
      <FormField<BarcodeValues, 'barcode'>
        name="barcode"
        label={t('fields.barcode')}
        required
        description={<span role="status">{hint}</span>}
        render={({ field, control }) => (
          <Input
            {...control}
            ref={field.ref}
            name={field.name}
            value={field.value}
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            className="font-code"
            onChange={field.onChange}
            onBlur={() => {
              field.onBlur()
              // A scanned EAN/UPC preselects its symbology.
              const detected = detectBarcodeType(field.value)
              if (detected !== 'other' && detected !== form.getValues('type'))
                form.setValue('type', detected, { shouldValidate: true })
            }}
          />
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField<BarcodeValues, 'type'>
          name="type"
          label={t('fields.barcodeType')}
          options={BARCODE_TYPES.map((v) => ({ value: v, label: t(`barcode.type.${v}`) }))}
        />
        <SelectField<BarcodeValues, 'unit_id'>
          name="unit_id"
          label={t('fields.unit')}
          required
          options={unitOptions}
        />
        <SelectField<BarcodeValues, 'variant_id'>
          name="variant_id"
          label={t('fields.variant')}
          className="sm:col-span-2"
          options={[
            { value: '', label: t('barcode.allVariants') },
            ...(variants.data ?? []).map((v) => ({ value: v.id, label: v.sku })),
          ]}
        />
      </div>
      <CheckboxField<BarcodeValues, 'is_primary'>
        name="is_primary"
        label={t('barcode.primaryLabel')}
        description={t('barcode.primaryHelp')}
      />
    </RecordDialog>
  )
}
