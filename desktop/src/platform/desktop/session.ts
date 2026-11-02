// `PlatformSession` over the shell's account commands. Unsent local work is
// settled here, not in the web flows: the shell asks the pending-work handler
// (the desktop dialog), then either repeats the command with `force` or rejects
// with `PlatformCancelledError` (the web keeps the session/company, no toast).
// Any other rejection is a real failure (the web shows one error).

import type { ShellErrorCode } from '../../bridge/generated/ShellErrorCode'
import type { SignOutDto } from '../../bridge/generated/SignOutDto'
import type { StatusDto } from '../../bridge/generated/StatusDto'
import { call, toCommandError, type Invoke } from '../../bridge/invoke'
import { commandToApiError } from './errors'
import { PlatformCancelledError } from '@/platform/shared'
import { ApiError, type PlatformSession } from '@/platform/types'

export const PENDING_WORK = 'PROFILE_HAS_PENDING_WORK' satisfies ShellErrorCode

/** What would be lost; counts are unknown when they could not be read. */
export interface PendingWork {
  action: 'logout' | 'switchCompany'
  /** Unsent outbox entries (pending, rejected, quarantined). */
  outbox: number | undefined
  conflicts: number | undefined
}

/** `discard`: go on and delete the work; `keep`: cancel the action. */
export type PendingWorkDecision = 'discard' | 'keep'
export type PendingWorkHandler = (work: PendingWork) => Promise<PendingWorkDecision>

/** Unsent work blocked the action and no handler was there to ask the user. */
export class PendingWorkError extends ApiError {
  readonly outbox: number | undefined
  readonly conflicts: number | undefined

  constructor(message: string, work: PendingWork) {
    super(409, PENDING_WORK, message, {}, { outbox: work.outbox, conflicts: work.conflicts })
    this.name = 'PendingWorkError'
    this.outbox = work.outbox
    this.conflicts = work.conflicts
  }
}

/** How a completed sign-out went on the server. */
export interface SignedOut {
  /** False: the server was not told (offline, no answer in time, refused); the device stays signed in there. */
  serverRevoked: boolean
}

export interface DesktopSession extends PlatformSession {
  passwordChange: 'external'
  /** Called after every completed sign-out (local sign-out is always done by then). */
  onSignedOut(listener: (outcome: SignedOut) => void): () => void
}

export function createDesktopSession(options: {
  invoke: Invoke
  /** The handler in charge now (the desktop dialog registers one). */
  pendingWork?: () => PendingWorkHandler | undefined
  /** After a confirmed sign-out or company switch, before the promise resolves. */
  onChanged?: (action: PendingWork['action']) => void
}): DesktopSession {
  const { invoke, onChanged } = options
  const signedOut = new Set<(outcome: SignedOut) => void>()

  async function counts(): Promise<{ outbox: number | undefined; conflicts: number | undefined }> {
    try {
      const s = await call<StatusDto>(invoke, 'sync_status')
      return { outbox: s.pending + s.rejected + s.quarantined, conflicts: s.conflicts }
    } catch {
      return { outbox: undefined, conflicts: undefined }
    }
  }

  /** Asks the handler; resolves when the user chose to discard the work. */
  async function settle(work: PendingWork, message: string): Promise<void> {
    const handler = options.pendingWork?.()
    if (!handler) throw new PendingWorkError(message, work)
    const decision = await handler(work)
    if (decision !== 'discard') throw new PlatformCancelledError()
  }

  async function signOut(force: boolean): Promise<SignOutDto> {
    try {
      return await call<SignOutDto>(invoke, 'auth_sign_out', { force })
    } catch (reason) {
      throw commandToApiError(toCommandError(reason))
    }
  }

  async function selectCompany(id: string, force: boolean): Promise<void> {
    await call(invoke, 'profile_select_company', { company: id, force })
  }

  return {
    passwordChange: 'external',
    logout: async () => {
      let answer = await signOut(false)
      if (answer.status === 'pending_work') {
        const work: PendingWork = { action: 'logout', outbox: answer.outbox, conflicts: answer.conflicts }
        await settle(work, 'Unsent work would be lost.')
        answer = await signOut(true)
      }
      if (answer.status !== 'done') {
        throw new PendingWorkError('Unsent work would be lost.', {
          action: 'logout',
          outbox: answer.outbox,
          conflicts: answer.conflicts,
        })
      }
      onChanged?.('logout')
      const outcome: SignedOut = { serverRevoked: answer.server_revoked }
      // The sign-out is complete: a failing listener must not turn it into
      // a failure, nor keep the others from hearing about it.
      for (const listener of [...signedOut]) {
        try {
          listener(outcome)
        } catch {
          // ignored: listeners only show the outcome
        }
      }
    },
    onSignedOut: (listener) => {
      signedOut.add(listener)
      return () => {
        signedOut.delete(listener)
      }
    },
    switchCompany: async (id) => {
      try {
        await selectCompany(id, false)
      } catch (reason) {
        const failure = toCommandError(reason)
        if (failure.code !== PENDING_WORK) throw commandToApiError(failure)
        await settle({ action: 'switchCompany', ...(await counts()) }, failure.message)
        try {
          await selectCompany(id, true)
        } catch (again) {
          throw commandToApiError(toCommandError(again))
        }
      }
      onChanged?.('switchCompany')
    },
  }
}
