import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Providers } from '@/app/providers'
import type { Listen } from '../../bridge/events'
import type { ProfileStateDto } from '../../bridge/generated/ProfileStateDto'
import { deferred, fail, flush } from '../../test/fakeBridge'
import { AccountGate } from './AppGate'
import { PROFILE_STATE_EVENT } from './profileState'
import { harness, OTHER, renderApp, renderGate, useTurkish, type Harness } from './testing'

beforeEach(useTurkish)

describe('AppGate across profile changes', () => {
  it('remounts the web app when the profile changes', async () => {
    let mounts = 0
    function Child() {
      useEffect(() => {
        mounts += 1
      }, [])
      return <p>web app</p>
    }
    const h = harness()
    renderGate(h, <Child />)
    await screen.findByText('web app')
    expect(mounts).toBe(1)
    act(() => {
      h.bridge.emit(PROFILE_STATE_EVENT, { profile_id: 'p2', phase: 'ready' })
    })
    await waitFor(() => {
      expect(mounts).toBe(2)
    })
  })

  it('an event sent while the state is asked is not lost (listener first)', async () => {
    const box: { h?: Harness } = {}
    box.h = harness({
      profile_state: () => {
        box.h?.bridge.emit(PROFILE_STATE_EVENT, { profile_id: 'p1', phase: 'ready' })
        return { profile_id: 'p1', phase: 'starting' } satisfies ProfileStateDto
      },
    })
    renderGate(box.h)
    expect(await screen.findByText('web app')).toBeInTheDocument()
  })

  it('a listener that resolves after unmount is stopped', async () => {
    const h = harness()
    const gate = deferred<undefined>()
    const listen: Listen = (event, handler) => gate.promise.then(() => h.bridge.listen(event, handler))
    const view = render(
      <Providers>
        <AccountGate services={{ ...h.services, listen }}>
          <p>web app</p>
        </AccountGate>
      </Providers>,
    )
    await screen.findByText('web app')
    view.unmount()
    await act(async () => {
      gate.resolve(undefined)
      await flush()
    })
    expect(h.bridge.listeners(PROFILE_STATE_EVENT)).toBe(0)
  })

  it('a profile switch by event refreshes the platform profile', async () => {
    const h = harness()
    const refresh = vi.spyOn(h.platform.desktop, 'refreshProfile')
    renderGate(h)
    await screen.findByText('web app')
    act(() => {
      h.bridge.emit(PROFILE_STATE_EVENT, { profile_id: 'p2', phase: 'ready' })
    })
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled()
    })
  })

  it('a profile switch from the page refreshes the platform profile', async () => {
    const h = harness({ profile_select: () => OTHER })
    const refresh = vi.spyOn(h.platform.desktop, 'refreshProfile')
    renderApp(h, '/setup')
    const item = await screen.findByRole('listitem', { name: 'Şube' })
    await userEvent.click(within(item).getByRole('button', { name: 'Bu profile geç' }))
    await waitFor(() => {
      expect(refresh).toHaveBeenCalled()
    })
  })

  it('a second question keeps the work of the first one', async () => {
    const h = harness({
      profile_select_company: (args) => (args?.force ? null : fail('PROFILE_HAS_PENDING_WORK', '1 unsent changes and 0 open conflicts')),
    })
    renderGate(h)
    await screen.findByText('web app')
    void h.platform.session.switchCompany('c2').catch(() => undefined)
    await screen.findByRole('alertdialog')
    void h.platform.session.switchCompany('c3').catch(() => undefined)
    await waitFor(() => {
      expect(h.bridge.callsOf('profile_select_company').length).toBeGreaterThanOrEqual(2)
    })
    await flush()
    expect(h.bridge.callsOf('profile_select_company').filter((c) => c.args?.force === true)).toEqual([])
  })
})
