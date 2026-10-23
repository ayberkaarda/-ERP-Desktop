import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { usePermission } from '@/lib/permissions'
import { useAssistantStatus } from './useAssistantStatus'

export function AssistantSetupCard() {
  const { t } = useTranslation('assistant')
  const canAdmin = usePermission('assistant.usage.view')
  const status = useAssistantStatus()
  if (!canAdmin || !status.data?.can_admin || (status.data.enabled && status.data.configured))
    return null
  return (
    <section
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-4"
      aria-label={t('setupTitle')}
    >
      <div>
        <h2 className="text-sm font-semibold">{t('setupTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {status.data.enabled ? t('notConfigured') : t('disabled')}
        </p>
      </div>
      <Link to="/system/assistant" className="text-sm font-medium text-primary underline">
        {t('setupLink')}
      </Link>
    </section>
  )
}
