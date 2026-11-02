import { AuthFrame } from '@/features/auth/components/AuthFrame'

import { useTd } from '../../i18n'

/** Shown by the account pages when there is no shell (a plain browser tab). */
export function DesktopOnlyNotice() {
  const td = useTd()
  return (
    <AuthFrame>
      <div className="space-y-2" data-testid="desktop-only">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.desktopOnly.title')}</h1>
        <p className="text-sm text-muted-foreground">{td('account.desktopOnly.body')}</p>
      </div>
    </AuthFrame>
  )
}
