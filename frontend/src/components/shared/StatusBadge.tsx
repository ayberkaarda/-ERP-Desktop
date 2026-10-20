import { useTranslation } from 'react-i18next'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type Tone = NonNullable<BadgeProps['tone']>

export interface StatusDefinition {
  tone: Tone
  /** Already translated label; defaults to `common:status.<status>`. */
  label?: string
}

const DEFAULT_TONES: Record<string, Tone> = {
  draft: 'neutral',
  pending: 'warning',
  pending_approval: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  posted: 'primary',
  completed: 'success',
  closed: 'neutral',
  active: 'success',
  inactive: 'neutral',
}

const DOT: Record<Tone, string> = {
  neutral: 'bg-subtle-foreground',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
}

interface StatusBadgeProps {
  status: string
  /** Module-specific statuses or overrides of the defaults. */
  definitions?: Record<string, StatusDefinition>
  className?: string
}

/** Status is never conveyed by color alone: the dot is decorative, the label carries meaning. */
export function StatusBadge({ status, definitions, className }: StatusBadgeProps) {
  const { t, i18n } = useTranslation('common')
  const def = definitions?.[status]
  const tone: Tone = def?.tone ?? DEFAULT_TONES[status] ?? 'neutral'
  const key = `status.${status}`
  const label =
    def?.label ?? (i18n.exists(key, { ns: 'common' }) ? t(key as 'status.draft') : status)
  return (
    <Badge tone={tone} className={cn('gap-1.5', className)} data-status={status}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT[tone])} />
      {label}
    </Badge>
  )
}
