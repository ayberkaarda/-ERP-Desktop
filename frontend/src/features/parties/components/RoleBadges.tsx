import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { cn } from '@/lib/utils'
import type { PartyRole } from '../types'

const TONE = { customer: 'primary', supplier: 'info' } as const

export function RoleBadges({
  roles,
  className,
}: {
  roles: readonly PartyRole[]
  className?: string
}) {
  const { t } = useTranslation('parties')
  return (
    <span className={cn('inline-flex flex-wrap gap-1', className)}>
      {roles.map((role) => (
        <Badge key={role} tone={TONE[role]} data-role={role}>
          {t(`roles.${role}`)}
        </Badge>
      ))}
    </span>
  )
}

export function PartyStatusBadge({ active }: { active: boolean }) {
  const { t } = useTranslation('parties')
  const status = active ? 'active' : 'inactive'
  return (
    <StatusBadge
      status={status}
      definitions={{
        [status]: { tone: active ? 'success' : 'neutral', label: t(`status.${status}`) },
      }}
    />
  )
}
