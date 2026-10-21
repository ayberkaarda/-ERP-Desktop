import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { EntryStatus } from '../types'

export function EntryStatusBadge({ status }: { status: EntryStatus }) {
  const { t } = useTranslation('accountingJournal')
  return (
    <StatusBadge
      status={status}
      definitions={{
        draft: { tone: 'neutral', label: t('status.draft') },
        posted: { tone: 'success', label: t('status.posted') },
        reversed: { tone: 'warning', label: t('status.reversed') },
      }}
    />
  )
}
