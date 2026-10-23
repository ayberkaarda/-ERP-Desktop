import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { dec, money } from '@/features/sales/invoices/kit/money'
import { useIntlLocale } from '@/lib/datetime'
import { usePermission } from '@/lib/permissions'
import { useCompanyStore } from '@/stores/company'
import { http, seg } from '../http'
import { purchKeys } from '../keys'
import { PURCH_OPEN } from '../permissions'
import type { Envelope, SupplierExposure } from '../types'

/**
 * Informational supplier exposure (open payables + approved, not invoiced orders) next to the
 * supplier picker; overdue payables turn it into a warning. Never blocks anything.
 */
export function SupplierExposureBadge({ partyId }: { partyId: string }) {
  const { t } = useTranslation('purchasing-docs')
  const locale = useIntlLocale()
  useCompanyStore((s) => s.activeCompanyId)
  const allowed = usePermission(PURCH_OPEN.supplierSummary)
  const exposure = useQuery({
    queryKey: purchKeys.exposure(partyId),
    queryFn: ({ signal }) =>
      http()
        .get<Envelope<SupplierExposure>>(`/suppliers/${seg(partyId)}/exposure`, { signal })
        .then((r) => r.data),
    enabled: allowed && partyId !== '',
    staleTime: 15_000,
  })
  if (!allowed || !exposure.data) return null
  const e = exposure.data
  const overdue = dec(e.overdue_payables).greaterThan(0)
  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs" data-testid="supplier-exposure">
      <span className="text-muted-foreground">{t('exposure.label')}</span>
      <span className="tabular-nums">{money(e.total, locale, e.currency)}</span>
      <span className="text-muted-foreground">
        {t('exposure.breakdown', {
          payables: money(e.open_payables, locale),
          orders: money(e.open_orders, locale),
        })}
      </span>
      {overdue && (
        <Badge tone="warning">
          {t('exposure.overdue', { amount: money(e.overdue_payables, locale, e.currency) })}
        </Badge>
      )}
    </p>
  )
}
