import { ShieldAlert, ShieldCheck, ShieldQuestion } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { useExposure } from '../hooks/queries'
import { exposureState } from '../lib/insights'
import { SALES_ACCESS } from '../permissions'

interface ExposureBadgeProps {
  partyId: string
  /** This document's total in company currency (compared when the risk currency matches). */
  documentTotal: string | null
  documentCurrency: string
  /** This document's share already inside the exposure (revising a confirmed order). */
  counted?: string | null
  /** A stored, unchanged order / invoice: its amount in the risk currency comes from the API. */
  documentId?: string | null
}

const TONE = { unlimited: 'neutral', ok: 'success', tight: 'warning', over: 'danger' } as const

/** Customer risk: limit, current exposure and what remains after this document. */
export function ExposureBadge({
  partyId,
  documentTotal,
  documentCurrency,
  counted = null,
  documentId = null,
}: ExposureBadgeProps) {
  const { t } = useTranslation('sales-shared')
  const locale = useIntlLocale()
  const allowed = usePermission(SALES_ACCESS.exposure)
  const exposure = useExposure(partyId, documentId)
  if (!allowed || !partyId) return null
  if (exposure.isPending) {
    return (
      <span className="text-xs text-muted-foreground" role="status">
        {t('exposure.loading')}
      </span>
    )
  }
  if (exposure.isError) {
    return (
      <span className="text-xs text-muted-foreground" role="status">
        {t('exposure.unavailable')}
      </span>
    )
  }
  const e = exposure.data
  // The API's document_amount is already in the risk currency (any document currency).
  const fromApi = documentId && e.document_amount != null && documentCurrency !== e.currency
  const state = fromApi
    ? exposureState(e, e.document_amount ?? null, e.currency, null)
    : exposureState(e, documentTotal, documentCurrency, counted)
  const money = (v: string) => formatMoney(v, e.currency, locale)
  const Icon =
    state.tone === 'over' ? ShieldAlert : state.tone === 'unlimited' ? ShieldQuestion : ShieldCheck
  const label =
    state.tone === 'unlimited'
      ? t('exposure.unlimited', { exposure: money(e.total) })
      : t(`exposure.${state.tone}`, {
          available: money(state.after ?? '0'),
          limit: money(e.limit ?? '0'),
        })
  return (
    <div className="space-y-0.5" data-testid="exposure">
      <Badge tone={TONE[state.tone]} className="h-auto py-0.5 whitespace-normal">
        <Icon aria-hidden="true" />
        {label}
      </Badge>
      <p className="text-2xs text-muted-foreground">
        {t('exposure.breakdown', {
          invoices: money(e.open_invoices),
          orders: money(e.open_orders),
        })}
      </p>
    </div>
  )
}
