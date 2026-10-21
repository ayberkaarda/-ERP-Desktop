import { useQuery } from '@tanstack/react-query'
import { createColumnHelper } from '@tanstack/react-table'
import { FilterX, Plus, Unlock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DataTable,
  setFilter,
  updateListQuery,
  useUrlListQuery,
  type ListQueryState,
} from '@/components/shared/data-table'
import { FieldShell } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { ItemCombobox } from '@/features/catalog'
import { lookupsApi } from '../../documents/api/client'
import { invDocsKeys } from '../../documents/api/keys'
import { WarehouseSelect } from '../../documents/components/pickers'
import { PresetsMenu } from '../../documents/components/PresetsMenu'
import { useItemsById, useReservationList, useUnits } from '../../documents/hooks/queries'
import { trimDecimal } from '../../documents/lib/quantity'
import { INV_PERMS } from '../../documents/permissions'
import { RESERVATION_STATUSES, type StockReservation } from '../../documents/types'
import { useStockWarehouses } from '../../shared/warehouses'
import { CreateReservationDialog } from '../components/CreateReservationDialog'
import { ReleaseDialog } from '../components/ReleaseDialog'

const VIEW_KEY = 'inventory.reservations'
const FILTERS = ['status', 'warehouse_id', 'item_id'] as const
const PRESET_KEYS = ['q', ...FILTERS] as const

