import { ExternalLink, MapPin, Pencil, Star } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { DataTable, useUrlListQuery, type DataTableColumn } from '@/components/shared/data-table'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { useStockWarehouses, type StockWarehouse } from '../../shared/warehouses'
import { InventoryShell } from '../../stock/components/common'
import { useInvT } from '../../stock/lib/i18n'
import { INV_ACCESS, INV_PERMISSIONS } from '../../stock/lib/permissions'
import { WarehouseDialog, type WarehouseDialogTab } from '../components/WarehouseDialog'
import { REFERENCE_WAREHOUSES_PATH, RESERVATION_POLICIES } from '../lib/constants'

const VIEW_KEY = 'inventory.warehouses'

interface DialogState {
  warehouse: StockWarehouse
  tab: WarehouseDialogTab
  nonce: number
}

const NEGATIVE_TONES = { allow: 'warning', warn: 'warning', block: 'neutral' } as const

/**
 * Warehouses as the stock ledger sees them (GET /stock-warehouses, one unpaginated list):
 * Reference master data at a glance, the inventory reservation policy and the locations tree.
 * Search, filters, sorting and paging run in the browser.
 */
export function WarehousesPage() {
  const t = useInvT()
  const canManage = usePermission(INV_PERMISSIONS.warehouses.manage)
  const canSeeLocations = usePermission(INV_PERMISSIONS.referenceWarehouses.view)
  const canEditMaster = usePermission(INV_ACCESS.referenceWarehousesEdit)
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'code', desc: false }] },
    { viewKey: VIEW_KEY },
  )
  const list = useStockWarehouses()
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const open = (warehouse: StockWarehouse, tab: WarehouseDialogTab = 'general') =>
    setDialog({ warehouse, tab, nonce: Date.now() })

  const { rows, total } = useMemo(() => {
    const q = query.q.trim().toLocaleLowerCase('tr')
    const active = query.filters.is_active ?? ''
    const policy = query.filters.reservation_policy ?? ''
    const filtered = (list.data ?? []).filter(
      (w) =>
        (!q || `${w.code} ${w.name}`.toLocaleLowerCase('tr').includes(q)) &&
        (!active || String(w.is_active) === active) &&
        (!policy || w.reservation_policy === policy),
    )
    const [sort] = query.sort
    if (sort && (sort.id === 'code' || sort.id === 'name')) {
      const key = sort.id
      filtered.sort((a, b) => {
        const r = a[key].localeCompare(b[key], 'tr', { numeric: true })
        return sort.desc ? -r : r
      })
    }
    const start = (query.page - 1) * query.perPage
    return { rows: filtered.slice(start, start + query.perPage), total: filtered.length }
  }, [list.data, query])

  const columns = useMemo<DataTableColumn<StockWarehouse>[]>(
    () => [
      {
        id: 'code',
        accessorKey: 'code',
        header: t('warehouses.fields.code'),
        enableSorting: true,
        size: 140,
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
        size: 260,
        meta: { label: t('warehouses.fields.name') },
      },
      {
        id: 'negative_stock_policy',
        header: t('warehouses.fields.negativeStock'),
        size: 140,
        meta: { label: t('warehouses.fields.negativeStock') },
        cell: ({ row }) => (
          <Badge tone={NEGATIVE_TONES[row.original.negative_stock_policy]}>
            {t(`warehouses.negative.${row.original.negative_stock_policy}`)}
          </Badge>
        ),
      },
      {
        id: 'reservation_policy',
        header: t('warehouses.fields.reservationPolicy'),
        size: 160,
        meta: {
          label: t('warehouses.fields.reservationPolicy'),
          filter: {
            key: 'reservation_policy',
            options: RESERVATION_POLICIES.map((p) => ({
              value: p,
              label: t(`warehouses.policy.${p}`),
            })),
          },
        },
        cell: ({ row }) => t(`warehouses.policy.${row.original.reservation_policy}`),
      },
      {
        id: 'is_active',
        header: t('warehouses.fields.status'),
        size: 110,
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
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('common.actions')}</span>,
        size: 96,
        enableHiding: false,
        meta: { label: t('common.actions'), align: 'right' },
        cell: ({ row }) => {
          const w = row.original
          return (
            <span className="inline-flex gap-0.5">
              {canSeeLocations && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('warehouses.openLocations', { code: w.code })}
                  onClick={() => open(w, 'locations')}
                >
                  <MapPin aria-hidden="true" />
                </Button>
              )}
              {canManage && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('warehouses.edit', { code: w.code })}
                  onClick={() => open(w)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              )}
            </span>
          )
        },
      },
    ],
    [t, canManage, canSeeLocations],
  )

  return (
    <InventoryShell
      title={t('warehouses.title')}
      description={t('warehouses.description')}
      actions={
        canEditMaster && (
          <Button asChild variant="secondary">
            <Link to={REFERENCE_WAREHOUSES_PATH}>
              <ExternalLink aria-hidden="true" />
              {t('warehouses.manageInReference')}
            </Link>
          </Button>
        )
      }
    >
      <DataTable
        label={t('warehouses.title')}
        columns={columns}
        data={rows}
        total={total}
        query={query}
        onQueryChange={setQuery}
        getRowId={(w) => w.id}
        loading={list.isFetching}
        error={list.isError}
        onRetry={() => void list.refetch()}
        viewKey={VIEW_KEY}
        onRowActivate={(w) => open(w)}
      />
      {dialog && (
        <WarehouseDialog
          key={`${dialog.warehouse.id}:${dialog.nonce}`}
          open
          onOpenChange={(next) => !next && setDialog(null)}
          warehouse={dialog.warehouse}
          initialTab={dialog.tab}
        />
      )}
    </InventoryShell>
  )
}
