import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { fail } from '../../test/fakeBridge'
import { harness, OTHER, PROFILE, renderApp, useTurkish } from './testing'

beforeEach(useTurkish)

describe('ProfilesPage: retry, address and removal', () => {
  it('offers "try again" only for a busy profile', async () => {
    renderApp(harness({ profile_add: () => fail('INVALID_SERVER_URL') }), '/setup')
    await userEvent.type(await screen.findByLabelText('Sunucu adresi'), 'http://x')
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Tekrar dene' })).not.toBeInTheDocument()
  })

  it('sends the address trimmed', async () => {
    const h = harness({ profile_add: () => OTHER })
    renderApp(h, '/setup')
    await userEvent.type(await screen.findByLabelText('Sunucu adresi'), '  https://erp.example.test  ')
    await userEvent.click(screen.getByRole('button', { name: 'Ekle' }))
    await waitFor(() => {
      expect(h.bridge.callsOf('profile_add')[0]?.args?.url).toBe('https://erp.example.test')
    })
  })

  it('removing the active profile drops the web session', async () => {
    const h = harness({ profile_remove: () => null })
    renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Merkez' })
    await userEvent.click(within(item).getByRole('button', { name: 'Sil' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }))
    await waitFor(() => {
      expect(h.session.end).toHaveBeenCalled()
    })
  })

  it('a removed profile leaves the list', async () => {
    let profiles = [PROFILE, OTHER]
    const h = harness({
      profile_list: () => ({ active_id: 'p1', profiles }),
      profile_remove: (a) => {
        profiles = profiles.filter((p) => p.id !== a?.id)
        return null
      },
    })
    renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Şube' })
    await userEvent.click(within(item).getByRole('button', { name: 'Sil' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }))
    await waitFor(() => {
      expect(screen.queryByRole('listitem', { name: 'Şube' })).not.toBeInTheDocument()
    })
  })
})
