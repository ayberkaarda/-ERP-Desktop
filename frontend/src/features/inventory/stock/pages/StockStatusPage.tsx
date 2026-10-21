import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import {
  DataTable,
  setFilter,
  updateListQuery,
  useUrlListQuery,
  type DataTableColumn,
} from '@/components/shared/data-table'
import { FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ItemCombobox } from '@/features/catalog'
import { usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { ExportButtons } from '../components/ExportButtons'
import { ExpiryBadge } from '../components/ExpiryBadge'
import { InventoryShell, NativeSelect } from '../components/common'
import { ItemStockDrawer } from '../components/ItemStockDrawer'
import { SavedViewsMenu } from '../components/SavedViewsMenu'
import { WarehouseSelect } from '../components/WarehouseSelect'
import { balanceGroup, balanceParams, INV_PATHS } from '../lib/api'
import { isNegative, useFormatters } from '../lib/format'
import { acceptFilters, anyValue, isTrue, type FilterRules } from '../lib/filters'
import { useInvT } from '../lib/i18n'
import { useBalanceList } from '../lib/queries'
import { STOCK_GROUPINGS, type StockBalance } from '../lib/types'

const VIEW_KEY = 'inventory.stock-status'
/** Filters of the page; `group` is the grouping level, kept with them in the URL and views. */
const FILTER_KEYS = ['warehouse_id', 'item_id', 'include_zero', 'group'] as const
const isGroup = (v: string) =>
  v !== 'warehouse' && (STOCK_GROUPINGS as readonly string[]).includes(v)

const balanceRowId = (b: StockBalance) =>
  [b.item_id, b.warehouse_id, b.location_id ?? '', b.lot_id ?? ''].join(':')

/** Stock status: item x warehouse (or per item / location and lot) balances with cost and value. */
export function StockStatusPage() {
  const t = useInvT()
  const f = useFormatters()
  const canPickItems = usePermission('items.view')
  const [params, setParams] = useSearchParams()
  const { query: urlQuery, setQuery } = useUrlListQuery(
    { sort: [{ id: 'item_code', desc: false }] },
    { viewKey: VIEW_KEY },
  )
  // Only filters the page shows (and can reset) are requested; other URL params are ignored
  // and dropped from the URL on the next change. The item filter needs the item picker.
  const query = useMemo(() => {
    const rules: FilterRules = {
      warehouse_id: anyValue,
      include_zero: isTrue,
      group: isGroup,
      ...(canPickItems ? { item_id: anyValue } : {}),
    }
    return { ...urlQuery, filters: acceptFilters(urlQuery.filters, rules) }
  }, [urlQuery, canPickItems])
  const group = balanceGroup(query)
  const drawerItem = params.get('item')
  const list = useBalanceList(query)

  // The drawer is a history entry: Back closes it.
  const setDrawerItem = (itemId: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (itemId) next.set('item', itemId)
      else next.delete('item')
      return next
    })

  const filter = (key: string) => query.filters[key] ?? ''
  const change = (key: string, value: string) => setQuery(setFilter(query, key, value))
  const filtered = FILTER_KEYS.some((k) => filter(k) !== '') || query.q !== ''

  const applyView = (values: Record<string, string>) => {
    const filters = Object.fromEntries(
      FILTER_KEYS.filter((k) => values[k]).map((k) => [k, values[k] ?? '']),
    )
    setQuery(updateListQuery(query, { q: values.q ?? '', filters }))
  }

  const exportParams = useMemo(() => balanceParams(query, false), [query])
  const columns = useMemo<DataTableColumn<StockBalance>[]>(() => {
    const qty = (key: 'on_hand' | 'reserved' | 'available', label: string) =>
      ({
        id: key,
        header: label,
        enableSorting: true,
        size: 120,
        meta: { label, align: 'right' },
        cell: ({ row }) => {
          const v = row.original[key]
          return (
            <span className={cn('tabular-nums', isNegative(v) && 'font-medium text-danger')}>
              {f.qty(v)}
            </span>
          )
        },
      }) satisfies DataTableColumn<StockBalance>

    const cols: DataTableColumn<StockBalance>[] = [
      {
        id: 'item_code',
        header: t('fields.item'),
        enableSorting: true,
        size: 280,
        enableHiding: false,
        meta: { label: t('fields.item') },
        cell: ({ row }) => (
          <button
            type="button"
            className="max-w-full truncate text-left hover:underline"
            aria-label={t('stock.openItem', { code: row.original.item_code })}
            onClick={() => setDrawerItem(row.original.item_id)}
          >
            <span className="font-code font-medium">{row.original.item_code}</span>{' '}
            <span className="text-muted-foreground">{row.original.item_name}</span>
          </button>
        ),
      },
    ]
    if (group !== 'item') {
      cols.push({
        id: 'warehouse_code',
        header: t('fields.warehouse'),
        enableSorting: true,
        size: 160,
        meta: { label: t('fields.warehouse') },
        cell: ({ row }) => (
          <span title={row.original.warehouse_name ?? undefined}>
            <span className="font-code">{row.original.warehouse_code}</span>{' '}
            <span className="text-muted-foreground">{row.original.warehouse_name}</span>
          </span>
        ),
      })
    }
    if (group === 'detail') {
      cols.push({
        id: 'location',
        header: t('fields.location'),
        size: 140,
        meta: { label: t('fields.location') },
        cell: ({ row }) =>
          row.original.location_code ? (
            <span className="font-code">{row.original.location_code}</span>
          ) : (
            <span className="text-muted-foreground">{t('stock.noLocation')}</span>
          ),
      })
      cols.push(
        {
          id: 'lot',
          header: t('fields.lot'),
          size: 140,
          meta: { label: t('fields.lot') },
          cell: ({ row }) =>
            row.original.lot_no ? (
              <span className="font-code">{row.original.lot_no}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
        },
        {
          id: 'expiry',
          header: t('fields.expiry'),
          size: 200,
          meta: { label: t('fields.expiry') },
          cell: ({ row }) =>
            row.original.lot_id ? <ExpiryBadge expiry={row.original.expiry_date} /> : null,
        },
      )
    }
    cols.push(
      qty('on_hand', t('fields.onHand')),
      qty('reserved', t('fields.reserved')),
      qty('available', t('fields.available')),
      {
        id: 'avg_cost',
        header: t('fields.avgCost'),
        size: 130,
        meta: { label: t('fields.avgCost'), align: 'right' },
        cell: ({ row }) => <span className="tabular-nums">{f.cost(row.original.avg_cost)}</span>,
      },
      {
        id: 'value',
        header: t('fields.value'),
        enableSorting: true,
        size: 140,
        meta: { label: t('fields.value'), align: 'right' },
        cell: ({ row }) => (
          <span className={cn('tabular-nums', isNegative(row.original.value) && 'text-danger')}>
            {f.money(row.original.value)}
          </span>
        ),
      },
    )
    return cols
    // setDrawerItem only writes the URL; columns depend on labels, grouping and locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, group, f])

  return (
    <InventoryShell
      title={t('stock.title')}
      description={t('stock.description')}
      actions={
        <>
          <SavedViewsMenu
            storageKey="stock-status"
            current={{
              ...(query.q ? { q: query.q } : {}),
              ...query.filters,
            }}
            onApply={applyView}
          />
          <ExportButtons path={INV_PATHS.balances} params={exportParams} filename="stok-durumu" />
        </>
      }
    >
      <div
        role="group"
        aria-label={t('common.filters')}
        className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
      >
        <FieldShell label={t('fields.warehouse')} className="w-56">
          {(control) => (
            <WarehouseSelect
              {...control}
              value={filter('warehouse_id')}
              onChange={(v) => change('warehouse_id', v)}
            />
          )}
        </FieldShell>
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
        <FieldShell label={t('stock.groupBy')} className="w-48">
          {(control) => (
            <NativeSelect
              {...control}
              value={group}
              options={STOCK_GROUPINGS.map((g) => ({ value: g, label: t(`stock.groups.${g}`) }))}
              onChange={(e) =>
                change('group', e.target.value === 'warehouse' ? '' : e.target.value)
              }
            />
          )}
        </FieldShell>
        <label className="flex h-control items-center gap-2 text-sm">
          <Checkbox
            checked={filter('include_zero') === 'true'}
            onChange={(e) => change('include_zero', e.target.checked ? 'true' : '')}
          />
          {t('stock.includeZero')}
        </label>
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
        label={t('stock.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.pagination.total ?? 0}
        query={query}
        onQueryChange={setQuery}
        getRowId={balanceRowId}
        loading={list.isFetching}
        error={list.isError}
        onRetry={() => void list.refetch()}
        viewKey={VIEW_KEY}
        onRowActivate={(row) => setDrawerItem(row.item_id)}
      />
      <ItemStockDrawer itemId={drawerItem} onClose={() => setDrawerItem(null)} />
    </InventoryShell>
  )
}
