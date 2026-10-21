import { useTranslation } from 'react-i18next'
import { StatusBadge, type StatusDefinition } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { dec } from '../money'

type Tone = StatusDefinition['tone']

const DELIVERY_TONES = { draft: 'neutral', posted: 'success', cancelled: 'warning' } as const
const INVOICE_TONES = {
  draft: 'neutral',
  pending_approval: 'warning',
  issued: 'primary',
  partially_paid: 'info',
  paid: 'success',
  cancelled: 'neutral',
  reversed: 'danger',
} as const
const RETURN_TONES = {
  draft: 'neutral',
  approved: 'info',
  received: 'primary',
  credited: 'success',
  cancelled: 'neutral',
} as const

export type DeliveryStatusName = keyof typeof DELIVERY_TONES
export type InvoiceStatusName = keyof typeof INVOICE_TONES
export type ReturnStatusName = keyof typeof RETURN_TONES

function defs<K extends string>(
  tones: Record<K, Tone>,
  label: (k: K) => string,
): Record<string, StatusDefinition> {
  return Object.fromEntries(
    (Object.keys(tones) as K[]).map((k) => [k, { tone: tones[k], label: label(k) }]),
  )
}

export function DeliveryStatusBadge({ status }: { status: DeliveryStatusName }) {
  const { t } = useTranslation('sales-docs')
  return (
    <StatusBadge
      status={status}
      definitions={defs(DELIVERY_TONES, (k) => t(`deliveryStatus.${k}`))}
    />
  )
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatusName }) {
  const { t } = useTranslation('sales-docs')
  return (
    <StatusBadge
      status={status}
      definitions={defs(INVOICE_TONES, (k) => t(`invoiceStatus.${k}`))}
    />
  )
}

export function ReturnStatusBadge({ status }: { status: ReturnStatusName }) {
  const { t } = useTranslation('sales-docs')
  return (
    <StatusBadge status={status} definitions={defs(RETURN_TONES, (k) => t(`returnStatus.${k}`))} />
  )
}

/**
 * Collection state of an issued invoice from its balance: open, partially paid or settled. The
 * status field is authoritative; this badge only explains the balance next to it.
 */
export function BalanceBadge({ total, balanceDue }: { total: string; balanceDue: string }) {
  const { t } = useTranslation('sales-docs')
  const balance = dec(balanceDue)
  if (balance.isZero() || balance.isNegative())
    return <Badge tone="success">{t('balance.settled')}</Badge>
  if (balance.lessThan(dec(total))) return <Badge tone="info">{t('balance.partial')}</Badge>
  return <Badge tone="warning">{t('balance.open')}</Badge>
}
