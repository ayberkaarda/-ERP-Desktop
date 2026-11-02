import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ProfileStateDto } from '../../bridge/generated/ProfileStateDto'
import { fail, flush } from '../../test/fakeBridge'
import { harness, PROFILE, renderGate, useTurkish } from './testing'

beforeEach(useTurkish)

function formOf(element: HTMLElement): HTMLFormElement {
  const form = element.closest('form')
  if (!form) throw new Error('not inside a form')
  return form
}

describe('recovery screens: confirmation and outcomes', () => {
  const lostKey = (patch: Partial<ProfileStateDto> = {}) =>
    harness({
      profile_state: () => ({ profile_id: 'p1', phase: 'failed', error: { code: 'STORE_KEY_INVALID', message: 'x' }, ...patch }),
      profile_reset: () => PROFILE,
    })

  it('a lost key without a profile name never accepts an empty confirmation', async () => {
    const h = harness({
      profile_state: () => ({ phase: 'failed', error: { code: 'STORE_KEY_INVALID', message: 'x' } }),
      profile_reset: () => PROFILE,
    })
    renderGate(h)
    const button = await screen.findByRole('button', { name: 'Bu profilin yerel verisini sıfırla' })
    await flush()
    expect(button).toBeDisabled()
    fireEvent.submit(formOf(button))
    await flush()
    expect(h.bridge.callsOf('profile_reset')).toHaveLength(0)
  })

  it('extra text after the name is not a confirmation', async () => {
    renderGate(lostKey())
    const input = await screen.findByLabelText(/Onaylamak için/)
    await userEvent.type(input, 'Merkez2')
    expect(screen.getByRole('button', { name: 'Bu profilin yerel verisini sıfırla' })).toBeDisabled()
  })

  it('submitting the form without the name resets nothing', async () => {
    const h = lostKey()
    renderGate(h)
    const input = await screen.findByLabelText(/Onaylamak için/)
    await userEvent.type(input, 'Merk')
    fireEvent.submit(formOf(input))
    await flush()
    expect(h.bridge.callsOf('profile_reset')).toHaveLength(0)
  })

  const malformed = (extra: Parameters<typeof harness>[0] = {}) =>
    harness({
      profile_state: () => ({ profile_id: 'p1', phase: 'failed', error: { code: 'PROFILE_RECORD_MALFORMED', message: 'x' } }),
      ...extra,
    })

  it('the dialog of a malformed reset names the reset', async () => {
    renderGate(malformed({ profile_reset: (a) => (a?.force ? PROFILE : fail('PROFILE_HAS_PENDING_WORK', 'work')) }))
    await userEvent.click(await screen.findByRole('button', { name: 'Profili sıfırla' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Profili sıfırla' }))
    const pending = await screen.findByRole('alertdialog', { name: 'Gönderilmemiş iş var' })
    expect(pending).toHaveTextContent('Profil sıfırlanıyor.')
  })

  it('a malformed removal kept by the user changes nothing', async () => {
    const h = malformed({ profile_remove: () => fail('PROFILE_HAS_PENDING_WORK', 'work') })
    renderGate(h)
    await userEvent.click(await screen.findByRole('button', { name: 'Profili sil' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Profili sil' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vazgeç' }))
    await flush()
    expect(h.session.end).not.toHaveBeenCalled()
    expect(h.bridge.callsOf('profile_remove')).toHaveLength(1)
  })

  it('the generic failed screen tells the error', async () => {
    renderGate(harness({ profile_state: () => ({ profile_id: 'p1', phase: 'failed', error: { code: 'INVALID_SERVER_URL', message: 'x' } }) }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucu adresi geçersiz.')
  })
})
