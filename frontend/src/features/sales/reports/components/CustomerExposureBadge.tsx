import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import {
  CUSTOMER_SALES_VIEW,
  formatAmount,
  isNegative,
  useCustomerExposure,
  usedPercent,
} from '../lib/customer'

/**
 * Read-only risk position of a customer for the party header (GET /customers/{id}/exposure):
 * hidden without a sales read permission; nothing is shown while loading or on failure.
 */
export function CustomerExposureBadge({ partyId }: { partyId: string }) {
  const { t } = useTranslation('sales-reports')
  const locale = useIntlLocale()
  const allowed = usePermission(CUSTOMER_SALES_VIEW)
  const exposure = useCustomerExposure(partyId, allowed)
  const e = exposure.data
  if (!allowed || !e) return null

  const total = formatAmount(e.total, locale, e.currency)
  if (e.limit === null) {
    return (
      <Badge
        tone="neutral"
        data-testid="exposure-badge"
        title={t('badge.unlimitedHint', { total })}
      >
        {t('badge.unlimited', { total })}
      </Badge>
    )
  }
  const used = usedPercent(e)
  const over = isNegative(e.available)
  const tone = over ? 'danger' : used !== null && used >= 80 ? 'warning' : 'success'
  const limit = formatAmount(e.limit, locale, e.currency)
  const available = formatAmount(e.available, locale, e.currency)

  return (
    <Badge
      tone={tone}
      data-testid="exposure-badge"
      title={t('badge.hint', { total, limit, available })}
    >
      {over ? t('badge.over', { total, limit }) : t('badge.used', { total, limit })}
    </Badge>
  )
}
