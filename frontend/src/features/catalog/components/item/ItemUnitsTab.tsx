import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { FieldShell, FormField, QuantityInput } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { itemUnitsApi } from '../../api/client'
import { catalogKeys } from '../../api/keys'
import { useIdempotencyKey, useInvalidate, useItemUnits, useUnits } from '../../hooks/queries'
import { convertQty, factorProblem, fractionDigits, inverseFactor } from '../../lib/conversion'
import { errorMessage, isVersionConflict } from '../../lib/errors'
import { itemUnitSchema, type ItemUnitValues } from '../../schemas'
import type { Item, ItemUnit } from '../../types'
import { DecimalField } from '../fields'
import { UnitSelect } from '../pickers'
import { RecordDialog } from '../RecordDialog'
import { SubTable } from './SubTable'

function useFormatQty() {
  const locale = useIntlLocale()
  // Previews may need more than 6 digits (1 / 10 000 000); stored values never do.
  return (value: string) =>
    formatDecimalDisplay(value, {
      locale,
      minFraction: 0,
      maxFraction: Math.max(6, fractionDigits(value)),
    })
}

export function ItemUnitsTab({ item }: { item: Item }) {
  const { t } = useTranslation('catalog')
  const fmt = useFormatQty()
  const rows = useItemUnits(item.id)
  const units = useUnits()
  const invalidate = useInvalidate()
  const canEdit = usePermission('items.update')
  const [editing, setEditing] = useState<ItemUnit | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ItemUnit | null>(null)
  const code = (id: string) => units.data?.find((u) => u.id === id)?.code ?? '—'
  const baseCode = item.base_unit?.code ?? code(item.base_unit_id)

  const remove = useMutation({
    mutationFn: (u: ItemUnit) => itemUnitsApi.remove(item.id, u.id),
    onSuccess: async () => {
      platform.notify.success(t('toast.deleted'))
      await invalidate(catalogKeys.itemUnits(item.id))
    },
    onError: (e) => platform.notify.error(errorMessage(e, t('errors.deleteFailed'))),
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('itemUnits.help', { base: baseCode })}</p>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('itemUnits.add')}
          </Button>
        )}
      </div>
      <SubTable
        label={t('items.tabs.units')}
        query={rows}
        empty={t('itemUnits.empty')}
        headers={[t('fields.unit'), t('fields.factor'), t('itemUnits.equation')]}
        rows={(rows.data ?? []).map((u) => ({
          id: u.id,
          cells: [
            <span key="c" className="font-code">
              {code(u.unit_id)}
            </span>,
            fmt(u.factor),
            t('itemUnits.equationText', {
              unit: code(u.unit_id),
              factor: fmt(u.factor),
              base: baseCode,
            }),
          ],
          actions: canEdit ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('itemUnits.edit', { unit: code(u.unit_id) })}
                onClick={() => setEditing(u)}
              >
                <Pencil aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('itemUnits.remove', { unit: code(u.unit_id) })}
                onClick={() => setDeleting(u)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </>
          ) : null,
        }))}
      />
      {editing !== null && (
        <ItemUnitDialog
          key={editing === 'new' ? 'new' : editing.id}
          item={item}
          row={editing === 'new' ? null : editing}
          taken={(rows.data ?? []).map((r) => r.unit_id)}
          baseCode={baseCode}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('itemUnits.removeTitle')}
        description={
          deleting ? t('itemUnits.removeBody', { unit: code(deleting.unit_id) }) : undefined
        }
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting)
        }}
      />
    </div>
  )
}

function ItemUnitDialog({
  item,
  row,
  taken,
  baseCode,
  onClose,
}: {
  item: Item
  row: ItemUnit | null
  taken: string[]
  baseCode: string
  onClose: () => void
}) {
  const { t } = useTranslation('catalog')
  const fmt = useFormatQty()
  const units = useUnits()
  const invalidate = useInvalidate()
  const idem = useIdempotencyKey()
  const [base, setBase] = useState(row)
  const [sample, setSample] = useState('1')
  const form = useForm<ItemUnitValues>({
    resolver: zodResolver(itemUnitSchema),
    defaultValues: { unit_id: row?.unit_id ?? '', factor: row?.factor ?? '' },
  })
  const [unitId, factor] = useWatch({ control: form.control, name: ['unit_id', 'factor'] })
  const unitCode = units.data?.find((u) => u.id === unitId)?.code ?? '?'
  const converted = factorProblem(factor) === null ? convertQty(sample, factor) : null
  const inverse = inverseFactor(factor)

  const save = useMutation({
    mutationFn: (v: ItemUnitValues) =>
      base
        ? itemUnitsApi.update(item.id, base.id, { ...v, version: base.version })
        : itemUnitsApi.create(item.id, v, idem.current(v)),
    onSuccess: async () => {
      idem.reset()
      platform.notify.success(t('toast.saved'))
      await invalidate(catalogKeys.itemUnits(item.id))
      onClose()
    },
  })
  const reload = async () => {
    const list = await itemUnitsApi.list(item.id)
    const fresh = list.find((x) => x.id === base?.id) ?? null
    await invalidate(catalogKeys.itemUnits(item.id))
    save.reset()
    setBase(fresh)
    form.reset({ unit_id: fresh?.unit_id ?? '', factor: fresh?.factor ?? '' })
  }

  return (
    <RecordDialog<ItemUnitValues>
      open
      onOpenChange={(o) => !o && onClose()}
      title={base ? t('itemUnits.editTitle') : t('itemUnits.newTitle')}
      form={form}
      onSubmit={(v) => save.mutate(v)}
      error={save.error}
      busy={save.isPending}
      onReload={isVersionConflict(save.error) ? () => void reload() : undefined}
      fieldLabels={{ unit_id: t('fields.unit'), factor: t('fields.factor') }}
    >
      <FormField<ItemUnitValues, 'unit_id'>
        name="unit_id"
        label={t('fields.unit')}
        required
        render={({ field, control }) => (
          <UnitSelect
            {...control}
            ref={field.ref}
            value={field.value || null}
            onChange={(v) => field.onChange(v ?? '')}
            onBlur={field.onBlur}
            disabled={Boolean(base)}
            exclude={[item.base_unit_id, ...taken.filter((id) => id !== base?.unit_id)]}
          />
        )}
      />
      <DecimalField<ItemUnitValues, 'factor'>
        name="factor"
        label={t('itemUnits.factorLabel', { unit: unitCode, base: baseCode })}
        required
        scale={6}
        suffix={baseCode}
        description={
          inverse
            ? t('itemUnits.inverse', { base: baseCode, inverse: fmt(inverse), unit: unitCode })
            : undefined
        }
      />
      <section
        aria-label={t('itemUnits.preview')}
        className="space-y-2 rounded-md border border-border bg-surface-sunken p-3"
      >
        <p className="text-xs font-medium text-muted-foreground">{t('itemUnits.preview')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <FieldShell label={t('itemUnits.sampleQty', { unit: unitCode })} className="w-40">
            {(control) => (
              <QuantityInput
                {...control}
                value={sample}
                onChange={setSample}
                scale={6}
                unit={unitCode}
              />
            )}
          </FieldShell>
          <p className="pb-2 text-sm" role="status" aria-live="polite">
            {converted !== null
              ? t('itemUnits.previewResult', {
                  qty: fmt(sample),
                  unit: unitCode,
                  result: fmt(converted),
                  base: baseCode,
                })
              : t('itemUnits.previewEmpty')}
          </p>
        </div>
      </section>
    </RecordDialog>
  )
}
