import { useMemo } from 'react'
import { Link } from 'react-router'
import {
  DataTable,
  setFilter,
  updateListQuery,
  useUrlListQuery,
  type DataTableColumn,
} from '@/components/shared/data-table'
import { DateInput, FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ItemCombobox } from '@/features/catalog'
import { formatDate } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { ExpiryBadge } from '../../stock/components/ExpiryBadge'
import { InventoryShell } from '../../stock/components/common'
import { SavedViewsMenu } from '../../stock/components/SavedViewsMenu'
import { EXPIRY_WARNING_DAYS } from '../../stock/lib/expiry'
import { useFormatters } from '../../stock/lib/format'
import { acceptFilters, anyValue, isTrue } from '../../stock/lib/filters'
import { useInvT } from '../../stock/lib/i18n'
import { itemStockPath, lotPath } from '../../stock/lib/navigation'
import { useLotList } from '../../stock/lib/queries'
import type { StockLot } from '../../stock/lib/types'

const VIEW_KEY = 'inventory.lots'
/** Filters of TraceController::lots. */
const FILTER_KEYS = ['item_id', 'expires_before', 'expired', 'with_stock'] as const
const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Lots with expiry state; each opens its trace (where it came in and went out). */
export function LotsPage() {
  const t = useInvT()
  const f = useFormatters()
  const canPickItems = usePermission('items.view')
  const { query: urlQuery, setQuery } = useUrlListQuery(
    { sort: [{ id: 'expiry_date', desc: false }] },
    { viewKey: VIEW_KEY },
  )
  // Only filters with a control on this page are requested (the item filter needs the picker).
  const query = useMemo(
    () => ({
      ...urlQuery,
      filters: acceptFilters(urlQuery.filters, {
        expires_before: isIsoDate,
        expired: isTrue,
        with_stock: isTrue,
        ...(canPickItems ? { item_id: anyValue } : {}),
      }),
    }),
    [urlQuery, canPickItems],
  )
  const list = useLotList(query)
  const filter = (key: string) => query.filters[key] ?? ''
  const change = (key: string, value: string) => setQuery(setFilter(query, key, value))
  const filtered = FILTER_KEYS.some((k) => filter(k) !== '') || query.q !== ''

  const columns = useMemo<DataTableColumn<StockLot>[]>(
    () => [
      {
        id: 'lot_no',
        header: t('fields.lot'),
        enableSorting: true,
        enableHiding: false,
        size: 160,
        meta: { label: t('fields.lot') },
        cell: ({ row }) => (
          <Link to={lotPath(row.original.id)} className="font-code font-medium hover:underline">
            {row.original.lot_no}
          </Link>
        ),
      },
      {
        id: 'item_code',
        header: t('fields.item'),
        size: 280,
        meta: { label: t('fields.item') },
        cell: ({ row }) => (
          <Link to={itemStockPath(row.original.item_id)} className="hover:underline">
            <span className="font-code">{row.original.item_code}</span>{' '}
            <span className="text-muted-foreground">{row.original.item_name}</span>
          </Link>
        ),
      },
      {
        id: 'expiry_date',
        header: t('fields.expiry'),
        enableSorting: true,
        size: 220,
        meta: { label: t('fields.expiry') },
        cell: ({ row }) => <ExpiryBadge expiry={row.original.expiry_date} />,
      },
      {
        id: 'manufacture_date',
        header: t('fields.manufactureDate'),
        size: 130,
        meta: { label: t('fields.manufactureDate') },
        cell: ({ row }) =>
          row.original.manufacture_date ? (
            <span className="tabular-nums">
              {formatDate(row.original.manufacture_date, f.locale)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: 'on_hand',
        header: t('fields.onHand'),
        enableSorting: true,
        size: 120,
        meta: { label: t('fields.onHand'), align: 'right' },
        cell: ({ row }) => <span className="tabular-nums">{f.qty(row.original.on_hand)}</span>,
      },
      {
        id: 'created_at',
        header: t('fields.receivedAt'),
        enableSorting: true,
        size: 130,
        meta: { label: t('fields.receivedAt') },
        cell: ({ row }) =>
          row.original.created_at ? (
            <span className="tabular-nums">{formatDate(row.original.created_at, f.locale)}</span>
          ) : null,
      },
    ],
    [t, f],
  )

  return (
    <InventoryShell
      title={t('lots.title')}
      description={t('lots.description', { days: EXPIRY_WARNING_DAYS })}
      actions={
        <>
          <SavedViewsMenu
            storageKey="lots"
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
        <FieldShell label={t('lots.expiresBefore')} className="w-44">
          {(control) => (
            <DateInput
              {...control}
              value={urlQuery.filters.expires_before ?? ''}
              onChange={(v) => change('expires_before', v)}
            />
          )}
        </FieldShell>
        <label className="flex h-control items-center gap-2 text-sm">
          <Checkbox
            checked={filter('expired') === 'true'}
            onChange={(e) => change('expired', e.target.checked ? 'true' : '')}
          />
          {t('lots.onlyExpired')}
        </label>
        <label className="flex h-control items-center gap-2 text-sm">
          <Checkbox
            checked={filter('with_stock') === 'true'}
            onChange={(e) => change('with_stock', e.target.checked ? 'true' : '')}
          />
          {t('lots.onlyInStock')}
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
        label={t('lots.title')}
        columns={columns}
        data={list.data?.data ?? []}
        total={list.data?.meta.pagination.total ?? 0}
        query={query}
        onQueryChange={setQuery}
        getRowId={(l) => l.id}
        loading={list.isFetching}
        error={list.isError}
        onRetry={() => void list.refetch()}
        viewKey={VIEW_KEY}
      />
    </InventoryShell>
  )
}
