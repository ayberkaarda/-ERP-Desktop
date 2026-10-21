import { createColumnHelper } from '@tanstack/react-table'
import { FilterX, Unlock } from 'lucide-react'
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
import { WarehouseSelect } from '../../documents/components/pickers'
import { PresetsMenu } from '../../documents/components/PresetsMenu'
import { useReservationList } from '../../documents/hooks/queries'
import { trimDecimal } from '../../documents/lib/quantity'
import { INV_PERMS } from '../../documents/permissions'
import { RESERVATION_STATUSES, type StockReservation } from '../../documents/types'
import { ReleaseDialog } from '../components/ReleaseDialog'

const VIEW_KEY = 'inventory.reservations'
const FILTERS = ['status', 'warehouse_id', 'item_id'] as const
const PRESET_KEYS = ['q', ...FILTERS] as const

/** Stock reservations by status, warehouse and item; active ones can be released. */
export function ReservationListPage() {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const canManage = usePermission(INV_PERMS.reservationsManage)
  const [releasing, setReleasing] = useState<StockReservation | null>(null)
  const { query, setQuery } = useUrlListQuery(
    { sort: [{ id: 'created_at', desc: true }], filters: { status: 'active' } },
    { viewKey: VIEW_KEY },
  )
  const list = useReservationList(query)
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
      col.accessor('item_code', {
        header: t('fields.item'),
        enableSorting: true,
        meta: { label: t('fields.item') },
        size: 260,
        cell: (c) => (
          <span>
            <span className="font-code">{c.getValue()}</span> {c.row.original.item_name}
          </span>
        ),
      }),
      col.accessor('warehouse_code', {
        header: t('fields.warehouse'),
        meta: { label: t('fields.warehouse') },
        size: 120,
        cell: (c) => c.getValue() ?? '',
      }),
      col.accessor('lot_no', {
        header: t('reservation.lot'),
        meta: { label: t('reservation.lot') },
        size: 120,
        cell: (c) => <span className="font-code">{c.getValue() ?? ''}</span>,
      }),
      col.accessor('quantity', {
        header: t('reservation.quantity'),
        enableSorting: true,
        meta: { label: t('reservation.quantity'), align: 'right' },
        size: 120,
        cell: (c) => (
          <span className="tabular-nums">
            {qty(c.getValue())} {c.row.original.unit_code ?? ''}
          </span>
        ),
      }),
      col.accessor('source_label', {
        header: t('reservation.source'),
        meta: { label: t('reservation.source') },
        size: 180,
        cell: (c) => c.getValue() ?? c.row.original.source_type ?? '',
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
              aria-label={`${t('reservation.release')}: ${c.row.original.item_code ?? ''}`}
              onClick={() => setReleasing(c.row.original)}
            >
              <Unlock aria-hidden="true" />
              {t('reservation.release')}
            </Button>
          ) : null,
      }),
    ]
    // qty/statusLabel derive from t and locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, locale, canManage])

  const filtered = FILTERS.some((k) => f(k) !== '') || query.q !== ''

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('reservation.title')}
        description={t('reservation.description')}
        breadcrumbs={[{ label: t('nav.inventory') }, { label: t('reservation.title') }]}
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
        data={list.data?.data ?? []}
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
      <ReleaseDialog reservation={releasing} onClose={() => setReleasing(null)} />
    </div>
  )
}
