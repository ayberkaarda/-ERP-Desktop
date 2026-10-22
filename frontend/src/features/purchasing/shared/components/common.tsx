import { Clock, ShieldAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ApprovalTimeline } from '@/components/shared/ApprovalTimeline'
import { StatusBadge, type StatusDefinition } from '@/components/shared/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { approvalSteps } from '@/features/sales/shared/lib/approval'
import { cn } from '@/lib/utils'
import { useApproval } from '../hooks/queries'
import {
  ORDER_STATUSES,
  REQUEST_STATUSES,
  RFQ_STATUSES,
  type OrderStatus,
  type PurchaseKind,
  type RequestStatus,
  type RfqStatus,
} from '../types'

export { LoadError, VersionConflictAlert } from '@/features/sales/shared/components/common'

type Tone = StatusDefinition['tone']

const REQUEST_TONES: Record<RequestStatus, Tone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'danger',
  partially_ordered: 'primary',
  ordered: 'primary',
  cancelled: 'neutral',
}

const RFQ_TONES: Record<RfqStatus, Tone> = {
  draft: 'neutral',
  sent: 'info',
  collecting: 'warning',
  awarded: 'success',
  cancelled: 'neutral',
}

const ORDER_TONES: Record<OrderStatus, Tone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'success',
  sent: 'info',
  partially_received: 'primary',
  received: 'primary',
  partially_invoiced: 'success',
  invoiced: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
}

/** Status of a request, RFQ or order; the label carries the meaning, the dot is decorative. */
export function PurchStatusBadge({ kind, status }: { kind: PurchaseKind; status: string }) {
  const { t } = useTranslation('purchasing-orders')
  const definitions: Record<string, StatusDefinition> = {}
  if (kind === 'request')
    for (const s of REQUEST_STATUSES)
      definitions[s] = { tone: REQUEST_TONES[s], label: t(`status.request.${s}`) }
  else if (kind === 'rfq')
    for (const s of RFQ_STATUSES)
      definitions[s] = { tone: RFQ_TONES[s], label: t(`status.rfq.${s}`) }
  else
    for (const s of ORDER_STATUSES)
      definitions[s] = { tone: ORDER_TONES[s], label: t(`status.order.${s}`) }
  return <StatusBadge status={status} definitions={definitions} />
}

export function Notice({ tone, children }: { tone: 'warning' | 'info'; children: ReactNode }) {
  const Icon = tone === 'warning' ? ShieldAlert : Clock
  return (
    <p
      role="note"
      className={cn(
        'flex items-start gap-2 rounded-md border p-3 text-sm',
        tone === 'warning'
          ? 'border-warning/40 bg-warning-soft text-warning-soft-foreground'
          : 'border-border bg-surface-sunken',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

/** Workflow steps of a request / order approval. */
export function ApprovalPanel({ id, currency }: { id: string; currency: string }) {
  const { t } = useTranslation('purchasing-orders')
  const approval = useApproval(id)
  if (approval.isPending) return <Skeleton className="h-24 w-full" />
  if (approval.isError)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t('approval.unavailable')}
      </p>
    )
  return <ApprovalTimeline steps={approvalSteps(approval.data)} currency={currency} />
}

/** Label/value grid of a document's header facts. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
