import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { variantsApi } from '../../api/client'
import { catalogKeys } from '../../api/keys'
import { useIdempotencyKey, useInvalidate, useVariants } from '../../hooks/queries'
import { formatAttributes, fromAttributeRows, toAttributeRows } from '../../lib/attributes'
import { errorMessage, isVersionConflict } from '../../lib/errors'
import { variantSchema, type VariantValues } from '../../schemas'
import type { Item, ItemVariant } from '../../types'
import { AttributeEditor } from '../AttributeEditor'
import { CheckboxField, TextField } from '../fields'
import { RecordDialog } from '../RecordDialog'
import { SubTable } from './SubTable'

export function VariantsTab({ item }: { item: Item }) {
  const { t } = useTranslation('catalog')
  const variants = useVariants(item.id)
  const invalidate = useInvalidate()
  const canEdit = usePermission('items.update')
  const [editing, setEditing] = useState<ItemVariant | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ItemVariant | null>(null)

  const remove = useMutation({
    mutationFn: (v: ItemVariant) => variantsApi.remove(item.id, v.id),
    onSuccess: async () => {
      platform.notify.success(t('toast.deleted'))
      await invalidate(catalogKeys.variants(item.id))
    },
    onError: (e) => platform.notify.error(errorMessage(e, t('errors.deleteFailed'))),
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('variants.help')}</p>
        {canEdit && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden="true" />
            {t('variants.add')}
          </Button>
        )}
      </div>
      <SubTable
        label={t('items.tabs.variants')}
        query={variants}
        empty={t('variants.empty')}
        headers={[t('fields.sku'), t('fields.attributes'), t('fields.status')]}
        rows={(variants.data ?? []).map((v) => ({
          id: v.id,
          cells: [
            <span key="sku" className="font-code">
              {v.sku}
            </span>,
            formatAttributes(v.attributes) || '—',
            <StatusBadge key="st" status={v.is_active ? 'active' : 'inactive'} />,
          ],
          actions: canEdit ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('variants.edit', { sku: v.sku })}
                onClick={() => setEditing(v)}
              >
                <Pencil aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('variants.remove', { sku: v.sku })}
                onClick={() => setDeleting(v)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </>
          ) : null,
        }))}
      />
      {editing !== null && (
        <VariantDialog
          key={editing === 'new' ? 'new' : editing.id}
          item={item}
          variant={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('variants.removeTitle')}
        description={deleting ? t('variants.removeBody', { sku: deleting.sku }) : undefined}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting)
        }}
      />
    </div>
  )
}

function VariantDialog({
  item,
  variant,
  onClose,
}: {
  item: Item
  variant: ItemVariant | null
  onClose: () => void
}) {
  const { t } = useTranslation('catalog')
  const invalidate = useInvalidate()
  const idem = useIdempotencyKey()
  const [base, setBase] = useState(variant)
  const toValues = (v: ItemVariant | null): VariantValues => ({
    sku: v?.sku ?? '',
    attributes: toAttributeRows(v?.attributes),
    is_active: v?.is_active ?? true,
  })
  const form = useForm<VariantValues>({
    resolver: zodResolver(variantSchema),
    defaultValues: toValues(variant),
  })
  const save = useMutation({
    mutationFn: (v: VariantValues) => {
      const input = {
        sku: v.sku.trim(),
        attributes: fromAttributeRows(v.attributes),
        is_active: v.is_active,
      }
      return base
        ? variantsApi.update(item.id, base.id, { ...input, version: base.version })
        : variantsApi.create(item.id, input, idem.current(input))
    },
    onSuccess: async () => {
      idem.reset()
      platform.notify.success(t('toast.saved'))
      await invalidate(catalogKeys.variants(item.id))
      onClose()
    },
  })
  const reload = async () => {
    const list = await variantsApi.list(item.id)
    const fresh = list.find((x) => x.id === base?.id) ?? null
    await invalidate(catalogKeys.variants(item.id))
    save.reset()
    setBase(fresh)
    form.reset(toValues(fresh))
  }
  return (
    <RecordDialog<VariantValues>
      open
      onOpenChange={(o) => !o && onClose()}
      title={base ? t('variants.editTitle') : t('variants.newTitle')}
      form={form}
      onSubmit={(v) => save.mutate(v)}
      error={save.error}
      busy={save.isPending}
      onReload={isVersionConflict(save.error) ? () => void reload() : undefined}
      fieldLabels={{ sku: t('fields.sku'), attributes: t('fields.attributes') }}
    >
      <TextField<VariantValues, 'sku'>
        name="sku"
        label={t('fields.sku')}
        required
        input={{ autoComplete: 'off', className: 'font-code', maxLength: 32 }}
      />
      <AttributeEditor<VariantValues> name="attributes" label={t('fields.attributes')} />
      <CheckboxField<VariantValues, 'is_active'> name="is_active" label={t('fields.isActive')} />
    </RecordDialog>
  )
}
