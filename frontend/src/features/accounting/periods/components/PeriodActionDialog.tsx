import { useQueryClient } from '@tanstack/react-query'
import { Ban } from 'lucide-react'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { platform } from '@/platform'
import { ActionDialog } from '../../shared/ActionDialog'
import { useAccT } from '../../shared/i18n'
import { accKeys } from '../../shared/keys'
import { usePeriodTransition } from '../../shared/queries'
import type { AccountingPeriod, PeriodAction } from '../../shared/types'
import { readBlockedReason, type BlockedReason } from '../lib/periods'

function BlockedPanel({ reason }: { reason: BlockedReason }) {
  const t = useAccT()
  return (
    <div
      role="alert"
      className="flex gap-2 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
    >
      <Ban className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">{t('periods.blocked.title')}</p>
        <p>{reason.message}</p>
        {reason.draftCount !== null && (
          <p>{t('periods.blocked.drafts', { count: reason.draftCount })}</p>
        )}
        {reason.details.length > 0 && (
          <ul className="list-disc pl-5">
            {reason.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        <p className="text-xs">{t('periods.blocked.hint')}</p>
      </div>
    </div>
  )
}

const ACTION_KEY: Record<PeriodAction, string> = {
  'soft-close': 'softClose',
  close: 'close',
  reopen: 'reopen',
}

/** Soft close / close / reopen one period; reopen asks for an audited reason. */
export function PeriodActionDialog({
  period,
  action,
  label,
  onClose,
}: {
  period: AccountingPeriod
  action: PeriodAction
  label: string
  onClose: () => void
}) {
  const t = useAccT()
  const locale = useIntlLocale()
  const qc = useQueryClient()
  const transition = usePeriodTransition()
  const key = ACTION_KEY[action]
  const drafts = period.draft_entries_count ?? 0
  const blockedUpFront = action === 'close' && drafts > 0

  const confirm = async (reason: string | null) => {
    const fresh =
      qc
        .getQueryData<AccountingPeriod[]>(accKeys.periods(period.fiscal_year_id))
        ?.find((p) => p.id === period.id) ?? period
    await transition.mutateAsync({ period: fresh, action, reason })
    platform.notify.success(t(`periods.toast.${key}`, { period: label }))
  }

  return (
    <ActionDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t(`periods.actions.${key}Title`, { period: label })}
      description={t(`periods.actions.${key}Body`, {
        start: formatDate(period.start_date, locale),
        end: formatDate(period.end_date, locale),
      })}
      confirmLabel={t(`periods.actions.${key}`)}
      tone={action === 'reopen' ? 'danger' : 'primary'}
      requireReason={action === 'reopen'}
      confirmDisabled={blockedUpFront}
      onConfirm={confirm}
      onReload={() => qc.invalidateQueries({ queryKey: accKeys.periods(period.fiscal_year_id) })}
      renderError={(error) => {
        const reason = readBlockedReason(error)
        return reason ? <BlockedPanel reason={reason} /> : null
      }}
    >
      {blockedUpFront && (
        <BlockedPanel
          reason={{
            message: t('periods.blocked.upFront'),
            draftCount: drafts,
            details: [],
          }}
        />
      )}
    </ActionDialog>
  )
}
