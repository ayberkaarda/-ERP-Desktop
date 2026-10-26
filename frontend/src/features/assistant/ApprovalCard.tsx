import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { safeAssistantPath } from './navigation'
import type { ToolCall } from './types'

export function ApprovalCard({
  call,
  busy,
  disabled,
  onDecision,
}: {
  call: ToolCall
  busy: boolean
  disabled: boolean
  onDecision: (call: ToolCall, decision: 'approve' | 'reject') => void
}) {
  const { t } = useTranslation('assistant')
  const result =
    typeof call.result === 'object' && call.result !== null
      ? (call.result as Record<string, unknown>)
      : {}
  const payload =
    typeof result.untrusted_data === 'object' && result.untrusted_data !== null
      ? (result.untrusted_data as Record<string, unknown>)
      : result
  const url = safeAssistantPath(payload.url)
  const toolTitles: Record<string, 'draftPurchaseRequest' | 'draftJournal' | 'draftQuote'> = {
    draft_purchase_request: 'draftPurchaseRequest',
    draft_journal_entry: 'draftJournal',
    draft_sales_quote: 'draftQuote',
  }
  return (
    <section
      className="space-y-2 rounded-md border border-border bg-surface p-3"
      aria-label={t('approval')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <strong className="break-all">{t(toolTitles[call.tool] ?? 'approval')}</strong>
        <span>
          {call.status === 'pending'
            ? t('pendingApproval')
            : call.status === 'rejected'
              ? t('rejected')
              : call.status === 'failed'
                ? t('toolFailed')
                : t('completed')}
        </span>
      </div>
      {call.reason && <p className="text-xs text-muted-foreground">{call.reason}</p>}
      {call.kind === 'draft' && <p className="text-xs text-muted-foreground">{t('draftOnly')}</p>}
      <details open={call.status === 'pending'}>
        <summary className="cursor-pointer text-xs font-medium">{t('preview')}</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-surface-sunken p-2 font-mono text-xs">
          {JSON.stringify(call.arguments, null, 2).slice(0, 20_000)}
        </pre>
      </details>
      {call.status === 'pending' && (
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || disabled} onClick={() => onDecision(call, 'approve')}>
            {t('approve')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || disabled}
            onClick={() => onDecision(call, 'reject')}
          >
            {t('reject')}
          </Button>
        </div>
      )}
      {url && call.status === 'completed' && (
        <Link to={url} className="text-xs text-primary underline">
          {t('openDraft')}
        </Link>
      )}
    </section>
  )
}
