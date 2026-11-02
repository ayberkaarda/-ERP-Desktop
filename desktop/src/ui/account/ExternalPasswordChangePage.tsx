// The forced password change on desktop: the password is changed in the web
// app (opened by page name through the shell), then the user signs in again.

import { useState } from 'react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { AuthFrame, FormAlert } from '@/features/auth/components/AuthFrame'
import { isPlatformCancelled } from '@/platform/shared'

import type { ExternalTarget } from '../../bridge/generated/ExternalTarget'
import { call } from '../../bridge/invoke'
import { useTd } from '../../i18n'
import { errorText } from './errors'
import { useAccount } from './services'

const TARGET: ExternalTarget = 'password_change'

export function ExternalPasswordChangePage() {
  const td = useTd()
  const account = useAccount()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)

  async function openWeb() {
    setError(null)
    setOpened(false)
    try {
      await call(account.invoke, 'open_external', { target: TARGET })
      setOpened(true)
    } catch (reason) {
      setError(errorText(td, reason))
    }
  }

  async function signInAgain() {
    setBusy(true)
    setError(null)
    try {
      await account.session.signOut()
      await navigate('/login', { replace: true })
    } catch (reason) {
      // Kept by the user in the pending-work dialog: stay here, no error.
      if (!isPlatformCancelled(reason)) setError(errorText(td, reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame>
      <div className="space-y-4" data-testid="external-password-change">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.password.title')}</h1>
        <p className="text-sm text-muted-foreground">{td('account.password.body')}</p>
        <FormAlert message={error} />
        {opened ? (
          <p role="status" className="text-sm text-muted-foreground">
            {td('account.password.opened')}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button onClick={() => void openWeb()} data-testid="password-open-web">
            {td('account.password.openWeb')}
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void signInAgain()}
            data-testid="password-sign-in-again"
          >
            {td('account.password.changedIt')}
          </Button>
        </div>
      </div>
    </AuthFrame>
  )
}
