import { AlertCircle, RefreshCw, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { StatusBadge, type StatusDefinition } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { errorMessage } from '../lib/errors'
import {
  ORDER_STATUSES,
  QUOTE_STATUSES,
  type OrderStatus,
  type QuoteStatus,
  type SalesKind,
} from '../types'

type Tone = StatusDefinition['tone']

const QUOTE_TONES: Record<QuoteStatus, Tone> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'success',
  rejected: 'danger',
  expired: 'warning',
  converted: 'primary',
  cancelled: 'neutral',
}

const ORDER_TONES: Record<OrderStatus, Tone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  confirmed: 'info',
  partially_delivered: 'primary',
  delivered: 'primary',
  partially_invoiced: 'success',
  invoiced: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
}

/** Status of a quote or order; the label carries the meaning, the dot is decorative. */
export function SalesStatusBadge({ kind, status }: { kind: SalesKind; status: string }) {
  const { t } = useTranslation('sales-shared')
  const definitions: Record<string, StatusDefinition> = {}
  if (kind === 'quote') {
    for (const s of QUOTE_STATUSES)
      definitions[s] = { tone: QUOTE_TONES[s], label: t(`quoteStatus.${s}`) }
  } else {
    for (const s of ORDER_STATUSES)
      definitions[s] = { tone: ORDER_TONES[s], label: t(`orderStatus.${s}`) }
  }
  return <StatusBadge status={status} definitions={definitions} />
}

/**
 * Shown on 409 VERSION_CONFLICT: the user decides to reload; unsaved edits are not merged.
 * With `locked` (409 DOCUMENT_LOCKED) it says the document left draft and can no longer be edited.
 */
export function VersionConflictAlert({
  onReload,
  locked = false,
  className,
}: {
  onReload: () => void
  locked?: boolean
  className?: string
}) {
  const { t } = useTranslation('sales-shared')
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground',
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold">{t(locked ? 'locked.title' : 'conflict.title')}</p>
        <p>{t(locked ? 'locked.body' : 'conflict.body')}</p>
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={onReload}>
        <RefreshCw aria-hidden="true" />
        {t('conflict.reload')}
      </Button>
    </div>
  )
}

/** A failed load with the server's message and a retry button. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('sales-shared')
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{errorMessage(error, t('errors.load'))}</p>
      <Button type="button" size="sm" variant="secondary" onClick={onRetry}>
        <RefreshCw aria-hidden="true" />
        {t('actions.retry')}
      </Button>
    </div>
  )
}
