import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { movementsApi } from '../lib/api'
import { isNegative, useFormatters } from '../lib/format'
import { useInvT } from '../lib/i18n'
import { useInvKeys } from '../lib/keys'
import { lotPath } from '../lib/navigation'
import { INV_PERMISSIONS } from '../lib/permissions'
import { useItemStock } from '../lib/queries'
import { useWarehouseLookup } from '../lib/warehouseLookup'
import { LoadError } from './common'
import { Drawer } from './Drawer'
import { ExpiryBadge } from './ExpiryBadge'

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn('text-base font-semibold tabular-nums', tone === 'danger' && 'text-danger')}
      >
        {value}
      </dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
}

const th = 'px-2 py-1.5 text-left font-medium'
const thNum = 'px-2 py-1.5 text-right font-medium'
const td = 'px-2 py-1.5'
const tdNum = 'px-2 py-1.5 text-right tabular-nums'

interface ItemStockDrawerProps {
  itemId: string | null
  onClose: () => void
}

/** Stock of one item: totals, per warehouse, lots with expiry, and the latest movements. */
export function ItemStockDrawer({ itemId, onClose }: ItemStockDrawerProps) {
  const t = useInvT()
  const f = useFormatters()
  const keys = useInvKeys()
  const stock = useItemStock(itemId)
  const warehouseOf = useWarehouseLookup()
  const canSeeStock = usePermission(INV_PERMISSIONS.stock.view)
  const recent = useQuery({
    queryKey: keys.movementList({ item_id: itemId ?? '', limit: '10' }),
    queryFn: ({ signal }) => movementsApi.page({ item_id: itemId ?? '' }, null, 10, signal),
    enabled: Boolean(itemId) && canSeeStock,
  })
  const data = stock.data
  const title = data ? `${data.item_code} · ${data.item_name}` : t('drawer.title')

  return (
    <Drawer
      open={itemId !== null}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={t('drawer.description')}
    >
      {stock.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : stock.isError ? (
        <LoadError error={stock.error} onRetry={() => void stock.refetch()} />
      ) : !data ? null : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Figure
              label={t('fields.onHand')}
              value={f.qty(data.on_hand)}
              tone={isNegative(data.on_hand) ? 'danger' : undefined}
            />
            <Figure label={t('fields.reserved')} value={f.qty(data.reserved)} />
            <Figure
              label={t('fields.available')}
              value={f.qty(data.available)}
              tone={isNegative(data.available) ? 'danger' : undefined}
            />
            <Figure label={t('fields.avgCost')} value={f.cost(data.avg_cost)} />
            <Figure label={t('fields.value')} value={f.money(data.value)} />
          </dl>

          <Section title={t('drawer.byWarehouse')}>
            {data.warehouses.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('drawer.noStock')}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-table" aria-label={t('drawer.byWarehouse')}>
                  <thead className="bg-surface-sunken text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className={th}>
                        {t('fields.warehouse')}
                      </th>
                      <th scope="col" className={thNum}>
                        {t('fields.onHand')}
                      </th>
                      <th scope="col" className={thNum}>
                        {t('fields.reserved')}
                      </th>
                      <th scope="col" className={thNum}>
                        {t('fields.available')}
                      </th>
                      <th scope="col" className={thNum}>
                        {t('fields.value')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.warehouses.map((w) => (
                      <tr key={w.warehouse_id} className="border-t border-border">
                        <th scope="row" className={cn(td, 'text-left font-normal')}>
                          <span className="font-code">{w.warehouse_code}</span> {w.warehouse_name}
                        </th>
                        <td className={cn(tdNum, isNegative(w.on_hand) && 'text-danger')}>
                          {f.qty(w.on_hand)}
                        </td>
                        <td className={tdNum}>{f.qty(w.reserved)}</td>
                        <td className={cn(tdNum, isNegative(w.available) && 'text-danger')}>
                          {f.qty(w.available)}
                        </td>
                        <td className={tdNum}>{f.money(w.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {data.lots.length > 0 && (
            <Section title={t('drawer.lots')}>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-table" aria-label={t('drawer.lots')}>
                  <thead className="bg-surface-sunken text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className={th}>
                        {t('fields.lot')}
                      </th>
                      <th scope="col" className={th}>
                        {t('fields.expiry')}
                      </th>
                      <th scope="col" className={thNum}>
                        {t('fields.onHand')}
                      </th>
                      <th scope="col" className={thNum}>
                        {t('fields.available')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lots.map((l) => (
                      <tr key={l.lot_id} className="border-t border-border">
                        <th scope="row" className={cn(td, 'text-left font-normal')}>
                          <Link to={lotPath(l.lot_id)} className="font-code hover:underline">
                            {l.lot_no}
                          </Link>
                        </th>
                        <td className={td}>
                          <ExpiryBadge expiry={l.expiry_date} />
                        </td>
                        <td className={tdNum}>{f.qty(l.on_hand)}</td>
                        <td className={cn(tdNum, isNegative(l.available) && 'text-danger')}>
                          {f.qty(l.available)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section title={t('drawer.recent')}>
            {recent.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : recent.isError ? (
              <LoadError error={recent.error} onRetry={() => void recent.refetch()} />
            ) : recent.data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('drawer.noMovements')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {recent.data.rows.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-32 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {formatDate(m.occurred_at, f.locale)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {t(`movementTypes.${m.movement_type}`)} ·{' '}
                      {warehouseOf(m.warehouse_id)?.code ?? ''}
                    </span>
                    <span
                      className={cn(
                        'tabular-nums',
                        m.direction === 'in' ? 'text-success' : 'text-danger',
                      )}
                    >
                      {m.direction === 'in' ? '+' : '−'}
                      {f.qty(m.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to={`/inventory/movements?filter[item_id]=${encodeURIComponent(itemId ?? '')}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t('drawer.allMovements')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Section>
        </div>
      )}
    </Drawer>
  )
}
