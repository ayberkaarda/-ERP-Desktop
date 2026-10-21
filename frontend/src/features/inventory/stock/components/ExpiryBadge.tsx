import { CalendarClock, CalendarX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatDate, toIsoDate, useIntlLocale } from '@/lib/datetime'
import { daysUntil, expiryState } from '../lib/expiry'
import { useInvT } from '../lib/i18n'

/** Expiry date with its state in words (expired, expires in n days); never colour alone. */
export function ExpiryBadge({ expiry, today }: { expiry: string | null; today?: string }) {
  const t = useInvT()
  const locale = useIntlLocale()
  const now = today ?? toIsoDate(new Date())
  const state = expiryState(expiry, now)
  if (!expiry || state === 'none') {
    return <span className="text-muted-foreground">{t('lots.noExpiry')}</span>
  }
  const date = formatDate(expiry, locale)
  if (state === 'ok') return <span className="tabular-nums">{date}</span>
  const days = daysUntil(expiry, now)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular-nums">{date}</span>
      <Badge tone={state === 'expired' ? 'danger' : 'warning'} data-expiry={state}>
        {state === 'expired' ? (
          <CalendarX aria-hidden="true" />
        ) : (
          <CalendarClock aria-hidden="true" />
        )}
        {state === 'expired'
          ? t('lots.expired')
          : days === 0
            ? t('lots.expiresToday')
            : t('lots.expiresIn', { count: days })}
      </Badge>
    </span>
  )
}
