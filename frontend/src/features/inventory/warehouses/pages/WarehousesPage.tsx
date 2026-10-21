import { MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DataTable, useUrlListQuery, type DataTableColumn } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { InventoryShell } from '../../stock/components/common'
import { errorMessage } from '../../stock/lib/errors'
import { useInvT } from '../../stock/lib/i18n'
import { INV_PERMISSIONS } from '../../stock/lib/permissions'
import { useAllWarehouses, useDeleteWarehouse, useWarehouseList } from '../../stock/lib/queries'
import type { Warehouse } from '../../stock/lib/types'
import { WarehouseDialog } from '../components/WarehouseDialog'

const VIEW_KEY = 'inventory.warehouses'

interface DialogState {
  warehouse: Warehouse | null
  tab: 'general' | 'locations'
  nonce: number
}

/** Warehouse list: settings at a glance, create/edit dialog with the locations tree. */
export function WarehousesPage() {
  const t = useInvT()
  const canManage = usePermission(INV_PERMISSIONS.warehouses.manage)
  const [params, setParams] = useSearchParams()
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }] },
    {
      viewKey: VIEW_KEY,
    },
  )
  const list = useWarehouseList(query)
  const all = useAllWarehouses()
  const remove = useDeleteWarehouse()
  // ?new=1 (command palette) opens the create dialog; closing it drops the param.
  const [dialog, setDialog] = useState<DialogState | null>(() =>
    params.get('new') === '1' ? { warehouse: null, tab: 'general', nonce: 0 } : null,
  )
  const [deleting, setDeleting] = useState<Warehouse | null>(null)
  const currentDefault = all.data?.find((w) => w.is_default) ?? null

  const closeDialog = () => {
    setDialog(null)
    if (params.get('new')) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('new')
          return next
        },
        { replace: true },
      )
    }
  }

  const open = (warehouse: Warehouse | null, tab: DialogState['tab'] = 'general') =>
    setDialog({ warehouse, tab, nonce: Date.now() })

  const columns = useMemo<DataTableColumn<Warehouse>[]>(
    () => [
      {
        id: 'code',
        accessorKey: 'code',
        header: t('warehouses.fields.code'),
        enableSorting: true,
        size: 120,
        meta: { label: t('warehouses.fields.code') },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-code font-medium">{row.original.code}</span>
            {row.original.is_default && (
              <Badge tone="primary" data-default="true">
                <Star aria-hidden="true" />
                {t('warehouses.default')}
              </Badge>
            )}
          </span>
        ),
      },
      {
        id: 'name',
        accessorKey: 'name',
        header: t('warehouses.fields.name'),
        enableSorting: true,
        size: 240,
        meta: { label: t('warehouses.fields.name') },
      },
      {
        id: 'address',
        accessorKey: 'address',
        header: t('warehouses.fields.address'),
        size: 240,
        meta: { label: t('warehouses.fields.address') },
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.address ?? '—'}</span>
        ),
      },
      {
        id: 'allow_negative_stock',
        header: t('warehouses.fields.allowNegative'),
        size: 120,
        meta: { label: t('warehouses.fields.allowNegative') },
        cell: ({ row }) =>
          row.original.allow_negative_stock ? (
            <Badge tone="warning">{t('common.yes')}</Badge>
          ) : (
            <span className="text-muted-foreground">{t('common.no')}</span>
          ),
      },
      {
        id: 'reservation_policy',
        header: t('warehouses.fields.reservationPolicy'),
        size: 140,
        meta: {
          label: t('warehouses.fields.reservationPolicy'),
          filter: {
            key: 'reservation_policy',
            options: (['none', 'soft', 'hard'] as const).map((p) => ({
              value: p,
              label: t(`warehouses.policy.${p}`),
            })),
          },
        },
        cell: ({ row }) => t(`warehouses.policy.${row.original.reservation_policy}`),
      },
      {
        id: 'locations_count',
        header: t('warehouses.fields.locations'),
        size: 100,
        meta: { label: t('warehouses.fields.locations'), align: 'right' },
        cell: ({ row }) => (
          <Button
            variant="link"
            size="sm"
            aria-label={t('warehouses.openLocations', { code: row.original.code })}
            onClick={() => open(row.original, 'locations')}
          >
            <MapPin aria-hidden="true" />
            {row.original.locations_count ?? '—'}
          </Button>
        ),
      },
      {
        id: 'is_active',
        header: t('warehouses.fields.status'),
        size: 100,
        meta: {
          label: t('warehouses.fields.status'),
          filter: {
            key: 'is_active',
            options: [
              { value: 'true', label: t('common.active') },
              { value: 'false', label: t('common.inactive') },
            ],
          },
        },
        cell: ({ row }) => <StatusBadge status={row.original.is_active ? 'active' : 'inactive'} />,
      },
      ...(canManage
        ? [
            {
              id: 'actions',
              header: () => <span className="sr-only">{t('common.actions')}</span>,
              size: 96,
              enableHiding: false,
              meta: { label: t('common.actions'), align: 'right' },
              cell: ({ row }) => {
                const w = row.original
                const locked = w.is_default || w.has_movements === true
                return (
                  <span className="inline-flex gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('warehouses.edit', { code: w.code })}
                      onClick={() => open(w)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={locked}
                      title={
                        w.is_default
                          ? t('warehouses.deleteDefault')
                          : w.has_movements
                            ? t('warehouses.deleteMoved')
                            : undefined
                      }
                      aria-label={t('warehouses.delete', { code: w.code })}
                      onClick={() => setDeleting(w)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </span>
                )
              },
            } satisfies DataTableColumn<Warehouse>,
          ]
        : []),
    ],
    [t, canManage],
  )

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await remove.mutateAsync({ id: deleting.id, version: deleting.version })
      platform.notify.success(t('warehouses.deleted', { code: deleting.code }))
      setDeleting(null)
    } catch (error) {
      platform.notify.error(errorMessage(error, t('warehouses.deleteFailed')))
      throw error
    }
  }

  return (
    <InventoryShell
      title={t('warehouses.title')}
      description={t('warehouses.description')}
      actions={
        canManage && (
          <Button onClick={() => open(null)}>
            <Plus aria-hidden="true" />
            {t('warehouses.new')}
          </Button>
        )
      }
    >
      <DataTable
        label={t('warehouses.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.pagination.total ?? 0}
        query={query}
        onQueryChange={setQuery}
        getRowId={(w) => w.id}
        loading={list.isFetching}
        error={list.isError}
        onRetry={() => void list.refetch()}
        viewKey={VIEW_KEY}
        onRowActivate={(w) => open(w)}
      />
      {dialog && (dialog.warehouse !== null || canManage) && (
        <WarehouseDialog
          key={`${dialog.warehouse?.id ?? 'new'}:${dialog.nonce}`}
          open
          onOpenChange={(next) => !next && closeDialog()}
          warehouse={dialog.warehouse}
          currentDefault={currentDefault}
          initialTab={dialog.tab}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(next) => !next && setDeleting(null)}
        title={t('warehouses.deleteTitle', { code: deleting?.code ?? '' })}
        description={t('warehouses.deleteBody')}
        confirmLabel={t('warehouses.deleteConfirm')}
        onConfirm={confirmDelete}
      />
    </InventoryShell>
  )
}
