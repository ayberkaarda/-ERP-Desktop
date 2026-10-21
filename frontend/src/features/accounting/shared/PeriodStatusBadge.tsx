import { StatusBadge } from '@/components/shared/StatusBadge'
import { useAccT } from './i18n'
import type { FiscalYearStatus, PeriodStatus } from './types'

/** Period and fiscal year status chips (label + tone; never color alone). */
export function PeriodStatusBadge({ status }: { status: PeriodStatus | FiscalYearStatus }) {
  const t = useAccT()
  return (
    <StatusBadge
      status={status}
      definitions={{
        open: { tone: 'success', label: t('periods.status.open') },
        soft_closed: { tone: 'warning', label: t('periods.status.soft_closed') },
        closed: { tone: 'neutral', label: t('periods.status.closed') },
      }}
    />
  )
}
