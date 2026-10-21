import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { formatDate } from '@/lib/datetime'
import { useIntlLocale } from '@/lib/datetime/locale'
import { cn } from '@/lib/utils'
import { useRateStatus } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { isRateStale } from '../utils'

/** Last TCMB fetch; turns into a warning once the rates are older than 4 days. */
export function RateStatusBanner() {
  const t = useRefT()
  const locale = useIntlLocale()
  const { data: status, isError } = useRateStatus()
  if (isError) return null
  if (!status) return null
  const stale = isRateStale(status)
  const date = status.last_fetch_date ? formatDate(status.last_fetch_date, locale) : null
  const Icon = stale ? AlertTriangle : CheckCircle2
  return (
    <div
      role={stale ? 'alert' : 'status'}
      data-stale={stale}
      className={cn(
        'mb-4 flex items-start gap-2 rounded-md border p-3 text-sm',
        stale
          ? 'border-warning/40 bg-warning-soft text-warning-soft-foreground'
          : 'border-border bg-surface-sunken text-muted-foreground',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>
        {date === null
          ? t('rates.status.never')
          : stale
            ? t('rates.status.stale', { date, days: status.stale_days ?? 0 })
            : t('rates.status.fresh', { date })}
      </p>
    </div>
  )
}
