// Server profiles: the first-run screen of the gate and the /setup page.
// Add (address checked by the shell), select, refresh the server facts, remove.

import { useState } from 'react'
import { useNavigate } from 'react-router'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import type { ProfileDto } from '../../bridge/generated/ProfileDto'
import { call, toCommandError } from '../../bridge/invoke'
import { useTd } from '../../i18n'
import { errorText } from './errors'
import { ErrorLine, GateFrame } from './GateFrame'
import { KEPT, withPendingWork } from './pending'
import { useAccount } from './services'
import { useAppInfo, useProfiles } from './useProfiles'

const DEV_EXAMPLE = 'http://localhost:8000'
const RELEASE_EXAMPLE = 'https://erp.example.test'

interface Failure {
  text: string
  /** Set for `PROFILE_BUSY`: the same action once more. */
  retry?: () => void
}

export function ProfilesPage({
  firstRun = false,
  onOpened,
  onBack,
}: {
  firstRun?: boolean
  /** After another profile was opened (the /setup page goes to the app). */
  onOpened?: () => void
  onBack?: () => void
}) {
  const td = useTd()
  const account = useAccount()
  const profiles = useProfiles(account.invoke)
  const info = useAppInfo(account.invoke)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ProfileDto | null>(null)
  const activeId = profiles.data?.active_id ?? null
  const list = profiles.data?.profiles ?? []

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setFailure(null)
    setNotice(null)
    try {
      await action()
    } catch (reason) {
      const busyProfile = toCommandError(reason).code === 'PROFILE_BUSY'
      setFailure({
        text: errorText(td, reason),
        ...(busyProfile ? { retry: () => void attempt(action) } : {}),
      })
    } finally {
      setBusy(false)
    }
  }

  async function open(id: string) {
    await call(account.invoke, 'profile_select', { id })
    await account.profileChanged()
    onOpened?.()
  }

  function add() {
    void attempt(async () => {
      const added = await call<ProfileDto>(account.invoke, 'profile_add', {
        url: url.trim(),
        name: name.trim() === '' ? null : name.trim(),
      })
      setUrl('')
      setName('')
      if (activeId === null) await open(added.id)
      else await profiles.reload()
    })
  }

  function refresh(id: string) {
    void attempt(async () => {
      await call(account.invoke, 'profile_refresh_meta', { id })
      await profiles.reload()
      setNotice(td('account.setup.metaRefreshed'))
    })
  }

  function remove(profile: ProfileDto) {
    void attempt(async () => {
      const done = await withPendingWork(account, 'removeProfile', (force) =>
        call(account.invoke, 'profile_remove', { id: profile.id, force }),
      )
      if (done === KEPT) return
      if (profile.id === activeId) await account.profileChanged()
      await profiles.reload()
    })
  }

  return (
    <GateFrame testId="profiles-page">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.setup.title')}</h1>
        <p className="text-sm text-muted-foreground">{td('account.setup.subtitle')}</p>
        {firstRun ? <p className="text-sm text-foreground">{td('account.setup.firstRun')}</p> : null}
      </div>

      <section aria-label={td('account.setup.listTitle')} className="space-y-2">
        <h2 className="text-sm font-semibold">{td('account.setup.listTitle')}</h2>
        {profiles.data && list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{td('account.setup.empty')}</p>
        ) : null}
        {profiles.error ? <ErrorLine message={errorText(td, profiles.error)} /> : null}
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {list.map((profile) => (
            <li
              key={profile.id}
              aria-label={profile.name}
              className="flex flex-col gap-2 px-4 py-3"
              data-testid={`profile-${profile.id}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{profile.name}</span>
                {profile.id === activeId ? <Badge tone="primary">{td('account.setup.active')}</Badge> : null}
                <Badge tone={profile.realtime ? 'success' : 'neutral'}>
                  {profile.realtime ? td('account.setup.realtimeOn') : td('account.setup.realtimeOff')}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                <span className="font-mono">{profile.base_url}</span>
                <span>
                  {td('account.setup.server', { name: profile.server_name, version: profile.server_version })}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {profile.id !== activeId ? (
                  <Button size="sm" disabled={busy} onClick={() => void attempt(() => open(profile.id))}>
                    {td('account.setup.select')}
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => refresh(profile.id)}>
                  {td('account.setup.refreshMeta')}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(profile)}>
                  {td('account.setup.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {failure ? (
        <ErrorLine message={failure.text}>
          {failure.retry ? (
            <Button size="sm" variant="secondary" onClick={failure.retry}>
              {td('account.setup.tryAgain')}
            </Button>
          ) : null}
        </ErrorLine>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <form
        className="space-y-3"
        aria-label={td('account.setup.addTitle')}
        onSubmit={(event) => {
          event.preventDefault()
          add()
        }}
      >
        <h2 className="text-sm font-semibold">{td('account.setup.addTitle')}</h2>
        <div className="space-y-1.5">
          <Label htmlFor="profile-url">{td('account.setup.url')}</Label>
          <Input
            id="profile-url"
            inputMode="url"
            autoComplete="url"
            placeholder={info?.debug ? DEV_EXAMPLE : RELEASE_EXAMPLE}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            data-testid="profile-url"
          />
          <p className="text-xs text-subtle-foreground">
            {info?.debug ? td('account.setup.httpDebugNote') : td('account.setup.httpsNote')}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">{td('account.setup.name')}</Label>
          <Input
            id="profile-name"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-testid="profile-name"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || url.trim() === ''} data-testid="profile-add">
            {td('account.setup.add')}
          </Button>
          {onBack && activeId !== null ? (
            <Button type="button" variant="ghost" onClick={onBack}>
              {td('account.setup.back')}
            </Button>
          ) : null}
        </div>
      </form>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
        title={td('account.setup.removeTitle')}
        description={removing ? td('account.setup.removeBody', { name: removing.name }) : undefined}
        confirmLabel={td('account.setup.remove')}
        onConfirm={() => {
          const target = removing
          setRemoving(null)
          if (target) remove(target)
        }}
      />
    </GateFrame>
  )
}

/** The /setup route: inside the router, back to the app after a switch. */
export function SetupPage() {
  const navigate = useNavigate()
  return (
    <ProfilesPage
      onOpened={() => void navigate('/', { replace: true })}
      onBack={() => void navigate('/')}
    />
  )
}
