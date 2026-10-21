import { History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  DataTable,
  setFilter,
  updateListQuery,
  useUrlListQuery,
  type DataTableColumn,
} from '@/components/shared/data-table'
import { FieldShell } from '@/components/shared/form'
import { StatusBadge, type StatusDefinition } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { ItemCombobox } from '@/features/catalog'
import { usePermission } from '@/lib/permissions'
import { InventoryShell } from '../../stock/components/common'
import { SavedViewsMenu } from '../../stock/components/SavedViewsMenu'
import { WarehouseSelect } from '../../stock/components/WarehouseSelect'
import { acceptFilters, anyValue } from '../../stock/lib/filters'
import { useInvT } from '../../stock/lib/i18n'
import { lotPath } from '../../stock/lib/navigation'
import { useSerialList } from '../../stock/lib/queries'
import { useWarehouseLookup } from '../../stock/lib/warehouseLookup'
import { SERIAL_STATUSES, type StockSerial } from '../../stock/lib/types'
import { SerialHistoryDrawer } from '../components/SerialHistoryDrawer'

const VIEW_KEY = 'inventory.serials'
/** Filters of TraceController::serials. */
const FILTER_KEYS = ['item_id', 'warehouse_id', 'status'] as const
const TONES = {
  in_stock: 'success',
  reserved: 'warning',
  issued: 'neutral',
  scrapped: 'danger',
} as const

/** Serial units with their status and place; each opens its movement history. */
export function SerialsPage() {
  const t = useInvT()
  const canPickItems = usePermission('items.view')
  const { query: urlQuery, setQuery } = useUrlListQuery(
    { sort: [{ id: 'serial_no', desc: false }] },
    { viewKey: VIEW_KEY },
  )
  // Only filters with a control on this page are requested (the item filter needs the picker).
  const query = useMemo(
    () => ({
      ...urlQuery,
      filters: acceptFilters(urlQuery.filters, {
        warehouse_id: anyValue,
        status: (v) => (SERIAL_STATUSES as readonly string[]).includes(v),
        ...(canPickItems ? { item_id: anyValue } : {}),
      }),
    }),
    [urlQuery, canPickItems],
  )
  const list = useSerialList(query)
  const warehouseOf = useWarehouseLookup()
  const [history, setHistory] = useState<StockSerial | null>(null)
  const filter = (key: string) => query.filters[key] ?? ''
  const change = (key: string, value: string) => setQuery(setFilter(query, key, value))
  const filtered = FILTER_KEYS.some((k) => filter(k) !== '') || query.q !== ''

  const statusDefs = useMemo<Record<string, StatusDefinition>>(
    () =>
      Object.fromEntries(
        SERIAL_STATUSES.map((s) => [s, { tone: TONES[s], label: t(`serials.status.${s}`) }]),
      ),
    [t],
  )

  const columns = useMemo<DataTableColumn<StockSerial>[]>(
    () => [
      {
        id: 'serial_no',
        header: t('fields.serial'),
        enableSorting: true,
        enableHiding: false,
        size: 180,
        meta: { label: t('fields.serial') },
        cell: ({ row }) => <span className="font-code font-medium">{row.original.serial_no}</span>,
      },
      {
        id: 'item_code',
        header: t('fields.item'),
        size: 260,
        meta: { label: t('fields.item') },
        cell: ({ row }) => (
          <span>
            <span className="font-code">{row.original.item_code}</span>{' '}
            <span className="text-muted-foreground">{row.original.item_name}</span>
          </span>
        ),
      },
      {
        id: 'lot',
        header: t('fields.lot'),
        size: 220,
        meta: { label: t('fields.lot') },
        cell: ({ row }) =>
          row.original.lot_id ? (
            <Link to={lotPath(row.original.lot_id)} className="font-code hover:underline">
              {row.original.lot_no ?? row.original.lot_id}
            </Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'status',
        header: t('fields.status'),
        enableSorting: true,
        size: 120,
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: SERIAL_STATUSES.map((s) => ({ value: s, label: t(`serials.status.${s}`) })),
          },
        },
        cell: ({ row }) => <StatusBadge status={row.original.status} definitions={statusDefs} />,
      },
      {
        id: 'place',
        header: t('fields.warehouse'),
        size: 160,
        meta: { label: t('fields.warehouse') },
        cell: ({ row }) =>
          row.original.warehouse_id ? (
            <span className="font-code" title={warehouseOf(row.original.warehouse_id)?.name}>
              {warehouseOf(row.original.warehouse_id)?.code ?? '—'}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'history',
        header: () => <span className="sr-only">{t('serials.history')}</span>,
        size: 56,
        enableHiding: false,
        meta: { label: t('serials.history'), align: 'right' },
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('serials.openHistory', { serial: row.original.serial_no })}
            onClick={() => setHistory(row.original)}
          >
            <History aria-hidden="true" />
          </Button>
        ),
      },
    ],
    [t, statusDefs, warehouseOf],
  )

  return (
    <InventoryShell
      title={t('serials.title')}
      description={t('serials.description')}
      actions={
        <>
          <SavedViewsMenu
            storageKey="serials"
            current={{ ...(query.q ? { q: query.q } : {}), ...query.filters }}
            onApply={(values) =>
              setQuery(
                updateListQuery(query, {
                  q: values.q ?? '',
                  filters: Object.fromEntries(
                    FILTER_KEYS.filter((k) => values[k]).map((k) => [k, values[k] ?? '']),
                  ),
                }),
              )
            }
          />
        </>
      }
    >
      <div
        role="group"
        aria-label={t('common.filters')}
        className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
      >
        {canPickItems && (
          <FieldShell label={t('fields.item')} className="w-72">
            {(control) => (
              <ItemCombobox
                {...control}
                type="stock"
                includeInactive
                value={filter('item_id') || null}
                onChange={(id) => change('item_id', id ?? '')}
              />
            )}
          </FieldShell>
        )}
        <FieldShell label={t('fields.warehouse')} className="w-56">
          {(control) => (
            <WarehouseSelect
              {...control}
              value={filter('warehouse_id')}
              onChange={(v) => change('warehouse_id', v)}
            />
          )}
        </FieldShell>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setQuery(updateListQuery(query, { q: '', filters: {} }))}
          >
            {t('common.clearFilters')}
          </Button>
        )}
      </div>
      <DataTable
        label={t('serials.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.pagination.total ?? 0}
        query={query}
        onQueryChange={setQuery}
        getRowId={(s) => s.id}
        loading={list.isFetching}
        error={list.isError}
        onRetry={() => void list.refetch()}
        viewKey={VIEW_KEY}
        onRowActivate={(s) => setHistory(s)}
      />
      <SerialHistoryDrawer serial={history} onClose={() => setHistory(null)} />
    </InventoryShell>
  )
}
