import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { flush } from '../../test/fakeBridge'
import { syncDepsOf } from '../../sync'
import { SyncHeader } from './SyncHeader'
import { renderSync } from './testing'

// The platform the window builds (runtime.ts); only Tauri is fake.
const tauri = vi.hoisted(() => ({
  invoke: vi.fn((command: string) => {
    const answers: Record<string, unknown> = {
      profile_list: { active_id: 'p1', profiles: [] },
      realtime_status: { profile_id: 'p1', state: 'connected' },
      sync_status: {
        state: 'idle',
        pending: 3,
        conflicts: 0,
        rejected: 0,
        quarantined: 0,
        failures: 0,
        manifest_mismatch: false,
      },
      api_request: {
        status: 200,
        headers: [['content-type', 'application/json']],
        body: {
          kind: 'json',
          value: { data: [], meta: { offline: { stale: true, partial: false, unsupported_filters: ['search'] } } },
        },
        source: 'local',
      },
    }
    return command in answers ? Promise.resolve(answers[command]) : Promise.reject(new Error(`no ${command}`))
  }),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }))
vi.mock('sonner', () => ({ toast: {} }))

import { createPlatform } from '@/platform/runtime'

describe('sync header on the real desktop platform', () => {
  it('shows the badges over the platform bridge and the freshness strip of a local answer', async () => {
    const platform = createPlatform({
      getCompanyId: () => 'c-1',
      getLocale: () => 'tr',
      getSessionGeneration: () => 0,
      onAuthFailure: () => undefined,
    })
    const deps = syncDepsOf(platform)
    await renderSync(
      <div>
        <header>
          <SyncHeader />
        </header>
        <main />
      </div>,
      { bridge: deps.bridge, offlineMeta: deps.offlineMeta, connectivity: deps.connectivity, path: '/parties' },
    )
    await act(flush)
    expect(await screen.findByTestId('sync-pending')).toHaveTextContent('Bekleyen: 3')
    expect(screen.queryByTestId('sync-freshness')).toBeNull()

    await act(async () => {
      await platform.http.get('/parties')
    })
    expect(screen.getByTestId('sync-freshness-stale')).toHaveTextContent('Veriler eski olabilir.')
    expect(screen.getByTestId('sync-freshness-filters')).toHaveTextContent('search')
  })
})
