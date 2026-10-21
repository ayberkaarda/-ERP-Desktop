import { RefreshCw, TriangleAlert } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { NavLink } from 'react-router'
import { PageHeader, type Breadcrumb } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { isApiError } from '@/platform'
import { LIMIT_EXCEEDED } from './api'
import { useAccT } from './i18n'
import { ACCOUNTING_SETUP_ROUTES } from './navigation'
import type { AccountType } from './types'

function SubnavLink({ route }: { route: (typeof ACCOUNTING_SETUP_ROUTES)[number] }) {
  const t = useAccT()
  if (!usePermission(route.permission)) return null
  return (
    <li>
      <NavLink
        to={route.path}
        className={({ isActive }) =>
          cn(
            'inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted-foreground hover:bg-surface-sunken hover:text-foreground',
            isActive && 'bg-primary-soft font-medium text-primary-soft-foreground',
          )
        }
      >
        {t(`common.nav.${route.key}`)}
      </NavLink>
    </li>
  )
}

interface ShellProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  breadcrumbs?: Breadcrumb[]
  children: ReactNode
  wide?: boolean
}

/** Frame of the accounting setup pages: section links, header, content. */
export function AccountingShell({ children, wide = false, ...header }: ShellProps) {
  const t = useAccT()
  return (
    <div className={cn('mx-auto p-4 sm:p-6', wide ? 'max-w-[1440px]' : 'max-w-6xl')}>
      <nav aria-label={t('common.nav.title')} className="mb-4">
        <ul className="flex flex-wrap gap-1">
          {ACCOUNTING_SETUP_ROUTES.map((route) => (
            <SubnavLink key={route.key} route={route} />
          ))}
        </ul>
      </nav>
      <PageHeader
        breadcrumbs={[{ label: t('common.nav.title') }, { label: header.title }]}
        {...header}
      />
      {children}
    </div>
  )
}

const TYPE_TONE: Record<AccountType, NonNullable<ComponentProps<typeof Badge>['tone']>> = {
  asset: 'primary',
  liability: 'warning',
  equity: 'info',
  revenue: 'success',
  expense: 'danger',
  cost: 'danger',
  memo: 'neutral',
}

export function AccountTypeBadge({ type }: { type: AccountType }) {
  const t = useAccT()
  return (
    <Badge tone={TYPE_TONE[type]} data-type={type}>
      {t(`accounts.types.${type}`)}
    </Badge>
  )
}

export interface NativeSelectOption {
  value: string
  label: string
}

interface NativeSelectProps extends Omit<ComponentProps<'select'>, 'children'> {
  options: readonly NativeSelectOption[]
  emptyLabel?: string
}

/** Styled native select: keyboard and screen reader behaviour comes from the platform. */
export function NativeSelect({ options, emptyLabel, className, ...props }: NativeSelectProps) {
  return (
    <select
      className={cn(
        'h-control w-full min-w-0 rounded-md border border-input bg-surface px-3 text-sm shadow-xs',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none',
        'aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Shown on 409 VERSION_CONFLICT: the user decides to reload; edits are not merged. */
export function VersionConflictAlert({
  onReload,
  busy = false,
  className,
}: {
  onReload?: () => void
  busy?: boolean
  className?: string
}) {
  const t = useAccT()
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-start gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground',
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold">{t('common.conflictTitle')}</p>
        <p>{t('common.conflictBody')}</p>
      </div>
      {onReload && (
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onReload}>
          <RefreshCw className={busy ? 'animate-spin' : undefined} aria-hidden="true" />
          {t('common.reload')}
        </Button>
      )}
    </div>
  )
}

/** Inline failure state with a retry action, for blocks that are not a DataTable. */
export function LoadError({ onRetry, error }: { onRetry: () => void; error?: unknown }) {
  const t = useAccT()
  const tooMany = isApiError(error) && error.code === LIMIT_EXCEEDED
  return (
    <div role="alert" className="flex items-center gap-3 py-4 text-sm text-danger">
      <span>{tooMany ? t('common.limitExceeded') : t('common.loadFailed')}</span>
      {!tooMany && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
