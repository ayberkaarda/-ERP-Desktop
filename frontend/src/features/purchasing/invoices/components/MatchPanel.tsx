import { Loader2, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { money, percent, qty } from '@/features/sales/invoices/kit/money'
import { useIntlLocale } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { MatchStatusBadge } from '../kit/components/StatusBadges'
import { allowedQuantity, matchCounts, priceOff, quantityOff, type MatchResult } from '../lib/match'
import type { InvoiceLine } from '../types'

interface MatchPanelProps {
  match: MatchResult | null | undefined
  /** Invoice lines for item labels (matched by id). */
  lines: readonly Pick<InvoiceLine, 'id' | 'line_no' | 'item_code' | 'item_name' | 'description'>[]
  loading?: boolean
  /** Shown in the heading (the match of a draft is recomputed on each read). */
  live?: boolean
}

const VARIANCE = 'bg-danger-soft font-medium text-danger-soft-foreground'

/**
 * Three-way match per invoice line: order price vs invoice price and ordered / received /
 * invoiced quantities against the tolerances. Cells beyond a tolerance are highlighted and named
 * for screen readers; the line status shows quantity before price as the server does.
 */
export function MatchPanel({ match, lines, loading = false, live = false }: MatchPanelProps) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  const title = t('match.title')

  if (!match) {
    return (
      <section aria-label={title} className="rounded-lg border border-border bg-surface p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {title}
          {loading && (
            <Loader2
              className="size-4 animate-spin text-muted-foreground"
              aria-label={t('match.loading')}
            />
          )}
        </h2>
        {!loading && <p className="mt-2 text-sm text-muted-foreground">{t('match.none')}</p>}
      </section>
    )
  }

  const counts = matchCounts(match)
  const labelOf = (id: string, lineNo: number | null) => {
    const l = lines.find((x) => x.id === id)
    const text = l ? [l.item_code, l.description ?? l.item_name].filter(Boolean).join(' ') : ''
    return { no: l?.line_no ?? lineNo ?? '', text }
  }
  const th = 'h-row border-b border-border px-2 text-left font-medium whitespace-nowrap'
  const thr = `${th} text-right`
  const td = 'border-b border-border px-2 py-1'
  const tdr = `${td} text-right tabular-nums`
  const flagged = (on: boolean, base: string) => cn(base, on && VARIANCE)

  return (
    <section
      aria-label={title}
      className="space-y-3 rounded-lg border border-border bg-surface p-4"
      data-testid="match-panel"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {match.status && <MatchStatusBadge status={match.status} />}
        <Badge
          tone={match.mode === 'block' ? 'danger' : match.mode === 'warn' ? 'warning' : 'neutral'}
        >
          {t(`match.mode.${match.mode}`)}
        </Badge>
        {live && <span className="text-2xs text-muted-foreground">{t('match.live')}</span>}
        {loading && (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label={t('match.loading')}
          />
        )}
        <span className="ml-auto flex flex-wrap gap-3 text-xs text-muted-foreground">
          {(['matched', 'price_variance', 'qty_variance', 'unmatched'] as const).map((s) =>
            counts[s] > 0 ? (
              <span key={s} data-testid={`match-count-${s}`}>
                {t(`matchStatus.${s}`)}: {counts[s]}
              </span>
            ) : null,
          )}
        </span>
      </div>
      {match.mode === 'off' && (
        <p className="text-xs text-muted-foreground">{t('match.offHint')}</p>
      )}
      {match.override_reason && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs text-warning-soft-foreground"
        >
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t('match.overridden', { reason: match.override_reason })}
        </p>
      )}
      {match.lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('match.noLines')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full border-separate border-spacing-0 text-table"
            aria-label={t('match.table')}
          >
            <thead className="bg-surface-sunken text-xs text-muted-foreground">
              <tr>
                <th className={thr}>#</th>
                <th className={th}>{t('fields.item')}</th>
                <th className={thr}>{t('match.orderPrice')}</th>
                <th className={thr}>{t('match.invoicePrice')}</th>
                <th className={thr}>{t('match.priceDiff')}</th>
                <th className={thr}>{t('match.ordered')}</th>
                <th className={thr}>{t('match.received')}</th>
                <th className={thr}>{t('match.invoiced')}</th>
                <th className={thr}>{t('match.allowed')}</th>
                <th className={th}>{t('fields.status')}</th>
              </tr>
            </thead>
            <tbody>
              {match.lines.map((l) => {
                const { no, text } = labelOf(l.invoice_line_id, l.line_no)
                if (l.reason === 'no_order' || l.order_line_id === null) {
                  return (
                    <tr key={l.invoice_line_id} data-testid={`match-line-${String(no)}`}>
                      <td className={tdr}>{no}</td>
                      <td className={td}>{text}</td>
                      <td className={cn(td, 'text-muted-foreground')} colSpan={7}>
                        {t('match.noOrder')}
                      </td>
                      <td className={td}>
                        <MatchStatusBadge status={l.status} />
                      </td>
                    </tr>
                  )
                }
                const p = priceOff(l)
                const q = quantityOff(l)
                return (
                  <tr key={l.invoice_line_id} data-testid={`match-line-${String(no)}`}>
                    <td className={tdr}>{no}</td>
                    <td className={td}>{text}</td>
                    <td className={tdr}>{money(l.order_price, locale)}</td>
                    <td className={flagged(p, tdr)} data-variance={p ? 'price' : undefined}>
                      {money(l.invoice_price, locale)}
                      {p && <span className="sr-only"> {t('match.priceOff')}</span>}
                    </td>
                    <td className={flagged(p, tdr)}>
                      {percent(l.price_difference_percent, locale)}
                      <span className="block text-2xs text-muted-foreground">
                        {t('match.tolerance', {
                          value: percent(l.price_tolerance_percent ?? '0', locale),
                        })}
                      </span>
                    </td>
                    <td className={tdr}>{qty(l.ordered, locale)}</td>
                    <td className={tdr}>{qty(l.received, locale)}</td>
                    <td className={flagged(q, tdr)} data-variance={q ? 'qty' : undefined}>
                      {qty(l.invoiced, locale)}
                      {q && <span className="sr-only"> {t('match.qtyOff')}</span>}
                    </td>
                    <td className={tdr}>
                      {qty(allowedQuantity(l), locale)}
                      <span className="block text-2xs text-muted-foreground">
                        {t('match.tolerance', {
                          value: percent(l.qty_tolerance_percent ?? '0', locale),
                        })}
                      </span>
                    </td>
                    <td className={td}>
                      <MatchStatusBadge status={l.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
