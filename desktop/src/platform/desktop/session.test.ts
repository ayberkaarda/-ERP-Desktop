import { describe, expect, it, vi } from 'vitest'

import { createFakeBridge, deferred, fail, flush, type CommandHandler } from '../../test/fakeBridge'
import { createDesktopSession, PendingWorkError, type PendingWorkDecision, type PendingWorkHandler } from './session'
import { isPlatformCancelled, PlatformCancelledError } from '@/platform/shared'
import { ApiError } from '@/platform/types'

function setup(commands: Record<string, CommandHandler> = {}, decision?: PendingWorkDecision) {
  const bridge = createFakeBridge({ commands })
  const steps: string[] = []
  const handler = vi.fn<PendingWorkHandler>((work) => {
    steps.push(`ask ${work.action} ${String(work.outbox)}/${String(work.conflicts)}`)
    return Promise.resolve(decision ?? 'keep')
  })
  const session = createDesktopSession({
    invoke: bridge.invoke,
    pendingWork: () => (decision ? handler : undefined),
    onChanged: () => steps.push('changed'),
  })
  return { bridge, session, steps, handler }
}

const counts = { state: 'idle', pending: 2, conflicts: 1, rejected: 1, quarantined: 0, failures: 0, manifest_mismatch: false }

/** auth_sign_out answering pending_work without force and done with it. */
const guardedSignOut: CommandHandler = (args) =>
  (args as { force: boolean }).force ? { status: 'done', server_revoked: true } : { status: 'pending_work', outbox: 3, conflicts: 2 }

