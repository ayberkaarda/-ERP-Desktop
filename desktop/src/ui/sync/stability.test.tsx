import { act, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createFakeBridge } from '../../test/fakeBridge'
import { ConflictInboxPage } from './ConflictInboxPage'
import { OutboxPage } from './OutboxPage'
import { SyncHeader } from './SyncHeader'
import { renderSync } from './testing'

// Text helpers are new objects on every render; a hook that depends on one
// re-runs its effect forever. Every command here must run once per screen.
const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)))

describe('sync screens call each command once', () => {
  it('opening reads, lists and subscribes once, and a language change does not repeat them', async () => {
    const bridge = createFakeBridge({
      commands: {
        realtime_status: () => ({ profile_id: 'p', state: 'connected' }),
        sync_status: () => ({
          state: 'failed',
          error_code: 'NETWORK_ERROR',
          pending: 1,
          conflicts: 1,
          rejected: 0,
          quarantined: 0,
          failures: 1,
          retry_after: 30,
          manifest_mismatch: false,
        }),
        outbox_list: () => [],
        conflicts_list: () => [],
      },
    })
    const { i18n } = await renderSync(
      <header>
        <SyncHeader />
        <OutboxPage />
        <ConflictInboxPage />
      </header>,
      { bridge },
    )
    await screen.findByText('Açık çakışma yok.')
    await wait(300)
    const counts = () =>
      Object.fromEntries(
        ['realtime_status', 'sync_status', 'outbox_list', 'conflicts_list', 'sync_now'].map((c) => [
          c,
          bridge.callsOf(c).length,
        ]),
      )
    expect(counts()).toEqual({ realtime_status: 1, sync_status: 1, outbox_list: 1, conflicts_list: 1, sync_now: 0 })
    expect(bridge.listeners('engine-event')).toBe(1)
    expect(bridge.listeners('realtime-event')).toBe(1)

    await act(() => i18n.changeLanguage('en'))
    await wait(300)
    expect(screen.getByTestId('sync-status')).toHaveTextContent('Sync error')
    expect(counts()).toEqual({ realtime_status: 1, sync_status: 1, outbox_list: 1, conflicts_list: 1, sync_now: 0 })
    expect(bridge.listeners('engine-event')).toBe(1)
    expect(bridge.listeners('realtime-event')).toBe(1)
  })
})
