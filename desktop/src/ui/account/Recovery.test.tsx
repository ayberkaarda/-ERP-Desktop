import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fail, flush } from '../../test/fakeBridge'
import type { ProfileStateDto } from '../../bridge/generated/ProfileStateDto'
import { harness, PROFILE, READY, renderGate, useTurkish } from './testing'

vi.mock('@/platform/runtime', () => import('./quietRuntime'))

beforeEach(useTurkish)

const LOST_KEY: ProfileStateDto = {
  profile_id: 'p1',
  phase: 'engineless',
  error: { code: 'STORE_KEY_INVALID', message: 'x' },
}
const MALFORMED: ProfileStateDto = {
  profile_id: 'p1',
  phase: 'failed',
  error: { code: 'PROFILE_RECORD_MALFORMED', message: 'x' },
}

/** profile_state answers `first` until a reset or removal went through. */
function recovering(first: ProfileStateDto) {
  let state = first
  const h = harness({
    profile_state: () => state,
    profile_reset: () => {
      state = READY
      return PROFILE
    },
    profile_remove: () => {
      state = { phase: 'none' }
      return null
    },
  })
  return h
}

describe('lost database key (STORE_KEY_INVALID)', () => {
  it('explains that unsent work cannot be counted and deletes nothing by itself', async () => {
    const h = recovering(LOST_KEY)
    renderGate(h)
    await screen.findByRole('heading', { name: 'Yerel veri açılamıyor' })
    expect(screen.getByText(/gönderilmemiş değişiklikler sayılamaz/)).toBeInTheDocument()
    await flush()
    expect(h.bridge.callsOf('profile_reset')).toHaveLength(0)
    expect(h.bridge.callsOf('profile_remove')).toHaveLength(0)
  })

  it('resets only after the profile name was typed, and with force', async () => {
    const h = recovering(LOST_KEY)
    renderGate(h)
    const button = await screen.findByRole('button', { name: 'Bu profilin yerel verisini sıfırla' })
    const input = await screen.findByLabelText(/Onaylamak için profil adını yazın/)
    expect(button).toBeDisabled()

    await userEvent.click(button)
    await userEvent.type(input, 'merkez')
    expect(button).toBeDisabled()
    await userEvent.click(button)
    await userEvent.clear(input)
    await userEvent.type(input, 'Merke')
    expect(button).toBeDisabled()
    expect(h.bridge.callsOf('profile_reset')).toHaveLength(0)

    await userEvent.type(input, 'z')
    expect(button).toBeEnabled()
    await userEvent.click(button)
    await screen.findByText('web app')
    expect(h.bridge.callsOf('profile_reset').map((c) => c.args)).toEqual([{ id: 'p1', force: true }])
    expect(h.session.end).toHaveBeenCalled()
  })

  it('names the profile in the text and the confirmation', async () => {
    renderGate(recovering(LOST_KEY))
    expect(await screen.findByLabelText('Onaylamak için profil adını yazın: Merkez')).toBeInTheDocument()
  })

  it('shows a failed reset and stays', async () => {
    const h = recovering(LOST_KEY)
    h.bridge.handle({ profile_reset: () => fail('PROFILE_BUSY') })
    renderGate(h)
    await userEvent.type(await screen.findByLabelText(/Onaylamak için/), 'Merkez')
    await userEvent.click(screen.getByRole('button', { name: 'Bu profilin yerel verisini sıfırla' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Profilin bir isteği sürüyor')
    expect(screen.queryByText('web app')).not.toBeInTheDocument()
  })
})

describe('malformed session record (PROFILE_RECORD_MALFORMED)', () => {
  it('offers both reset and remove', async () => {
    renderGate(recovering(MALFORMED))
    await screen.findByRole('heading', { name: 'Profil kaydı bozuk' })
    expect(screen.getByRole('button', { name: 'Profili sıfırla' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Profili sil' })).toBeInTheDocument()
  })

  it('reset asks first and then resets the profile', async () => {
    const h = recovering(MALFORMED)
    renderGate(h)
    await userEvent.click(await screen.findByRole('button', { name: 'Profili sıfırla' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(h.bridge.callsOf('profile_reset')).toHaveLength(0)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Profili sıfırla' }))
    await screen.findByText('web app')
    expect(h.bridge.callsOf('profile_reset').map((c) => c.args)).toEqual([{ id: 'p1', force: false }])
  })

  it('remove asks first and then removes the profile', async () => {
    const h = recovering(MALFORMED)
    renderGate(h)
    await userEvent.click(await screen.findByRole('button', { name: 'Profili sil' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Profili sil' }))
    await screen.findByText('Başlamak için bir sunucu adresi ekleyin.')
    expect(h.bridge.callsOf('profile_remove').map((c) => c.args)).toEqual([{ id: 'p1', force: false }])
  })

  it('reset with unsent work asks about it and repeats with force', async () => {
    const h = recovering(MALFORMED)
    let calls = 0
    h.bridge.handle({
      profile_reset: () => {
        calls += 1
        if (calls === 1) fail('PROFILE_HAS_PENDING_WORK', '3 unsent changes and 1 open conflicts')
        h.bridge.handle({ profile_state: () => READY })
        return PROFILE
      },
    })
    renderGate(h)
    await userEvent.click(await screen.findByRole('button', { name: 'Profili sıfırla' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Profili sıfırla' }))
    const pending = await screen.findByRole('alertdialog', { name: 'Gönderilmemiş iş var' })
    expect(pending).toHaveTextContent('3 gönderilmemiş değişiklik, 1 açık çakışma')
    await userEvent.click(within(pending).getByRole('button', { name: 'Yine de devam et (silinir)' }))
    await screen.findByText('web app')
    expect(h.bridge.callsOf('profile_reset').map((c) => c.args)).toEqual([
      { id: 'p1', force: false },
      { id: 'p1', force: true },
    ])
  })
})

describe('other failures', () => {
  it('leads to the server profiles', async () => {
    renderGate(
      harness({
        profile_state: () => ({ profile_id: 'p1', phase: 'failed', error: { code: 'INVALID_SERVER_URL', message: 'x' } }),
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Sunucu profilleri' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Sunucu profilleri' })).toBeInTheDocument()
    })
  })
})