describe('desktop session', () => {
  it('manages passwords outside the app', () => {
    expect(setup().session.passwordChange).toBe('external')
  })

  it('logout signs out without force and resolves on done', async () => {
    const s = setup({ auth_sign_out: () => ({ status: 'done', server_revoked: true }) }, 'discard')
    await expect(s.session.logout()).resolves.toBeUndefined()
    expect(s.bridge.calls).toEqual([{ command: 'auth_sign_out', args: { force: false } }])
    expect(s.handler).not.toHaveBeenCalled()
    expect(s.steps).toEqual(['changed'])
  })

  it('logout with unsent work asks, then signs out with force on discard', async () => {
    const s = setup({ auth_sign_out: guardedSignOut }, 'discard')
    await expect(s.session.logout()).resolves.toBeUndefined()
    expect(s.bridge.calls.map((c) => c.args)).toEqual([{ force: false }, { force: true }])
    expect(s.steps).toEqual(['ask logout 3/2', 'changed'])
  })

  it('logout with unsent work kept rejects with PlatformCancelledError and changes nothing', async () => {
    const s = setup({ auth_sign_out: guardedSignOut }, 'keep')
    const error = await s.session.logout().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PlatformCancelledError)
    expect(isPlatformCancelled(error)).toBe(true)
    expect(s.bridge.calls).toHaveLength(1)
    expect(s.steps).toEqual(['ask logout 3/2'])
  })

  it('without a handler, pending work is a PendingWorkError (an ApiError with the counts)', async () => {
    const s = setup({ auth_sign_out: guardedSignOut })
    const error = await s.session.logout().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PendingWorkError)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ outbox: 3, conflicts: 2, code: 'PROFILE_HAS_PENDING_WORK', status: 409, details: { outbox: 3, conflicts: 2 } })
    expect(s.bridge.calls).toHaveLength(1)
    expect(s.steps).toEqual([])
  })

  it('a handler that fails is a real failure, not a cancel', async () => {
    const s = setup({ auth_sign_out: guardedSignOut }, 'discard')
    s.handler.mockRejectedValueOnce(new Error('dialog broke'))
    const error = await s.session.logout().catch((e: unknown) => e)
    expect(isPlatformCancelled(error)).toBe(false)
    expect(error).toMatchObject({ message: 'dialog broke' })
    expect(s.bridge.calls).toHaveLength(1)
  })

  it('a failed sign-out rejects with an ApiError', async () => {
    const s = setup({ auth_sign_out: () => fail('NO_ACTIVE_PROFILE', 'none') }, 'discard')
    await expect(s.session.logout()).rejects.toMatchObject({ status: 401, code: 'NO_ACTIVE_PROFILE', message: 'none' })
    expect(s.steps).toEqual([])
  })

  it('switchCompany waits for the shell, then clears local state, then resolves', async () => {
    const answer = deferred<unknown>()
    const s = setup({ profile_select_company: () => answer.promise })
    let resolved = false
    const pending = s.session.switchCompany('c2').then(() => {
      s.steps.push('resolved')
      resolved = true
    })
    await flush()
    expect(s.bridge.calls).toEqual([{ command: 'profile_select_company', args: { company: 'c2', force: false } }])
    expect(resolved).toBe(false)
    expect(s.steps).toEqual([])
    answer.resolve({ company_required: false })
    await pending
    expect(s.steps).toEqual(['changed', 'resolved'])
  })

  const guardedSelect: CommandHandler = (args) => {
    if ((args as { force?: boolean }).force) return { company_required: false }
    return fail('PROFILE_HAS_PENDING_WORK', 'pending')
  }

  it('switchCompany with unsent work asks with the counts and repeats with force on discard', async () => {
    const s = setup({ profile_select_company: guardedSelect, sync_status: () => counts }, 'discard')
    await expect(s.session.switchCompany('c2')).resolves.toBeUndefined()
    expect(s.bridge.callsOf('profile_select_company').map((c) => c.args)).toEqual([
      { company: 'c2', force: false },
      { company: 'c2', force: true },
    ])
    expect(s.steps).toEqual(['ask switchCompany 3/1', 'changed'])
  })

  it('switchCompany with unsent work kept is cancelled and keeps the company', async () => {
    const s = setup({ profile_select_company: guardedSelect, sync_status: () => counts }, 'keep')
    await expect(s.session.switchCompany('c2')).rejects.toBeInstanceOf(PlatformCancelledError)
    expect(s.bridge.callsOf('profile_select_company')).toHaveLength(1)
    expect(s.steps).toEqual(['ask switchCompany 3/1'])
  })

  it('pending work without readable counts still asks', async () => {
    const s = setup({ profile_select_company: guardedSelect, sync_status: () => fail('ENGINE_UNAVAILABLE') }, 'keep')
    await expect(s.session.switchCompany('c2')).rejects.toBeInstanceOf(PlatformCancelledError)
    expect(s.steps).toEqual(['ask switchCompany undefined/undefined'])
  })

  it('without a handler a company switch with pending work is a PendingWorkError', async () => {
    const s = setup({ profile_select_company: guardedSelect, sync_status: () => counts })
    const error = await s.session.switchCompany('c2').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PendingWorkError)
    expect(error).toMatchObject({ outbox: 3, conflicts: 1, message: 'pending' })
  })

  it('other switch failures reject once with an ApiError and ask nothing', async () => {
    const s = setup({ profile_select_company: () => fail('COMPANY_NOT_AVAILABLE', 'no') }, 'discard')
    const error = await s.session.switchCompany('c2').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).not.toBeInstanceOf(PendingWorkError)
    expect(error).toMatchObject({ status: 0, code: 'COMPANY_NOT_AVAILABLE' })
    expect(s.handler).not.toHaveBeenCalled()
    expect(s.bridge.callsOf('sync_status')).toEqual([])
  })

  it('a forced switch that still fails is a real failure', async () => {
    const s = setup({
      profile_select_company: (args) => fail((args as { force?: boolean }).force ? 'COMPANY_NOT_AVAILABLE' : 'PROFILE_HAS_PENDING_WORK'),
      sync_status: () => counts,
    }, 'discard')
    const error = await s.session.switchCompany('c2').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: 'COMPANY_NOT_AVAILABLE' })
    expect(s.steps).toEqual(['ask switchCompany 3/1'])
  })

  it('counts pending, rejected and quarantined entries as outbox and conflicts on their own', async () => {
    const s = setup({
      profile_select_company: guardedSelect,
      sync_status: () => ({ ...counts, pending: 2, rejected: 3, quarantined: 5, conflicts: 7 }),
    }, 'keep')
    await expect(s.session.switchCompany('c2')).rejects.toBeInstanceOf(PlatformCancelledError)
    expect(s.handler).toHaveBeenCalledWith({ action: 'switchCompany', outbox: 10, conflicts: 7 })
  })

  it('tells listeners how the server sign-out went, after the change', async () => {
    for (const revoked of [true, false]) {
      const s = setup({ auth_sign_out: () => ({ status: 'done', server_revoked: revoked }) }, 'discard')
      s.session.onSignedOut((outcome) => s.steps.push(`signed out ${String(outcome.serverRevoked)}`))
      await s.session.logout()
      expect(s.steps).toEqual(['changed', `signed out ${String(revoked)}`])
    }
  })

  it('tells listeners after a forced sign-out too', async () => {
    const s = setup({
      auth_sign_out: (args) =>
        (args as { force: boolean }).force
          ? { status: 'done', server_revoked: false }
          : { status: 'pending_work', outbox: 1, conflicts: 0 },
    }, 'discard')
    const seen = vi.fn()
    s.session.onSignedOut(seen)
    await s.session.logout()
    expect(seen).toHaveBeenCalledExactlyOnceWith({ serverRevoked: false })
  })

  it('tells no listener when nothing was signed out, nor one that left', async () => {
    const kept = setup({ auth_sign_out: guardedSignOut }, 'keep')
    const seen = vi.fn()
    kept.session.onSignedOut(seen)
    await kept.session.logout().catch(() => undefined)
    const failed = setup({ auth_sign_out: () => fail('NO_ACTIVE_PROFILE', 'none') }, 'discard')
    failed.session.onSignedOut(seen)
    await failed.session.logout().catch(() => undefined)
    const left = setup({ auth_sign_out: () => ({ status: 'done', server_revoked: false }) }, 'discard')
    left.session.onSignedOut(seen)()
    await left.session.logout()
    expect(seen).not.toHaveBeenCalled()
  })

  it('a failing listener does not fail the completed sign-out nor silence the others', async () => {
    const s = setup({ auth_sign_out: () => ({ status: 'done', server_revoked: false }) }, 'discard')
    const later = vi.fn()
    s.session.onSignedOut(() => {
      throw new Error('listener broke')
    })
    s.session.onSignedOut(later)
    await expect(s.session.logout()).resolves.toBeUndefined()
    expect(later).toHaveBeenCalledExactlyOnceWith({ serverRevoked: false })
    expect(s.steps).toEqual(['changed'])
  })

  it('leaving one listener keeps the others', async () => {
    const s = setup({ auth_sign_out: () => ({ status: 'done', server_revoked: false }) }, 'discard')
    const kept = vi.fn()
    const gone = vi.fn()
    s.session.onSignedOut(kept)
    s.session.onSignedOut(gone)()
    await s.session.logout()
    expect(kept).toHaveBeenCalledExactlyOnceWith({ serverRevoked: false })
    expect(gone).not.toHaveBeenCalled()
  })

  it('a forced sign-out that still reports pending work is not a sign-out', async () => {
    const s = setup({ auth_sign_out: () => ({ status: 'pending_work', outbox: 1, conflicts: 0 }) }, 'discard')
    await expect(s.session.logout()).rejects.toBeInstanceOf(PendingWorkError)
    expect(s.bridge.calls.map((c) => c.args)).toEqual([{ force: false }, { force: true }])
    expect(s.steps).toEqual(['ask logout 1/0'])
  })
})
