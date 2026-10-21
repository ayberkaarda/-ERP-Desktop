import Decimal from 'decimal.js'
import { ArrowRight } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { isApiError } from '@/platform'
import { ExpiryBadge } from '../../stock/components/ExpiryBadge'
import { InventoryShell, LoadError } from '../../stock/components/common'
import { isNegative, useFormatters } from '../../stock/lib/format'
import { useInvT } from '../../stock/lib/i18n'
import { itemStockPath } from '../../stock/lib/navigation'
import { useLotTrace } from '../../stock/lib/queries'
import { useWarehouseLookup } from '../../stock/lib/warehouseLookup'
import type { LotTraceSummary } from '../../stock/lib/types'
import { MovementsTable } from '../../movements/components/MovementsTable'

/** Received and issued over all warehouses (decimal strings, summed without floats). */
function totals(summary: readonly LotTraceSummary[]): { received: string; issued: string } {
  let received = new Decimal(0)
  let issued = new Decimal(0)
  for (const s of summary) {
    received = received.plus(s.received)
    issued = issued.plus(s.issued)
  }
  return { received: received.toFixed(6), issued: issued.toFixed(6) }
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

/** Traceability of one lot: where it was received, where it went, where it is now. */
export function LotTracePage() {
  const t = useInvT()
  const f = useFormatters()
  const { id = '' } = useParams()
  const trace = useLotTrace(id)
  const warehouseOf = useWarehouseLookup()
  const lot = trace.data?.lot
  const sums = useMemo(() => totals(trace.data?.summary ?? []), [trace.data])
  // Where the lot is now: warehouses with a non-zero balance.
  const where = useMemo(
    () => (trace.data?.summary ?? []).filter((s) => !new Decimal(s.on_hand).isZero()),
    [trace.data],
  )
  const breadcrumbs = [
    { label: t('common.nav.title') },
    { label: t('lots.title'), to: '/inventory/lots' },
    { label: lot?.lot_no ?? t('trace.title') },
  ]

  if (trace.isError && isApiError(trace.error) && trace.error.status === 404) {
    return (
      <InventoryShell title={t('trace.title')} breadcrumbs={breadcrumbs}>
        <EmptyState title={t('trace.notFound')} />
      </InventoryShell>
    )
  }

  return (
    <InventoryShell
      title={lot ? t('trace.titleFor', { lot: lot.lot_no }) : t('trace.title')}
      description={
        lot ? (
          <Link to={itemStockPath(lot.item_id)} className="hover:underline">
            <span className="font-code">{lot.item_code}</span> {lot.item_name}
          </Link>
        ) : undefined
      }
      meta={lot ? <ExpiryBadge expiry={lot.expiry_date} /> : undefined}
      breadcrumbs={breadcrumbs}
    >
      {trace.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : trace.isError ? (
        <LoadError error={trace.error} onRetry={() => void trace.refetch()} />
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Figure label={t('trace.received')} value={f.qty(sums.received)} />
            <Figure label={t('trace.issued')} value={f.qty(sums.issued)} />
            <Figure label={t('fields.onHand')} value={f.qty(trace.data.lot.on_hand)} />
            <Figure
              label={t('fields.manufactureDate')}
              value={
                trace.data.lot.manufacture_date
                  ? formatDate(trace.data.lot.manufacture_date, f.locale)
                  : '—'
              }
            />
          </dl>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('trace.whereNow')}</h2>
            {where.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('trace.noBalance')}</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border bg-surface">
                <table className="w-full text-table" aria-label={t('trace.whereNow')}>
                  <thead className="bg-surface-sunken text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-2 py-1.5 text-left font-medium">
                        {t('fields.warehouse')}
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        {t('trace.received')}
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        {t('trace.issued')}
                      </th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">
                        {t('fields.onHand')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {where.map((b) => (
                      <tr key={b.warehouse_id} className="border-t border-border">
                        <th scope="row" className="px-2 py-1.5 text-left font-normal">
                          <span className="font-code">
                            {warehouseOf(b.warehouse_id)?.code ?? b.warehouse_id}
                          </span>{' '}
                          {warehouseOf(b.warehouse_id)?.name}
                        </th>
                        <td className="px-2 py-1.5 text-right tabular-nums">{f.qty(b.received)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{f.qty(b.issued)}</td>
                        <td
                          className={cn(
                            'px-2 py-1.5 text-right tabular-nums',
                            isNegative(b.on_hand) && 'text-danger',
                          )}
                        >
                          {f.qty(b.on_hand)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('trace.history')}</h2>
            {trace.data.movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('trace.noMovements')}</p>
            ) : (
              <MovementsTable
                label={t('trace.history')}
                rows={trace.data.movements}
                hideItem
                maxHeight="60vh"
              />
            )}
            <Link
              to={`/inventory/movements?filter[lot_id]=${encodeURIComponent(id)}`}
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              {t('trace.inLedger')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </section>
        </div>
      )}
    </InventoryShell>
  )
}
