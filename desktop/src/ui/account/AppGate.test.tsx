import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { PROFILE_STATE_EVENT } from './profileState'
import { deferred, fail, flush } from '../../test/fakeBridge'
import type { ProfileStateDto } from '../../bridge/generated/ProfileStateDto'
import { harness, renderGate, useTurkish } from './testing'

beforeEach(useTurkish)

function withState(state: ProfileStateDto) {
  return harness({ profile_state: () => state })
}

describe('AppGate', () => {
  it('shows the splash while the profile starts and not the web app', async () => {
    renderGate(withState({ profile_id: 'p1', phase: 'starting' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Profil açılıyor…')
    expect(screen.queryByText('web app')).not.toBeInTheDocument()
  })

  it('opens the web app when the profile is ready', async () => {
    renderGate(withState({ profile_id: 'p1', phase: 'ready' }))
    expect(await screen.findByText('web app')).toBeInTheDocument()
  })

  it('opens the web app for a profile without its local store (online only)', async () => {
    renderGate(
      withState({ profile_id: 'p1', phase: 'engineless', error: { code: 'STORE_ERROR', message: 'x' } }),
    )
    expect(await screen.findByText('web app')).toBeInTheDocument()
  })

  it('shows the first-run server profile screen when no profile is active', async () => {
    renderGate(withState({ phase: 'none' }))
    expect(await screen.findByRole('heading', { name: 'Sunucu profilleri' })).toBeInTheDocument()
    expect(screen.getByText('Başlamak için bir sunucu adresi ekleyin.')).toBeInTheDocument()
    expect(screen.queryByText('web app')).not.toBeInTheDocument()
  })

  it.each<[string, ProfileStateDto, string]>([
    [
      'a lost database key of the active profile',
      { profile_id: 'p1', phase: 'engineless', error: { code: 'STORE_KEY_INVALID', message: 'x' } },
      'Yerel veri açılamıyor',
    ],
    [
      'a lost database key of a profile that failed',
      { profile_id: 'p1', phase: 'failed', error: { code: 'STORE_KEY_INVALID', message: 'x' } },
      'Yerel veri açılamıyor',
    ],
    [
      'a malformed session record',
      { profile_id: 'p1', phase: 'failed', error: { code: 'PROFILE_RECORD_MALFORMED', message: 'x' } },
      'Profil kaydı bozuk',
    ],
    [
      'an unreadable profile file',
      { phase: 'failed', error: { code: 'PROFILES_FILE_INVALID', message: 'not valid JSON' } },
      'Profil dosyası okunamadı',
    ],
    [
      'any other failure',
      { profile_id: 'p1', phase: 'failed', error: { code: 'INVALID_SERVER_URL', message: 'x' } },
      'Profil açılamadı',
    ],
  ])('shows the recovery screen for %s', async (_name, state, title) => {
    renderGate(withState(state))
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.queryByText('web app')).not.toBeInTheDocument()
  })

  it('says the profile file was left as it is', async () => {
    renderGate(withState({ phase: 'failed', error: { code: 'PROFILES_FILE_INVALID', message: 'not valid JSON' } }))
    expect(await screen.findByText(/profiles\.json/)).toBeInTheDocument()
    expect(screen.getByText(/üzerine yazılmadı/)).toBeInTheDocument()
    expect(screen.getByText(/not valid JSON/)).toBeInTheDocument()
  })

  it('offers a retry when the state cannot be read', async () => {
    let first = true
    const h = harness({
      profile_state: () => {
        if (first) {
          first = false
          fail('TASK_FAILED')
        }
        return { profile_id: 'p1', phase: 'ready' }
      },
    })
    renderGate(h)
    expect(await screen.findByRole('alert')).toHaveTextContent('Profil durumu okunamadı.')
    await userEvent.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByText('web app')).toBeInTheDocument()
    expect(h.bridge.callsOf('profile_state')).toHaveLength(2)
  })

  it('follows the profile-state event', async () => {
    const h = withState({ profile_id: 'p1', phase: 'starting' })
    renderGate(h)
    await screen.findByRole('status')
    act(() => {
      h.bridge.emit(PROFILE_STATE_EVENT, { profile_id: 'p1', phase: 'ready' })
    })
    expect(await screen.findByText('web app')).toBeInTheDocument()
  })

  it('ignores a malformed profile-state event', async () => {
    const h = withState({ profile_id: 'p1', phase: 'starting' })
    renderGate(h)
    await screen.findByRole('status')
    await waitFor(() => {
      expect(h.bridge.listeners(PROFILE_STATE_EVENT)).toBe(1)
    })
    act(() => {
      h.bridge.emit(PROFILE_STATE_EVENT, { profile_id: 'p1', phase: 'exploded' })
      h.bridge.emit(PROFILE_STATE_EVENT, { profile_id: 7, phase: 'ready' })
      h.bridge.emit(PROFILE_STATE_EVENT, { phase: 'ready', error: 'boom' })
      h.bridge.emit(PROFILE_STATE_EVENT, null)
    })
    await flush()
    expect(screen.getByRole('status')).toHaveTextContent('Profil açılıyor…')
    expect(screen.queryByText('web app')).not.toBeInTheDocument()
  })

  it('an event newer than the state answer wins', async () => {
    const answer = deferred<ProfileStateDto>()
    const h = harness({ profile_state: () => answer.promise })
    renderGate(h)
    await waitFor(() => {
      expect(h.bridge.listeners(PROFILE_STATE_EVENT)).toBe(1)
    })
    act(() => {
      h.bridge.emit(PROFILE_STATE_EVENT, { profile_id: 'p1', phase: 'ready' })
    })
    await act(async () => {
      answer.resolve({ profile_id: 'p1', phase: 'starting' })
      await flush()
    })
    expect(screen.getByText('web app')).toBeInTheDocument()
  })

  it('drops the web session of the profile the user left', async () => {
    const h = withState({ profile_id: 'p1', phase: 'ready' })
    renderGate(h)
    await screen.findByText('web app')
    expect(h.session.end).not.toHaveBeenCalled()
    act(() => {
      h.bridge.emit(PROFILE_STATE_EVENT, { profile_id: 'p2', phase: 'ready' })
    })
    await waitFor(() => {
      expect(h.session.end).toHaveBeenCalledTimes(1)
    })
  })

  it('stops listening when it goes away', async () => {
    const h = withState({ profile_id: 'p1', phase: 'ready' })
    const view = renderGate(h)
    await screen.findByText('web app')
    view.unmount()
    await flush()
    expect(h.bridge.listeners(PROFILE_STATE_EVENT)).toBe(0)
  })
})
