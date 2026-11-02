import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { isPlatformCancelled } from '@/platform/shared'
import { fail } from '../../test/fakeBridge'
import { parsePendingWork } from './errors'
import { harness, renderGate, useTurkish } from './testing'

beforeEach(useTurkish)

function switching() {
  let calls = 0
  return harness({
    sync_status: () => ({
      state: 'idle',
      pending: 2,
      conflicts: 1,
      rejected: 1,
      quarantined: 0,
      failures: 0,
      manifest_mismatch: false,
    }),
    profile_select_company: () => {
      calls += 1
      if (calls === 1) fail('PROFILE_HAS_PENDING_WORK', 'work')
      return null
    },
  })
}

describe('PendingWorkDialog for the platform session', () => {
  it('a company switch with unsent work asks, and discard repeats with force', async () => {
    const h = switching()
    renderGate(h)
    await screen.findByText('web app')
    let done = false
    void h.platform.session.switchCompany('c2').then(() => (done = true))
    const dialog = await screen.findByRole('alertdialog', { name: 'Gönderilmemiş iş var' })
    expect(dialog).toHaveTextContent('3 gönderilmemiş değişiklik, 1 açık çakışma')
    expect(dialog).toHaveTextContent('Şirket değiştiriliyor.')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yine de devam et (silinir)' }))
    await waitFor(() => {
      expect(done).toBe(true)
    })
    expect(h.bridge.callsOf('profile_select_company').map((c) => c.args)).toEqual([
      { company: 'c2', force: false },
      { company: 'c2', force: true },
    ])
  })

  it('keep cancels the switch without a second call', async () => {
    const h = switching()
    renderGate(h)
    await screen.findByText('web app')
    let outcome: unknown
    void h.platform.session.switchCompany('c2').catch((e: unknown) => (outcome = e))
    await userEvent.click(await screen.findByRole('button', { name: 'Vazgeç' }))
    await waitFor(() => {
      expect(isPlatformCancelled(outcome)).toBe(true)
    })
    expect(h.bridge.callsOf('profile_select_company')).toHaveLength(1)
    expect(h.openPath).not.toHaveBeenCalled()
  })

  it('the gate gives up the handler when it goes away', async () => {
    const h = switching()
    const view = renderGate(h)
    await screen.findByText('web app')
    view.unmount()
    await expect(h.platform.session.switchCompany('c2')).rejects.toMatchObject({ code: 'PROFILE_HAS_PENDING_WORK' })
  })
})

describe('parsePendingWork', () => {
  it('reads the counts of the shell message', () => {
    expect(parsePendingWork('7 unsent changes and 3 open conflicts')).toEqual({ outbox: 7, conflicts: 3 })
  })

  it('leaves unknown counts empty', () => {
    expect(parsePendingWork('unsent work')).toEqual({ outbox: undefined, conflicts: undefined })
  })
})
