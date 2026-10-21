import { Loader2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIntlLocale } from '@/lib/datetime'
import { money } from '../kit/money'
import type { DocWarning } from '../kit/types'

export interface TotalsView {
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  total_local?: string
}

interface TotalsPanelProps {
  totals: TotalsView
  currency: string
  /** Company currency when it differs (local total shown below). */
  localCurrency?: string | null
  /** True while the figures are the editor's estimate, not the server's answer. */
  estimate?: boolean
  loading?: boolean
  warnings?: DocWarning[]
  balanceDue?: string | null
  paidAmount?: string | null
}

/** Subtotal, discount, tax and total (server preview or stored), warnings and balance. */
export function TotalsPanel({
  totals,
  currency,
  localCurrency,
  estimate = false,
  loading = false,
  warnings = [],
  balanceDue,
  paidAmount,
}: TotalsPanelProps) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const row = (label: string, value: string, strong = false, testId?: string) => (
    <div
      className={
        strong
          ? 'flex justify-between border-t border-border pt-1.5 font-semibold'
          : 'flex justify-between'
      }
    >
      <dt>{label}</dt>
      <dd className="tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  )
  return (
    <section
      aria-label={t('totals.title')}
      className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t('totals.title')}</h2>
        {loading ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-label={t('totals.calculating')}
          />
        ) : (
          estimate && <span className="text-2xs text-muted-foreground">{t('totals.estimate')}</span>
        )}
      </div>
      <dl className="space-y-1">
        {row(t('totals.subtotal'), money(totals.subtotal, locale, currency))}
        {row(t('totals.discount'), money(totals.discount_total, locale, currency))}
        {row(t('totals.tax'), money(totals.tax_total, locale, currency))}
        {row(t('totals.total'), money(totals.total, locale, currency), true, 'doc-total')}
        {localCurrency &&
          localCurrency !== currency &&
          totals.total_local &&
          row(t('totals.totalLocal'), money(totals.total_local, locale, localCurrency))}
        {paidAmount != null && row(t('totals.paid'), money(paidAmount, locale, currency))}
        {balanceDue != null &&
          row(t('totals.balanceDue'), money(balanceDue, locale, currency), true, 'balance-due')}
      </dl>
      {warnings.length > 0 && (
        <ul
          role="status"
          className="space-y-1 rounded-md bg-warning-soft p-2 text-xs text-warning-soft-foreground"
        >
          {warnings.map((w) => (
            <li key={`${w.code}-${w.message}`} className="flex gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {w.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
