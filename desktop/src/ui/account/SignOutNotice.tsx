// After a sign-out the server was not told about (offline, no answer in time,
// refused): the local sign-out is done, but the device's sign-in stays valid
// on the server until it expires. The notice says so and opens the web
// security page, where the device can be signed out.

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'

import type { ExternalTarget } from '../../bridge/generated/ExternalTarget'
import { call } from '../../bridge/invoke'
import { useTd } from '../../i18n'
import { errorText } from './errors'
import { ErrorLine } from './GateFrame'
import type { AccountServices } from './services'

const TARGET: ExternalTarget = 'security'

export function SignOutNotice({ services }: { services: AccountServices }) {
  const td = useTd()
  const [shown, setShown] = useState(false)
  const [failure, setFailure] = useState<{ reason: unknown } | null>(null)

  useEffect(() => {
    const session = services.platform?.session
    if (!session) return undefined
    return session.onSignedOut(({ serverRevoked }) => {
      setFailure(null)
      setShown(!serverRevoked)
    })
  }, [services])

  if (!shown) return null

  async function openSecurity() {
    setFailure(null)
    try {
      await call(services.invoke, 'open_external', { target: TARGET })
    } catch (reason) {
      setFailure({ reason })
    }
  }

  return (
    <div
      role="alert"
      data-testid="sign-out-notice"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg space-y-3 rounded-md border border-border bg-background p-4 text-sm shadow-lg"
    >
      <p>{td('account.signOutNotice.body')}</p>
      <ErrorLine message={failure ? errorText(td, failure.reason) : null} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setShown(false)} data-testid="sign-out-notice-dismiss">
          {td('account.signOutNotice.dismiss')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void openSecurity()} data-testid="sign-out-notice-open">
          {td('account.signOutNotice.openSecurity')}
        </Button>
      </div>
    </div>
  )
}
