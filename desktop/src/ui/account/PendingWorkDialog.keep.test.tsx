import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { fail, flush } from '../../test/fakeBridge'
import { harness, renderApp, useTurkish, type Harness } from './testing'

beforeEach(useTurkish)

describe('pending-work dialog keeps the work', () => {
  async function removeBranch(h: Harness) {
    renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Şube' })
    await userEvent.click(within(item).getByRole('button', { name: 'Sil' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }))
    return screen.findByRole('alertdialog', { name: 'Gönderilmemiş iş var' })
  }
  const blocked = () => harness({ profile_remove: (a) => (a?.force ? null : fail('PROFILE_HAS_PENDING_WORK', 'work')) })

  it('"show" in a removal keeps the work and opens the outbox', async () => {
    const h = blocked()
    const dialog = await removeBranch(h)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bekleyen işleri göster' }))
    await waitFor(() => {
      expect(h.openPath).toHaveBeenCalledWith('/sync/outbox')
    })
    await flush()
    expect(h.bridge.callsOf('profile_remove')).toHaveLength(1)
  })

  it('closing the dialog with Escape keeps the work', async () => {
    const h = blocked()
    await removeBranch(h)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
    await flush()
    expect(h.bridge.callsOf('profile_remove')).toHaveLength(1)
  })
})
