// What the account screens need from outside: the shell bridge, the desktop
// platform (pending-work handler, active profile) and the web session. The
// gate provides them; tests hand in the fake bridge.

import { createContext, useContext } from 'react'

import type { Listen } from '../../bridge/events'
import type { Invoke } from '../../bridge/invoke'
import type { DesktopPlatform } from '../../platform'
import type { SessionUser } from '@/stores/auth'

/** The web session functions the account flows call (features/auth/session). */
export interface WebSession {
  /** Reads /auth/me into the web stores (fresh). */
  load(): Promise<SessionUser | null>
  /** Drops the signed-in user from the web stores. */
  end(): void
  /** Signs out through the platform session (asks about unsent work). */
  signOut(): Promise<void>
  /** A same-app path to go to after sign-in, or "/". */
  safeRedirect(target: unknown): string
}

export interface AccountServices {
  invoke: Invoke
  listen: Listen
  platform: DesktopPlatform | null
  session: WebSession
  /** Goes to an app path from outside the router (the gate's own screens). */
  openPath(path: string): void
}

/** Why unsent work is about to be deleted. */
export type PendingAction = 'logout' | 'switchCompany' | 'removeProfile' | 'resetProfile'

export interface PendingWorkRequest {
  action: PendingAction
  outbox: number | undefined
  conflicts: number | undefined
}

/** `show` keeps the work and opens the outbox. */
export type PendingWorkAnswer = 'discard' | 'keep' | 'show'

export interface AccountContextValue extends AccountServices {
  /** Shows the pending-work dialog; resolves with the user's choice. */
  askPendingWork(request: PendingWorkRequest): Promise<PendingWorkAnswer>
  /** Reads the profile state again (after a profile action of this UI). */
  reloadState(): Promise<void>
  /** After select, reset or remove: the web session and active profile follow. */
  profileChanged(): Promise<void>
}

export const AccountContext = createContext<AccountContextValue | null>(null)

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext)
  if (!value) throw new Error('account screens need the desktop AppGate around them')
  return value
}

/** The account context, or null outside the desktop window's gate. */
export function useOptionalAccount(): AccountContextValue | null {
  return useContext(AccountContext)
}
