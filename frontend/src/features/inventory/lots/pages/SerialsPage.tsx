import { History } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  DataTable,
  setFilter,
  toListParams,
  updateListQuery,
  useUrlListQuery,
  type DataTableColumn,
} from '@/components/shared/data-table'
import { FieldShell } from '@/components/shared/form'
import { StatusBadge, type StatusDefinition } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { ItemCombobox } from '@/features/catalog'
import { usePermission } from '@/lib/permissions'
import { ExpiryBadge } from '../../stock/components/ExpiryBadge'
import { ExportButtons } from '../../stock/components/ExportButtons'
import { InventoryShell } from '../../stock/components/common'
import { SavedViewsMenu } from '../../stock/components/SavedViewsMenu'
import { WarehouseSelect } from '../../stock/components/WarehouseSelect'
import { INV_PATHS } from '../../stock/lib/api'
import { acceptFilters, anyValue } from '../../stock/lib/filters'
import { useInvT } from '../../stock/lib/i18n'
import { lotPath } from '../../stock/lib/navigation'
import { useSerialList } from '../../stock/lib/queries'
import { knownWarehouses } from '../../stock/lib/warehouseOptions'
import { SERIAL_STATUSES, type StockSerial } from '../../stock/lib/types'
import { SerialHistoryDrawer } from '../components/SerialHistoryDrawer'

const VIEW_KEY = 'inventory.serials'
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
  const warehouseOptions = useMemo(
    () => knownWarehouses((list.data?.data ?? []).map((s) => s.warehouse)),
    [list.data],
  )
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

  const exportParams = useMemo(() => {
    const p = toListParams(query)
    delete p.page
    delete p.per_page
    return p
  }, [query])

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
        enableSorting: true,
        size: 260,
        meta: { label: t('fields.item') },
        cell: ({ row }) => (
          <span>
            <span className="font-code">{row.original.item.code}</span>{' '}
            <span className="text-muted-foreground">{row.original.item.name}</span>
          </span>
        ),
      },
      {
        id: 'lot',
        header: t('fields.lot'),
        size: 220,
        meta: { label: t('fields.lot') },
        cell: ({ row }) =>
          row.original.lot ? (
            <span className="inline-flex items-center gap-2">
              <Link to={lotPath(row.original.lot.id)} className="font-code hover:underline">
                {row.original.lot.lot_no}
              </Link>
              {row.original.lot.expiry_date && (
                <ExpiryBadge expiry={row.original.lot.expiry_date} />
              )}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'status',
        header: t('fields.status'),
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
          row.original.warehouse ? (
            <span>
              <span className="font-code">{row.original.warehouse.code}</span>
              {row.original.location && (
                <span className="font-code text-muted-foreground">
                  {' '}
                  / {row.original.location.code}
                </span>
              )}
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
    [t, statusDefs],
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
          <ExportButtons
            path={INV_PATHS.serials}
            params={exportParams}
            filename="seri-numaralari"
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
              known={warehouseOptions}
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
