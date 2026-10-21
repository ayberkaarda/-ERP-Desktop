import { AlertTriangle, Info, Loader2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay, formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { dec, trimDecimal } from '../lib/lines'
import type { SalesWarning, TaxBreakdownRow } from '../types'

export interface TotalsFigures {
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  total_local: string
  fx_rate: string
  tax_breakdown?: TaxBreakdownRow[]
}

interface TotalsPanelProps {
  totals: TotalsFigures | null
  currency: string
  localCurrency?: string | null
  /** Figures are behind the form (debounce or request in flight). */
  pending?: boolean
  error?: boolean
  onRetry?: () => void
  className?: string
}

/** Server-calculated totals; while the server recalculates the last figures stay, marked. */
export function TotalsPanel({
  totals,
  currency,
  localCurrency,
  pending = false,
  error = false,
  onRetry,
  className,
}: TotalsPanelProps) {
  const { t } = useTranslation('sales-shared')
  const locale = useIntlLocale()
  const money = (v: string, c = currency) => formatMoney(v, c, locale)
  const foreign = Boolean(localCurrency && localCurrency !== currency)

  return (
    <section
      aria-label={t('totals.title')}
      aria-busy={pending}
      data-testid="totals"
      className={cn('space-y-2 rounded-lg border border-border bg-surface p-4 text-sm', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('totals.title')}</h2>
        {pending && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            {t('totals.calculating')}
          </span>
        )}
      </div>
      {error && (
        <div role="alert" className="flex items-center gap-2 text-xs text-danger">
          <AlertTriangle className="size-3.5" aria-hidden="true" />
          <span className="flex-1">{t('totals.failed')}</span>
          {onRetry && (
            <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              {t('actions.retry')}
            </Button>
          )}
        </div>
      )}
      {totals === null ? (
        <p className="text-xs text-muted-foreground">{t('totals.empty')}</p>
      ) : (
        <dl className={cn('grid grid-cols-[1fr_auto] gap-x-4 gap-y-1', pending && 'opacity-70')}>
          <dt className="text-muted-foreground">{t('totals.subtotal')}</dt>
          <dd className="text-right tabular-nums">{money(totals.subtotal)}</dd>
          {!dec(totals.discount_total).isZero() && (
            <>
              <dt className="text-muted-foreground">{t('totals.discount')}</dt>
              <dd className="text-right tabular-nums">−{money(totals.discount_total)}</dd>
            </>
          )}
          {(totals.tax_breakdown ?? []).map((row) => (
            <TaxRow key={`${row.tax_code_id ?? 'none'}-${row.rate}`} row={row} money={money} />
          ))}
          <dt className="text-muted-foreground">{t('totals.tax')}</dt>
          <dd className="text-right tabular-nums">{money(totals.tax_total)}</dd>
          <dt className="border-t border-border pt-1 font-semibold">{t('totals.total')}</dt>
          <dd className="border-t border-border pt-1 text-right font-semibold tabular-nums">
            {money(totals.total)}
          </dd>
          {foreign && localCurrency && (
            <>
              <dt className="text-xs text-muted-foreground">
                {t('totals.local', {
                  rate: formatDecimalDisplay(trimDecimal(totals.fx_rate), {
                    locale,
                    minFraction: 0,
                    maxFraction: 6,
                  }),
                })}
              </dt>
              <dd className="text-right text-xs tabular-nums">
                {money(totals.total_local, localCurrency)}
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  )
}

function TaxRow({ row, money }: { row: TaxBreakdownRow; money: (v: string) => string }) {
  const { t } = useTranslation('sales-shared')
  const locale = useIntlLocale()
  const rate = formatDecimalDisplay(trimDecimal(row.rate), {
    locale,
    minFraction: 0,
    maxFraction: 4,
  })
  return (
    <>
      <dt className="pl-3 text-xs text-muted-foreground">
        {t('totals.taxRow', { code: row.tax_code ?? '', rate, base: money(row.base) })}
      </dt>
      <dd className="text-right text-xs tabular-nums">{money(row.amount)}</dd>
    </>
  )
}

/** Warnings of a preview, a saved document or an action (credit warn mode, missing prices). */
export function WarningsList({
  warnings,
  lineLabel,
}: {
  warnings: readonly SalesWarning[]
  /** Label of the line a warning refers to ("2. satır"). */
  lineLabel?: (w: SalesWarning) => string | null
}) {
  const { t } = useTranslation('sales-shared')
  if (warnings.length === 0) return null
  return (
    <section
      aria-label={t('warnings.title')}
      className="space-y-1 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
    >
      <h2 className="text-xs font-semibold">{t('warnings.title')}</h2>
      <ul className="space-y-0.5">
        {warnings.map((w, i) => {
          const where = lineLabel?.(w)
          const Icon = w.severity === 'info' ? Info : AlertTriangle
          return (
            <li key={`${w.code}-${i}`} className="flex items-start gap-1.5 text-xs">
              <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {where && <span className="font-medium">{where}: </span>}
                {w.message}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