/** Stock reservations by status, warehouse and item; active ones can be released. */
export function ReservationListPage() {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const canManage = usePermission(INV_PERMS.reservationsManage)
  const canReadLots = usePermission(INV_PERMS.stockView)
  const [releasing, setReleasing] = useState<StockReservation | null>(null)
  const [creating, setCreating] = useState(false)
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'created_at', desc: true }], filters: { status: 'active' } },
    { viewKey: VIEW_KEY },
  )
  const list = useReservationList(query)
  const rows = list.data?.data ?? []
  // The API returns ids: labels come from Catalog items, units, warehouses and lots.
  const items = useItemsById(rows.map((r) => r.item_id)).data
  const units = useUnits().data
  const warehouses = useStockWarehouses().data
  const lotIds = [...new Set(rows.flatMap((r) => (r.lot_id ? [r.lot_id] : [])))].sort()
  const lots = useQuery({
    queryKey: [...invDocsKeys.reservations(), 'lots', lotIds],
    queryFn: async ({ signal }) =>
      new Map(
        (
          await Promise.all(lotIds.map((id) => lookupsApi.lot(id, signal).catch(() => null)))
        ).flatMap((l) => (l ? [[l.id, l.lot_no] as const] : [])),
      ),
    enabled: canReadLots && lotIds.length > 0,
    staleTime: 60_000,
  }).data
  const itemLabel = (r: StockReservation) => {
    const item = items?.get(r.item_id)
    return item ? `${item.code} · ${item.name}` : ''
  }
  const unitCode = (r: StockReservation) => {
    const item = items?.get(r.item_id)
    return item?.base_unit?.code ?? units?.find((u) => u.id === item?.base_unit_id)?.code ?? ''
  }
  const f = (key: string) => query.filters[key] ?? ''
  const change = (key: string, value: string) => setQuery(setFilter(query, key, value))
  const qty = (v: string) =>
    formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 6 })

  const statusLabel: Record<StockReservation['status'], string> = {
    active: t('reservation.statusActive'),
    released: t('reservation.statusReleased'),
    consumed: t('reservation.statusConsumed'),
    expired: t('reservation.statusExpired'),
  }

  const applyPreset = (params: Record<string, string>) => {
    let next: ListQueryState = updateListQuery(query, { q: params.q ?? '', filters: {} })
    for (const key of FILTERS) if (params[key]) next = setFilter(next, key, params[key])
    setQuery(next)
  }

  const columns = useMemo(() => {
    const col = createColumnHelper<StockReservation>()
    return [
      col.accessor('item_id', {
        header: t('fields.item'),
        meta: { label: t('fields.item') },
        size: 260,
        cell: (c) => {
          const item = items?.get(c.getValue())
          return item ? (
            <span>
              <span className="font-code">{item.code}</span> {item.name}
            </span>
          ) : null
        },
      }),
      col.accessor('warehouse_id', {
        header: t('fields.warehouse'),
        meta: { label: t('fields.warehouse') },
        size: 120,
        cell: (c) => warehouses?.find((w) => w.id === c.getValue())?.code ?? '',
      }),
      col.accessor('lot_id', {
        header: t('reservation.lot'),
        meta: { label: t('reservation.lot') },
        size: 120,
        cell: (c) => {
          const id = c.getValue()
          return <span className="font-code">{id ? (lots?.get(id) ?? '') : ''}</span>
        },
      }),
      col.accessor('quantity', {
        header: t('reservation.quantity'),
        enableSorting: true,
        meta: { label: t('reservation.quantity'), align: 'right' },
        size: 120,
        cell: (c) => (
          <span className="tabular-nums">
            {qty(c.getValue())} {unitCode(c.row.original)}
          </span>
        ),
      }),
      col.accessor('source_type', {
        header: t('reservation.source'),
        meta: { label: t('reservation.source') },
        size: 160,
        cell: (c) => c.getValue() ?? t('reservation.manual'),
      }),
      col.accessor('notes', {
        header: t('fields.notes'),
        meta: { label: t('fields.notes') },
        size: 200,
        cell: (c) => c.getValue() ?? '',
      }),
      col.accessor('expires_at', {
        header: t('reservation.expiresAt'),
        enableSorting: true,
        meta: { label: t('reservation.expiresAt') },
        size: 150,
        cell: (c) => {
          const v = c.getValue()
          return v ? formatDateTime(v, locale) : t('reservation.noExpiry')
        },
      }),
      col.accessor('created_at', {
        header: t('reservation.createdAt'),
        enableSorting: true,
        meta: { label: t('reservation.createdAt') },
        size: 120,
        cell: (c) => {
          const v = c.getValue()
          return v ? formatDate(v, locale) : ''
        },
      }),
      col.accessor('status', {
        header: t('fields.status'),
        meta: {
          label: t('fields.status'),
          filter: {
            key: 'status',
            options: RESERVATION_STATUSES.map((v) => ({ value: v, label: statusLabel[v] })),
          },
        },
        size: 120,
        cell: (c) => (
          <StatusBadge
            status={c.getValue()}
            definitions={{
              active: { tone: 'primary', label: statusLabel.active },
              released: { tone: 'neutral', label: statusLabel.released },
              consumed: { tone: 'success', label: statusLabel.consumed },
              expired: { tone: 'warning', label: statusLabel.expired },
            }}
          />
        ),
      }),
      col.display({
        id: 'actions',
        header: () => <span className="sr-only">{t('reservation.release')}</span>,
        size: 140,
        enableHiding: false,
        cell: (c) =>
          canManage && c.row.original.status === 'active' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${t('reservation.release')}: ${items?.get(c.row.original.item_id)?.code ?? ''}`}
              onClick={() => setReleasing(c.row.original)}
            >
              <Unlock aria-hidden="true" />
              {t('reservation.release')}
            </Button>
          ) : null,
      }),
    ]
    // qty/statusLabel/unitCode derive from t, locale and the lookups listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, locale, canManage, items, units, warehouses, lots])

  const filtered = FILTERS.some((k) => f(k) !== '') || query.q !== ''

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('reservation.title')}
        description={t('reservation.description')}
        breadcrumbs={[{ label: t('nav.inventory') }, { label: t('reservation.title') }]}
        actions={
          canManage ? (
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t('reservation.new')}
            </Button>
          ) : undefined
        }
      />
      <section
        aria-label={t('list.filters')}
        className="mb-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3"
      >
        <FieldShell label={t('filters.warehouse')} className="w-56">
          {(control) => (
            <WarehouseSelect
              {...control}
              clearable
              value={f('warehouse_id')}
              onChange={(v) => change('warehouse_id', v)}
            />
          )}
        </FieldShell>
        <FieldShell label={t('filters.item')} className="w-64">
          {(control) => (
            <ItemCombobox
              {...control}
              value={f('item_id') || null}
              onChange={(id) => change('item_id', id ?? '')}
            />
          )}
        </FieldShell>
        <div className="ml-auto flex items-center gap-2">
          {filtered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setQuery(updateListQuery(query, { q: '', filters: {} }))}
            >
              <FilterX aria-hidden="true" />
              {t('filters.clear')}
            </Button>
          )}
          <PresetsMenu
            storageKey={VIEW_KEY}
            allowed={PRESET_KEYS}
            title={t('presets.views')}
            current={{ q: query.q, ...query.filters }}
            onApply={applyPreset}
          />
        </div>
      </section>
      <DataTable<StockReservation>
        label={t('reservation.title')}
        columns={columns}
        data={rows}
        total={list.data?.meta.pagination.total ?? 0}
        loading={list.isPending}
        error={list.isError}
        onRetry={() => void list.refetch()}
        query={query}
        onQueryChange={setQuery}
        getRowId={(r) => r.id}
        viewKey={VIEW_KEY}
        enableColumnResizing
      />
      <ReleaseDialog
        reservation={releasing}
        itemLabel={releasing ? itemLabel(releasing) : ''}
        quantityLabel={releasing ? `${qty(releasing.quantity)} ${unitCode(releasing)}`.trim() : ''}
        onClose={() => setReleasing(null)}
      />
      {canManage && <CreateReservationDialog open={creating} onOpenChange={setCreating} />}
    </div>
  )
}
