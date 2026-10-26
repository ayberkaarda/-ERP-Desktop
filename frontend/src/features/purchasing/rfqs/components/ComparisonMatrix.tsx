import { Clock, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay, formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { lineName, trimDecimal } from '../../shared/lib/forms'
import { TABLE } from '../../shared/lib/ui'
import type { RfqComparison, RfqLine } from '../../shared/types'

interface ComparisonMatrixProps {
  comparison: RfqComparison
  /** RFQ lines for item labels and units (the comparison sends ids only). */
  lines: readonly RfqLine[]
  /** Per-line award picks (rfq line id -> party id); radio buttons appear when set. */
  picks?: Record<string, string>
  onPick?: (rfqLineId: string, partyId: string) => void
}

/**
 * Lines x suppliers: net unit price, line total and lead time per quote; the lowest price and the
 * fastest delivery of a line are marked, the cheapest complete supplier in the totals row.
 */
export function ComparisonMatrix({ comparison, lines, picks, onPick }: ComparisonMatrixProps) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const money = (v: string) => formatMoney(v, comparison.currency_code, locale)
  const qty = (v: string) =>
    formatDecimalDisplay(trimDecimal(v), { locale, minFraction: 0, maxFraction: 6 })
  const suppliers = comparison.suppliers
  const { th, thr, td, tdr } = TABLE
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table
        aria-label={t('rfqs.comparison.title')}
        className="w-full border-separate border-spacing-0 text-table"
      >
        <thead className="bg-surface-sunken text-muted-foreground">
          <tr>
            <th scope="col" className={th}>
              {t('lines.item')}
            </th>
            <th scope="col" className={thr}>
              {t('lines.quantity')}
            </th>
            {suppliers.map((s) => (
              <th key={s.party_id} scope="col" className={thr}>
                {s.party_name}
                <span className="block text-2xs font-normal">
                  {t(`rfqs.supplierStatus.${s.status}`)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.lines.map((cl) => {
            const line = lines.find((l) => l.id === cl.rfq_line_id)
            const name = line ? lineName(line) : (cl.description ?? '')
            return (
              <tr key={cl.rfq_line_id}>
                <th scope="row" className={cn(td, 'text-left font-normal')}>
                  {name}
                  {cl.awarded_party_id && (
                    <span className="block text-2xs text-success">
                      {t('rfqs.comparison.awardedTo', {
                        supplier:
                          suppliers.find((s) => s.party_id === cl.awarded_party_id)?.party_name ??
                          '',
                      })}
                    </span>
                  )}
                </th>
                <td className={tdr}>
                  {qty(cl.quantity)} {line?.unit_code ?? ''}
                </td>
                {suppliers.map((s) => {
                  const q = cl.quotes.find((x) => x.party_id === s.party_id)
                  if (!q)
                    return (
                      <td key={s.party_id} className={cn(tdr, 'text-muted-foreground')}>
                        {t('rfqs.comparison.noQuote')}
                      </td>
                    )
                  const picked = picks?.[cl.rfq_line_id] === s.party_id
                  return (
                    <td
                      key={s.party_id}
                      data-testid={`cell-${cl.rfq_line_id}-${s.party_id}`}
                      className={cn(
                        tdr,
                        q.lowest_price && 'bg-success-soft',
                        picked && 'ring-2 ring-primary ring-inset',
                      )}
                    >
                      {picks && onPick ? (
                        <label className="flex cursor-pointer items-center justify-end gap-2">
                          <input
                            type="radio"
                            name={`award-${cl.rfq_line_id}`}
                            checked={picked}
                            aria-label={t('rfqs.award.pickFor', {
                              item: name,
                              supplier: s.party_name,
                            })}
                            onChange={() => onPick(cl.rfq_line_id, s.party_id)}
                          />
                          <span>{money(q.net_unit_price)}</span>
                        </label>
                      ) : (
                        <span>{money(q.net_unit_price)}</span>
                      )}
                      <span className="block text-2xs text-muted-foreground">
                        {money(q.line_total)}
                        {q.lead_time_days !== null &&
                          ` · ${t('rfqs.comparison.days', { count: q.lead_time_days })}`}
                      </span>
                      <span className="flex justify-end gap-1 text-2xs">
                        {q.lowest_price && (
                          <span className="inline-flex items-center gap-0.5 text-success">
                            <Trophy className="size-3" aria-hidden="true" />
                            {t('rfqs.comparison.lowest')}
                          </span>
                        )}
                        {q.fastest && (
                          <span className="inline-flex items-center gap-0.5 text-info">
                            <Clock className="size-3" aria-hidden="true" />
                            {t('rfqs.comparison.fastest')}
                          </span>
                        )}
                      </span>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2} className={cn(td, 'text-left font-semibold')}>
              {t('rfqs.comparison.total')}
            </th>
            {suppliers.map((s) => (
              <td
                key={s.party_id}
                data-testid={`total-${s.party_id}`}
                className={cn(
                  tdr,
                  'font-semibold',
                  comparison.lowest_total_party_id === s.party_id && 'bg-success-soft',
                )}
              >
                {s.total === null ? '—' : money(s.total)}
                <span className="block text-2xs font-normal text-muted-foreground">
                  {s.complete
                    ? t('rfqs.comparison.complete')
                    : t('rfqs.comparison.partial', {
                        quoted: s.lines_quoted,
                        total: comparison.lines.length,
                      })}
                </span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
