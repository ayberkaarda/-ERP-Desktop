import { useTranslation } from 'react-i18next'
import { StatusBadge } from '@/components/shared/StatusBadge'
import type { DocStatus } from '../types'

export function DocStatusBadge({ status }: { status: DocStatus }) {
  const { t } = useTranslation('inventoryDocs')
  return (
    <StatusBadge
      status={status}
      definitions={{
        draft: { tone: 'neutral', label: t('status.draft') },
        posted: { tone: 'success', label: t('status.posted') },
        cancelled: { tone: 'warning', label: t('status.cancelled') },
      }}
    />
  )
}
