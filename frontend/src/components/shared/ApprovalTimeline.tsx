import { CheckCircle2, Circle, CircleDashed, Clock, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatDateTime, useIntlLocale } from '@/lib/datetime'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { EmptyState } from './EmptyState'

export type ApprovalStepState = 'waiting' | 'pending' | 'approved' | 'rejected' | 'skipped'

export interface ApprovalDecisionView {
  actor: string
  decision: 'approve' | 'reject'
  comment?: string | null
  /** ISO instant. */
  decidedAt: string
}

/** One step of an ApprovalRequest (GET /approvals/{id}), already mapped to display names. */
export interface ApprovalTimelineStep {
  id: string
  order: number
  name?: string
  state: ApprovalStepState
  approvers: string[]
  /** Money string; the step applies only above this amount. */
  threshold?: string | null
  decision?: ApprovalDecisionView | null
}

const ICONS = {
  waiting: Circle,
  pending: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
  skipped: CircleDashed,
} as const

const ICON_TONE: Record<ApprovalStepState, string> = {
  waiting: 'text-subtle-foreground',
  pending: 'text-warning',
  approved: 'text-success',
  rejected: 'text-danger',
  skipped: 'text-subtle-foreground',
}

interface ApprovalTimelineProps {
  steps: ApprovalTimelineStep[]
  currency?: string
  className?: string
}

export function ApprovalTimeline({ steps, currency = 'TRY', className }: ApprovalTimelineProps) {
  const { t } = useTranslation('common')
  const locale = useIntlLocale()
  if (steps.length === 0) return <EmptyState compact description={t('approval.empty')} />

  const ordered = [...steps].sort((a, b) => a.order - b.order)
  return (
    <ol className={cn('space-y-0', className)} aria-label={t('approval.title')}>
      {ordered.map((step, i) => {
        const Icon = ICONS[step.state]
        const last = i === ordered.length - 1
        return (
          <li
            key={step.id}
            className="relative flex gap-3 pb-5 last:pb-0"
            aria-current={step.state === 'pending' ? 'step' : undefined}
          >
            {!last && (
              <span
                aria-hidden="true"
                className="absolute top-6 bottom-0 left-[9px] w-px bg-border"
              />
            )}
            <Icon
              className={cn('mt-0.5 size-5 shrink-0', ICON_TONE[step.state])}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">
                  {step.name ?? t('approval.step', { order: step.order })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`approval.state.${step.state}`)}
                </span>
              </div>
              {step.approvers.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('approval.approvers', { names: step.approvers.join(', ') })}
                </p>
              )}
              {step.threshold && (
                <p className="text-xs text-muted-foreground">
                  {t('approval.threshold', {
                    amount: formatMoney(step.threshold, currency, locale),
                  })}
                </p>
              )}
              {step.decision && (
                <div className="pt-1 text-xs">
                  <p>
                    <span className="font-medium">
                      {step.decision.decision === 'approve'
                        ? t('approval.approvedBy', { name: step.decision.actor })
                        : t('approval.rejectedBy', { name: step.decision.actor })}
                    </span>{' '}
                    <time className="text-muted-foreground" dateTime={step.decision.decidedAt}>
                      {formatDateTime(step.decision.decidedAt, locale)}
                    </time>
                  </p>
                  {step.decision.comment && (
                    <blockquote className="mt-1 border-l-2 border-border-strong pl-2 text-muted-foreground">
                      {step.decision.comment}
                    </blockquote>
                  )}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
