import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { costCentersApi } from '../api/resources'
import { useCostCenters, useCreateCostCenter, useUpdateCostCenter } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { costCenterSchema, toCostCenterInput, type CostCenterFormValues } from '../schemas'
import type { CostCenter } from '../types'
import { subtreeIds } from '../utils'
import { CheckField, SelectField, TextField } from './fields'
import { ResourceDialog } from './ResourceDialog'
import { useReloadableRecord } from './useEditor'

const toValues = (c: CostCenter | null, parentId = ''): CostCenterFormValues => ({
  code: c?.code ?? '',
  name: c?.name ?? '',
  parent_id: c?.parent_id ?? parentId,
  is_active: c?.is_active ?? true,
})

interface CostCenterDialogProps {
  record: CostCenter | null
  /** Preselected parent for "add child". */
  parentId?: string
  onClose: () => void
}

export function CostCenterDialog({ record: initial, parentId, onClose }: CostCenterDialogProps) {
  const t = useRefT()
  const all = useCostCenters()
  const create = useCreateCostCenter()
  const update = useUpdateCostCenter()
  const form = useForm<CostCenterFormValues>({
    resolver: zodResolver(costCenterSchema),
    defaultValues: toValues(initial, parentId),
  })
  const { record, reload } = useReloadableRecord(
    initial,
    (r) => costCentersApi.get(r.id),
    form.reset,
    (r) => toValues(r),
  )
  const parents = useMemo(() => {
    const rows = all.data ?? []
    const blocked = record ? subtreeIds(rows, record.id) : new Set<string>()
    return rows
      .filter((r) => !blocked.has(r.id))
      .map((r) => ({ value: r.id, label: `${r.code} · ${r.name}` }))
  }, [all.data, record])

  return (
    <ResourceDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={record ? t('costCenters.edit') : t('costCenters.new')}
      form={form}
      onReload={reload}
      fieldLabels={{
        code: t('fields.code'),
        name: t('fields.name'),
        parent_id: t('costCenters.parent'),
      }}
      onSubmit={async (values, { idempotencyKey }) => {
        const input = toCostCenterInput(values)
        if (record) {
          await update.mutateAsync({ id: record.id, version: record.version, patch: input })
        } else {
          await create.mutateAsync({ input, key: idempotencyKey })
        }
      }}
    >
      <TextField<CostCenterFormValues>
        name="code"
        label={t('fields.code')}
        required
        maxLength={32}
        autoFocus
        uppercase
      />
      <TextField<CostCenterFormValues> name="name" label={t('fields.name')} required />
      <SelectField<CostCenterFormValues>
        name="parent_id"
        label={t('costCenters.parent')}
        options={parents}
        emptyLabel={t('tree.noParent')}
      />
      <CheckField<CostCenterFormValues> name="is_active" label={t('fields.active')} />
    </ResourceDialog>
  )
}
