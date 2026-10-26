import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { AssistantPanel } from './AssistantPanel'
import { useAssistantStatus } from './useAssistantStatus'

export function AssistantHost() {
  const user = useAuthStore((s) => s.user?.id)
  const company = useCompanyStore((s) => s.activeCompanyId)
  const fresh = useAuthStore((s) => s.permissionsState === 'fresh')
  const revoked = useCompanyStore((s) => s.accessRevoked)
  const allowed = usePermission('assistant.use')
  const status = useAssistantStatus()
  if (
    !fresh ||
    revoked ||
    !allowed ||
    !status.data?.enabled ||
    !status.data.configured ||
    !status.data.can_use
  )
    return null
  return <AssistantLauncher key={`${user}:${company}`} />
}

function AssistantLauncher() {
  const { t } = useTranslation('assistant')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'j' &&
        !event.altKey &&
        !event.repeat
      ) {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('open')}
        aria-keyshortcuts="Control+J Meta+J"
        onClick={() => setOpen(true)}
      >
        <MessageSquare className="text-muted-foreground" />
      </Button>
      <AssistantPanel open={open} onOpenChange={setOpen} />
    </>
  )
}
