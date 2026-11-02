// Start-up gate around the web router: splash while the profile opens, the
// first-run server profile screen, recovery screens for a profile that could
// not be opened, otherwise the web app (whose guards probe /auth/me).
// Also hosts the pending-work dialog for the platform session.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

import type { ProfileStateDto } from '../../bridge/generated/ProfileStateDto'
import { call } from '../../bridge/invoke'
import { useTd } from '../../i18n'
import { appServices, inShell } from './defaults'
import { parseProfileState, PROFILE_STATE_EVENT } from './profileState'
import { GateFrame, Splash } from './GateFrame'
import { PendingWorkDialog } from './PendingWorkDialog'
import { ProfilesPage } from './ProfilesPage'
import { FailedProfile, MalformedRecovery, ProfilesFileRecovery, StoreKeyRecovery } from './Recovery'
import {
  AccountContext,
  type AccountContextValue,
  type AccountServices,
  type PendingWorkAnswer,
  type PendingWorkRequest,
} from './services'

type View = { kind: 'loading' } | { kind: 'unreadable' } | { kind: 'state'; state: ProfileStateDto }

interface Pending {
  request: PendingWorkRequest
  resolve: (answer: PendingWorkAnswer) => void
}

/**
 * The gate of the running app. Outside the shell window (jsdom, a plain
 * browser) every shell command fails, so it leaves the web app as it is.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const services = useMemo(() => (inShell() ? appServices() : null), [])
  if (!services) return children
  return <AccountGate services={services}>{children}</AccountGate>
}

export function AccountGate({ services, children }: { services: AccountServices; children: ReactNode }) {
  const td = useTd()
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [pending, setPending] = useState<Pending | null>(null)
  // Bumped by every event: a state answer asked before it is older news.
  const news = useRef(0)
  const shownProfile = useRef<string | undefined>(undefined)

  // The state answer as a view; null when an event came while it was asked.
  const ask = useCallback(async (): Promise<View | null> => {
    const asked = news.current
    let next: View
    try {
      // An answer the UI does not know (a newer shell) is not the web app.
      const state = parseProfileState(await call<unknown>(services.invoke, 'profile_state'))
      next = state ? { kind: 'state', state } : { kind: 'unreadable' }
    } catch {
      next = { kind: 'unreadable' }
    }
    return news.current === asked ? next : null
  }, [services])
  const read = useCallback(async () => {
    const next = await ask()
    if (next) setView(next)
  }, [ask])

  useEffect(() => {
    let stopped = false
    let unlisten: (() => void) | undefined
    services
      .listen(PROFILE_STATE_EVENT, (event) => {
        const state = parseProfileState(event.payload)
        if (!state || stopped) return
        news.current += 1
        setView({ kind: 'state', state })
      })
      .then(
        (stop) => {
          if (stopped) stop()
          else unlisten = stop
        },
        () => undefined,
      )
    void ask().then((next) => {
      if (next && !stopped) setView(next)
    })
    return () => {
      stopped = true
      unlisten?.()
    }
  }, [services, ask])

  const pendingRef = useRef<Pending | null>(null)
  const askPendingWork = useCallback(
    (request: PendingWorkRequest) =>
      new Promise<PendingWorkAnswer>((resolve) => {
        // A newer question replaces an open one; the open one is kept.
        pendingRef.current?.resolve('keep')
        const entry: Pending = {
          request,
          resolve: (answer) => {
            if (answer === 'show') services.openPath('/sync/outbox')
            resolve(answer)
          },
        }
        pendingRef.current = entry
        setPending(entry)
      }),
    [services],
  )
  const answerPending = (answer: PendingWorkAnswer) => {
    const entry = pendingRef.current
    pendingRef.current = null
    setPending(null)
    entry?.resolve(answer)
  }

  useEffect(() => {
    const desktop = services.platform?.desktop
    if (!desktop) return undefined
    desktop.setPendingWorkHandler(async (work) => {
      const answer = await askPendingWork({ action: work.action, outbox: work.outbox, conflicts: work.conflicts })
      return answer === 'discard' ? 'discard' : 'keep'
    })
    return () => {
      desktop.setPendingWorkHandler(null)
    }
  }, [services, askPendingWork])

  const state = view.kind === 'state' ? view.state : undefined
  const profileId = state?.profile_id ?? undefined
  useEffect(() => {
    if (profileId === undefined) return
    const before = shownProfile.current
    shownProfile.current = profileId
    if (before !== undefined && before !== profileId) {
      services.session.end()
      void services.platform?.desktop.refreshProfile()
    }
  }, [profileId, services])

  const context = useMemo<AccountContextValue>(
    () => ({
      ...services,
      askPendingWork,
      reloadState: read,
      profileChanged: async () => {
        services.session.end()
        await services.platform?.desktop.refreshProfile()
        await read()
      },
    }),
    [services, askPendingWork, read],
  )

  return (
    <AccountContext.Provider value={context}>
      <GateBody
        view={view}
        td={td}
        onRetry={() => {
          setView({ kind: 'loading' })
          void read()
        }}
      >
        {children}
      </GateBody>
      <PendingWorkDialog request={pending?.request ?? null} canShow={showsApp(view)} onAnswer={answerPending} />
    </AccountContext.Provider>
  )
}

/** The web app (and its router, which can open the outbox) is on screen. */
function showsApp(view: View): boolean {
  if (view.kind !== 'state') return false
  const { phase, error } = view.state
  return (phase === 'ready' || phase === 'engineless') && error?.code !== 'STORE_KEY_INVALID'
}

function GateBody({
  view,
  onRetry,
  td,
  children,
}: {
  view: View
  onRetry: () => void
  td: ReturnType<typeof useTd>
  children: ReactNode
}) {
  if (view.kind === 'loading') return <Splash text={td('account.gate.starting')} />
  const unreadable = (
    <GateFrame testId="account-gate-unreadable">
      <div role="alert" className="space-y-3">
        <p className="text-sm text-muted-foreground">{td('account.gate.loadFailed')}</p>
        <Button variant="secondary" onClick={onRetry}>
          {td('account.gate.retry')}
        </Button>
      </div>
    </GateFrame>
  )
  if (view.kind === 'unreadable') return unreadable
  const { state } = view
  const code = state.error?.code
  if (state.phase === 'starting') return <Splash text={td('account.gate.starting')} />
  if (state.phase === 'none') return <ProfilesPage firstRun />
  if ((state.phase === 'failed' || state.phase === 'engineless') && code === 'STORE_KEY_INVALID') {
    return <StoreKeyRecovery profileId={state.profile_id ?? ''} />
  }
  if (state.phase === 'failed') {
    if (code === 'PROFILE_RECORD_MALFORMED') return <MalformedRecovery profileId={state.profile_id ?? ''} />
    if (code === 'PROFILES_FILE_INVALID') return <ProfilesFileRecovery message={state.error?.message ?? ''} />
    return <FailedProfile error={state.error} />
  }
  if (!showsApp(view)) return unreadable
  return <Fragment key={state.profile_id ?? ''}>{children}</Fragment>
}
