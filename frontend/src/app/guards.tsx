import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router'
import { KeystoneMark } from '@/components/brand/Logo'
import { Button } from '@/components/ui/button'
import { useSessionProbe } from '@/features/auth/hooks/useSessionProbe'
import { PASSWORD_CHANGE_PATH } from '@/features/auth/session'
import { usePermission, type PermissionRequirement } from '@/lib/permissions'
import { useAuthStore } from '@/stores/auth'

interface RequireAuthProps {
  /** Shown as a forbidden state when the active company lacks it. */
  permission?: PermissionRequirement
  /** The forced password-change page itself must stay reachable. */
  allowPasswordChange?: boolean
  children?: ReactNode
}

export function RequireAuth({ permission, allowPasswordChange, children }: RequireAuthProps) {
  const location = useLocation()
  const { status, failed, retry } = useSessionProbe()
  const user = useAuthStore((s) => s.user)
  const allowed = usePermission(permission)

  if (status === 'unknown') return <SessionSplash failed={failed} onRetry={retry} />
  if (status === 'anonymous' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  if (user.mustChangePassword && !allowPasswordChange) {
    return <Navigate to={PASSWORD_CHANGE_PATH} replace />
  }
  if (!user.mustChangePassword && allowPasswordChange) return <Navigate to="/" replace />
  if (!allowed) return <Forbidden />
  return children ?? <Outlet />
}

/** Login is only for visitors; a live session goes straight to the app. */
export function GuestOnly({ children }: { children?: ReactNode }) {
  const { status, failed, retry } = useSessionProbe()
  if (status === 'unknown' && !failed) return <SessionSplash failed={false} onRetry={retry} />
  if (status === 'authenticated') return <Navigate to="/" replace />
  // A failed probe (API down) still shows the form so the error surfaces on submit.
  return children ?? <Outlet />
}

function SessionSplash({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <KeystoneMark className={failed ? 'h-10' : 'h-10 animate-pulse'} />
        {failed ? (
          <div role="alert" className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('auth.session.failed')}</p>
            <Button variant="secondary" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('auth.session.checking')}
          </p>
        )}
      </div>
    </div>
  )
}

export function Forbidden() {
  const { t } = useTranslation()
  return (
    <div role="alert" className="mx-auto max-w-md px-6 py-16 text-center">
      <h1 className="text-lg font-semibold">{t('auth.forbidden.title')}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">{t('auth.forbidden.body')}</p>
    </div>
  )
}
