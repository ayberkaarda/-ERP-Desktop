import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { dec, money } from '../kit/money'
import { SALES_OPEN } from '../kit/permissions'
import { useExposure } from '../queries'

/** Customer risk next to the picker: unlimited, available amount, or over the limit. */
export function ExposureBadge({ partyId }: { partyId: string }) {
  const { t } = useTranslation('sales-docs')
  const locale = useIntlLocale()
  const allowed = usePermission(SALES_OPEN.customerSummary)
  const exposure = useExposure(partyId, allowed)
  const e = exposure.data
  if (!e) return null
  if (e.limit === null || e.available === null) {
    return (
      <p className="pt-1">
        <Badge tone="neutral">{t('exposure.unlimited')}</Badge>
      </p>
    )
  }
  const over = dec(e.available).isNegative()
  return (
    <p className="pt-1" data-testid="exposure-badge">
      <Badge tone={over ? 'danger' : 'info'}>
        {over
          ? t('exposure.over', {
              amount: money(dec(e.available).abs().toFixed(2), locale, e.currency),
            })
          : t('exposure.available', {
              amount: money(e.available, locale, e.currency),
              limit: money(e.limit, locale, e.currency),
            })}
      </Badge>
    </p>
  )
}
