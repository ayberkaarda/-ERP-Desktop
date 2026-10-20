import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title?: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  compact?: boolean
  className?: string
}

/** Arch waiting for its keystone: the empty counterpart of ErrorState's fallen keystone. */
function OpenArch() {
  return (
    <svg viewBox="0 0 120 80" className="h-14 w-auto" aria-hidden="true">
      <path
        className="fill-border"
        d="M14 76V50a36 36 0 0 1 23.6-33.8l5.9 15.9A19 19 0 0 0 31 50v26ZM106 76V50a36 36 0 0 0-23.6-33.8l-5.9 15.9A19 19 0 0 1 89 50v26Z"
      />
      <path
        className="fill-none stroke-brand-accent"
        strokeWidth="1.5"
        strokeDasharray="3 3"
        d="m46 14 4 14h20l4-14Z"
      />
      <path className="stroke-border-strong" strokeWidth="2" strokeLinecap="round" d="M4 77h112" />
    </svg>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  compact = false,
  className,
}: EmptyStateProps) {
  const { t } = useTranslation('common')
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      {icon ?? <OpenArch />}
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold">{title ?? t('empty.title')}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
