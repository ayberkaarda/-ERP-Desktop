import { CheckCircle2, Scale } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { cn } from '@/lib/utils'
import { balanceOf, type BalanceLine } from '../lib/balance'

/** Live debit vs credit totals; the difference says which side is short. */
export function BalanceBanner({ lines, className }: { lines: BalanceLine[]; className?: string }) {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  const b = balanceOf(lines)
  const fmt = (v: { toFixed: (n: number) => string }) =>
    formatDecimalDisplay(v.toFixed(2), { locale })
  const empty = b.debit.isZero() && b.credit.isZero()
  const tone = b.balanced
    ? 'border-success/40 bg-success-soft text-success-soft-foreground'
    : empty
      ? 'border-border bg-surface-sunken text-muted-foreground'
      : 'border-warning/40 bg-warning-soft text-warning-soft-foreground'

  return (
    <div
      role="status"
      aria-live="polite"
      data-balanced={b.balanced}
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border px-3 py-2 text-sm',
        tone,
        className,
      )}
    >
      <span className="flex items-center gap-2 font-semibold">
        {b.balanced ? (
          <CheckCircle2 className="size-4" aria-hidden="true" />
        ) : (
          <Scale className="size-4" aria-hidden="true" />
        )}
        {b.balanced
          ? t('balance.balanced')
          : empty
            ? t('balance.empty')
            : b.difference.greaterThan(0)
              ? t('balance.creditShort', { amount: fmt(b.difference) })
              : t('balance.debitShort', { amount: fmt(b.difference.abs()) })}
      </span>
      <span className="tabular-nums">
        {t('balance.debitTotal')}: <strong>{fmt(b.debit)}</strong>
      </span>
      <span className="tabular-nums">
        {t('balance.creditTotal')}: <strong>{fmt(b.credit)}</strong>
      </span>
      <span className="tabular-nums">
        {t('balance.difference')}: <strong>{fmt(b.difference.abs())}</strong>
      </span>
    </div>
  )
}
