import { useTranslation } from 'react-i18next'
import { TotalsPanel, type TotalsFigures } from '@/features/sales/shared/components/TotalsPanel'
import { useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { dec } from '../lib/forms'

export interface PurchTotalsFigures extends TotalsFigures {
  withholding_total: string
}

interface PurchTotalsProps {
  totals: PurchTotalsFigures | null
  currency: string
  localCurrency?: string | null
  pending?: boolean
  error?: boolean
  onRetry?: () => void
  className?: string
}

/**
 * The sales totals panel (subtotal, discounts, tax per code, total, company currency) plus the
 * VAT withholding (tevkifat) and what remains payable to the supplier.
 */
export function PurchTotals({ totals, className, ...props }: PurchTotalsProps) {
  const { t } = useTranslation('purchasing-orders')
  const locale = useIntlLocale()
  const withheld = totals ? dec(totals.withholding_total) : null
  return (
    <div className={cn('space-y-2', className)}>
      <TotalsPanel totals={totals} {...props} />
      {totals && withheld && !withheld.isZero() && (
        <dl
          aria-label={t('totals.withholdingTitle')}
          className={cn(
            'grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border border-border bg-surface p-4 text-sm',
            props.pending && 'opacity-60',
          )}
        >
          <dt className="text-muted-foreground">{t('totals.withholding')}</dt>
          <dd className="text-right tabular-nums" data-testid="withholding-total">
            −{formatMoney(totals.withholding_total, props.currency, locale)}
          </dd>
          <dt className="font-semibold">{t('totals.payable')}</dt>
          <dd className="text-right font-semibold tabular-nums" data-testid="payable-total">
            {formatMoney(dec(totals.total).minus(withheld).toFixed(4), props.currency, locale)}
          </dd>
        </dl>
      )}
    </div>
  )
}
