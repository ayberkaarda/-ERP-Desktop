import { useTranslation } from 'react-i18next'
import { StatusBadge, type StatusDefinition } from '@/components/shared/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { dec } from '@/features/sales/invoices/kit/money'

type Tone = StatusDefinition['tone']

const RECEIPT_TONES = { draft: 'neutral', posted: 'success', cancelled: 'warning' } as const
const INVOICE_TONES = {
  draft: 'neutral',
  pending_approval: 'warning',
  booked: 'primary',
  partially_paid: 'info',
  paid: 'success',
  cancelled: 'neutral',
  reversed: 'danger',
} as const
const RETURN_TONES = {
  draft: 'neutral',
  approved: 'info',
  shipped: 'primary',
  debited: 'success',
  cancelled: 'neutral',
} as const
const MATCH_TONES = {
  matched: 'success',
  qty_variance: 'danger',
  price_variance: 'warning',
  unmatched: 'neutral',
} as const

export type ReceiptStatusName = keyof typeof RECEIPT_TONES
export type InvoiceStatusName = keyof typeof INVOICE_TONES
export type ReturnStatusName = keyof typeof RETURN_TONES
export type MatchStatusName = keyof typeof MATCH_TONES

function defs<K extends string>(
  tones: Record<K, Tone>,
  label: (k: K) => string,
): Record<string, StatusDefinition> {
  return Object.fromEntries(
    (Object.keys(tones) as K[]).map((k) => [k, { tone: tones[k], label: label(k) }]),
  )
}

export function ReceiptStatusBadge({ status }: { status: ReceiptStatusName }) {
  const { t } = useTranslation('purchasing-docs')
  return (
    <StatusBadge
      status={status}
      definitions={defs(RECEIPT_TONES, (k) => t(`receiptStatus.${k}`))}
    />
  )
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatusName }) {
  const { t } = useTranslation('purchasing-docs')
  return (
    <StatusBadge
      status={status}
      definitions={defs(INVOICE_TONES, (k) => t(`invoiceStatus.${k}`))}
    />
  )
}

export function ReturnStatusBadge({ status }: { status: ReturnStatusName }) {
  const { t } = useTranslation('purchasing-docs')
  return (
    <StatusBadge status={status} definitions={defs(RETURN_TONES, (k) => t(`returnStatus.${k}`))} />
  )
}

/** Three-way match result of an invoice or line; the label carries the meaning. */
export function MatchStatusBadge({ status }: { status: MatchStatusName }) {
  const { t } = useTranslation('purchasing-docs')
  return (
    <StatusBadge status={status} definitions={defs(MATCH_TONES, (k) => t(`matchStatus.${k}`))} />
  )
}

/** Payment state of a booked invoice from its balance (status stays authoritative). */
export function BalanceBadge({ payable, balanceDue }: { payable: string; balanceDue: string }) {
  const { t } = useTranslation('purchasing-docs')
  const balance = dec(balanceDue)
  if (balance.isZero() || balance.isNegative())
    return <Badge tone="success">{t('balance.settled')}</Badge>
  if (balance.lessThan(dec(payable))) return <Badge tone="info">{t('balance.partial')}</Badge>
  return <Badge tone="warning">{t('balance.open')}</Badge>
}
