// Screens for a profile the shell could not open (D3 decision 8 and the
// profile-state errors). Nothing is deleted without the user's action.

import { useState } from 'react'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { CommandError } from '../../bridge/generated/CommandError'
import { call } from '../../bridge/invoke'
import { useTd } from '../../i18n'
import { errorText } from './errors'
import { ErrorLine, GateFrame } from './GateFrame'
import { KEPT, withPendingWork } from './pending'
import { ProfilesPage } from './ProfilesPage'
import { useAccount } from './services'
import { useProfiles } from './useProfiles'

function useProfileName(profileId: string): string {
  const { invoke } = useAccount()
  const { data } = useProfiles(invoke)
  return data?.profiles.find((p) => p.id === profileId)?.name ?? profileId
}

/**
 * The database key of the profile is gone or wrong. Local data cannot be
 * read, so unsent work cannot be counted: the reset is forced, and only
 * after the profile name was typed.
 */
export function StoreKeyRecovery({ profileId }: { profileId: string }) {
  const td = useTd()
  const account = useAccount()
  const name = useProfileName(profileId)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState(false)
  const confirmed = name.trim() !== '' && typed.trim() === name.trim()

  async function reset() {
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      await call(account.invoke, 'profile_reset', { id: profileId, force: true })
      await account.profileChanged()
    } catch (reason) {
      setError(errorText(td, reason))
    } finally {
      setBusy(false)
    }
  }

  if (profiles) return <ProfilesPage />
  return (
    <GateFrame testId="recovery-store-key">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.recovery.storeKey.title')}</h1>
        <p className="text-sm text-muted-foreground">{td('account.recovery.storeKey.body', { name })}</p>
        <p className="text-sm text-muted-foreground">{td('account.recovery.storeKey.pendingNote')}</p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          void reset()
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="store-key-confirm">{td('account.recovery.storeKey.confirmLabel', { name })}</Label>
          <Input
            id="store-key-confirm"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            data-testid="store-key-confirm"
          />
        </div>
        <ErrorLine message={error} />
        <Button type="submit" variant="danger" disabled={!confirmed || busy} data-testid="store-key-reset">
          {td('account.recovery.storeKey.reset')}
        </Button>
      </form>
      <div>
        <Button variant="secondary" onClick={() => setProfiles(true)} data-testid="store-key-profiles">
          {td('account.recovery.failed.profiles')}
        </Button>
      </div>
    </GateFrame>
  )
}

/** The session record of the profile cannot be read: reset it or remove it. */
export function MalformedRecovery({ profileId }: { profileId: string }) {
  const td = useTd()
  const account = useAccount()
  const name = useProfileName(profileId)
  const [asking, setAsking] = useState<'reset' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: 'reset' | 'remove') {
    setError(null)
    try {
      const done = await withPendingWork(account, kind === 'reset' ? 'resetProfile' : 'removeProfile', (force) =>
        call(account.invoke, kind === 'reset' ? 'profile_reset' : 'profile_remove', { id: profileId, force }),
      )
      if (done !== KEPT) await account.profileChanged()
    } catch (reason) {
      setError(errorText(td, reason))
    }
  }

  return (
    <GateFrame testId="recovery-malformed">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.recovery.malformed.title')}</h1>
        <p className="text-sm text-muted-foreground">{td('account.recovery.malformed.body', { name })}</p>
      </div>
      <ErrorLine message={error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => setAsking('reset')} data-testid="malformed-reset">
          {td('account.recovery.malformed.reset')}
        </Button>
        <Button variant="danger" onClick={() => setAsking('remove')} data-testid="malformed-remove">
          {td('account.recovery.malformed.remove')}
        </Button>
      </div>
      <ConfirmDialog
        open={asking === 'reset'}
        onOpenChange={(open) => {
          if (!open) setAsking(null)
        }}
        title={td('account.recovery.malformed.resetTitle')}
        description={td('account.recovery.malformed.resetBody')}
        confirmLabel={td('account.recovery.malformed.reset')}
        onConfirm={() => {
          setAsking(null)
          void run('reset')
        }}
      />
      <ConfirmDialog
        open={asking === 'remove'}
        onOpenChange={(open) => {
          if (!open) setAsking(null)
        }}
        title={td('account.recovery.malformed.removeTitle')}
        description={td('account.recovery.malformed.removeBody')}
        confirmLabel={td('account.recovery.malformed.remove')}
        onConfirm={() => {
          setAsking(null)
          void run('remove')
        }}
      />
    </GateFrame>
  )
}

/** profiles.json cannot be read; the shell leaves it as it is. */
export function ProfilesFileRecovery({ message, path }: { message: string; path?: string | undefined }) {
  const td = useTd()
  return (
    <GateFrame testId="recovery-profiles-file">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.recovery.file.title')}</h1>
        {path ? (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{td('account.recovery.file.bodyAt')}</p>
            <code
              className="block rounded-md bg-surface-sunken px-2 py-1 font-mono text-xs break-all select-all"
              data-testid="profiles-file-path"
            >
              {path}
            </code>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{td('account.recovery.file.body')}</p>
        )}
        <p className="text-sm text-muted-foreground">{td('account.recovery.file.notOverwritten')}</p>
        {message ? (
          <p className="font-mono text-xs text-subtle-foreground">{td('account.recovery.file.detail', { message })}</p>
        ) : null}
      </div>
    </GateFrame>
  )
}

/** Any other failure to open the profile: show it and lead to the profiles. */
export function FailedProfile({ error }: { error: CommandError | undefined }) {
  const td = useTd()
  const [profiles, setProfiles] = useState(false)
  if (profiles) return <ProfilesPage />
  return (
    <GateFrame testId="recovery-failed">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.recovery.failed.title')}</h1>
        <ErrorLine message={errorText(td, error)} />
      </div>
      <div>
        <Button variant="secondary" onClick={() => setProfiles(true)} data-testid="recovery-profiles">
          {td('account.recovery.failed.profiles')}
        </Button>
      </div>
    </GateFrame>
  )
}
