import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { locationsApi } from '../api/resources'
import { refKeys } from '../hooks/keys'
import { useLocationMutations } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { locationSchema, toLocationInput, type LocationFormValues } from '../schemas'
import { LOCATION_TYPES, type WarehouseLocation } from '../types'
import { subtreeIds } from '../utils'
import { SelectField, TextField } from './fields'
import { ResourceDialog } from './ResourceDialog'
import { useReloadableRecord } from './useEditor'

/**
 * Re-reads the whole hierarchy (also refreshing the tree behind the dialog) and returns the
 * current version of one location; rejects when it no longer exists.
 */
async function reloadLocation(
  queryClient: QueryClient,
  warehouseId: string,
  record: WarehouseLocation,
): Promise<WarehouseLocation> {
  const rows = await queryClient.query({
    queryKey: refKeys.locations(warehouseId),
    queryFn: ({ signal }) => locationsApi.all(warehouseId, signal),
    staleTime: 0,
  })
  const fresh = rows.find((l) => l.id === record.id)
  if (!fresh) throw new Error('Location not found')
  return fresh
}

interface ParentOption {
  value: string
  label: string
}

/** Parents a location may move under: everything except itself and its descendants. */
function useParentOptions(all: readonly WarehouseLocation[], self: WarehouseLocation | null) {
  return useMemo<ParentOption[]>(() => {
    const blocked = self ? subtreeIds(all, self.id) : new Set<string>()
    return all
      .filter((l) => !blocked.has(l.id))
      .map((l) => ({ value: l.id, label: `${l.code} · ${l.name}` }))
  }, [all, self])
}

const toValues = (l: WarehouseLocation | null, parentId = ''): LocationFormValues => ({
  code: l?.code ?? '',
  name: l?.name ?? '',
  type: l?.type ?? 'aisle',
  parent_id: l?.parent_id ?? parentId,
  barcode: l?.barcode ?? '',
})

interface LocationDialogProps {
  warehouseId: string
  all: readonly WarehouseLocation[]
  record: WarehouseLocation | null
  /** Preselected parent for "add child". */
  parentId?: string
  onClose: () => void
}

export function LocationDialog({
  warehouseId,
  all,
  record: initial,
  parentId,
  onClose,
}: LocationDialogProps) {
  const t = useRefT()
  const queryClient = useQueryClient()
  const { create, update } = useLocationMutations(warehouseId)
  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: toValues(initial, parentId),
  })
  const { record, reload } = useReloadableRecord(
    initial,
    (r) => reloadLocation(queryClient, warehouseId, r),
    form.reset,
    (r) => toValues(r),
  )
  const parents = useParentOptions(all, record)

  return (
    <ResourceDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={record ? t('locations.edit') : t('locations.new')}
      form={form}
      onReload={reload}
      fieldLabels={{
        code: t('fields.code'),
        name: t('fields.name'),
        type: t('locations.type'),
        parent_id: t('locations.parent'),
        barcode: t('locations.barcode'),
      }}
      onSubmit={async (values, { idempotencyKey }) => {
        const input = toLocationInput(values)
        if (record) {
          await update.mutateAsync({ id: record.id, version: record.version, patch: input })
        } else {
          await create.mutateAsync({ input, key: idempotencyKey })
        }
      }}
    >
      <TextField<LocationFormValues>
        name="code"
        label={t('fields.code')}
        required
        maxLength={32}
        autoFocus
        uppercase
      />
      <TextField<LocationFormValues> name="name" label={t('fields.name')} required />
      <SelectField<LocationFormValues>
        name="type"
        label={t('locations.type')}
        required
        options={LOCATION_TYPES.map((v) => ({ value: v, label: t(`locations.types.${v}`) }))}
      />
      <TextField<LocationFormValues> name="barcode" label={t('locations.barcode')} maxLength={64} />
      <SelectField<LocationFormValues>
        name="parent_id"
        label={t('locations.parent')}
        options={parents}
        emptyLabel={t('tree.noParent')}
        className="sm:col-span-2"
      />
    </ResourceDialog>
  )
}

const moveSchema = z.object({ parent_id: z.string() })
type MoveValues = z.infer<typeof moveSchema>

interface LocationMoveDialogProps {
  warehouseId: string
  all: readonly WarehouseLocation[]
  record: WarehouseLocation
  onClose: () => void
}

/** Re-parents a location; the API rejects cycles, the picker already leaves out the subtree. */
export function LocationMoveDialog({
  warehouseId,
  all,
  record: initial,
  onClose,
}: LocationMoveDialogProps) {
  const t = useRefT()
  const queryClient = useQueryClient()
  const { update } = useLocationMutations(warehouseId)
  const form = useForm<MoveValues>({
    resolver: zodResolver(moveSchema),
    defaultValues: { parent_id: initial.parent_id ?? '' },
  })
  // After a conflict the record and the hierarchy are re-read before another attempt.
  const { record: current, reload } = useReloadableRecord<WarehouseLocation, MoveValues>(
    initial,
    (r) => reloadLocation(queryClient, warehouseId, r),
    form.reset,
    (r) => ({ parent_id: r.parent_id ?? '' }),
  )
  const record = current ?? initial
  const parents = useParentOptions(all, record)

  return (
    <ResourceDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={t('locations.moveTitle', { name: record.name })}
      form={form}
      onReload={reload}
      fieldLabels={{ parent_id: t('locations.parent') }}
      submitLabel={t('locations.move')}
      onSubmit={async (values) => {
        await update.mutateAsync({
          id: record.id,
          version: record.version,
          patch: { parent_id: values.parent_id || null },
        })
      }}
    >
      <SelectField<MoveValues>
        name="parent_id"
        label={t('locations.newParent')}
        options={parents}
        emptyLabel={t('tree.noParent')}
        className="sm:col-span-2"
      />
    </ResourceDialog>
  )
}
