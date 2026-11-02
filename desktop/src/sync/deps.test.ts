import { describe, expect, it, vi } from 'vitest'

import { flush } from '../test/fakeBridge'
import { createFreshnessTracker } from './freshness'
import { syncDepsOf } from './deps'
import { createSyncStore } from './store'
import type { Platform } from '@/platform/types'

// Only Tauri is fake: the platform is the one the window builds (runtime.ts).
const tauri = vi.hoisted(() => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>()
  const answers: Record<string, (args: Record<string, unknown> | undefined) => unknown> = {}
  return {
    handlers,
    answers,
    invoke: vi.fn((command: string, args?: Record<string, unknown>) => {
      const answer = answers[command]
      return answer ? Promise.resolve(answer(args)) : Promise.reject(new Error(`no ${command}`))
    }),
    listen: vi.fn((event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(event, handler)
      return Promise.resolve(() => {
        handlers.delete(event)
      })
    }),
  }
})
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }))
vi.mock('sonner', () => ({ toast: {} }))

import { createPlatform } from '@/platform/runtime'

const STATUS = {
  state: 'idle',
  pending: 2,
  conflicts: 0,
  rejected: 0,
  quarantined: 0,
  failures: 0,
  manifest_mismatch: false,
}

function realPlatform() {
  Object.assign(tauri.answers, {
    profile_list: () => ({ active_id: 'p1', profiles: [] }),
    sync_status: () => STATUS,
    realtime_status: () => ({ profile_id: 'p1', state: 'connected' }),
    api_request: () => ({
      status: 200,
      headers: [['content-type', 'application/json']],
      body: { kind: 'json', value: { data: [], meta: { offline: { stale: true, partial: false } } } },
      source: 'local',
    }),
  })
  return createPlatform({
    getCompanyId: () => 'c-1',
    getLocale: () => 'tr',
    getSessionGeneration: () => 0,
    onAuthFailure: () => undefined,
  })
}

describe('syncDepsOf', () => {
  it('takes the bridge, connectivity, http, notify and offline meta of the desktop platform', () => {
    const platform = realPlatform()
    if (platform.kind !== 'desktop' || !('desktop' in platform)) throw new Error('not desktop')
    const found = syncDepsOf(platform)
    const desktop = (platform as unknown as { desktop: { bridge: unknown; offlineMeta: unknown } }).desktop
    expect(found.bridge).toBe(desktop.bridge)
    expect(found.offlineMeta).toBe(desktop.offlineMeta)
    expect(found.connectivity).toBe(platform.connectivity)
    expect(found.http).toBe(platform.http)
    expect(found.notify).toBe(platform.notify)
  })

  it('a web platform gives no bridge and no offline meta', () => {
    const web = { kind: 'web', connectivity: {}, http: {}, notify: {}, realtime: {} } as unknown as Platform
    expect(syncDepsOf(web)).toMatchObject({ bridge: null, offlineMeta: null })
  })

  it('the sync store runs on the bridge of the real platform', async () => {
    const deps = syncDepsOf(realPlatform())
    if (!deps.bridge) throw new Error('no bridge')
    const store = createSyncStore(deps.bridge)
    store.start()
    await flush()
    expect(store.getState()).toMatchObject({ profileId: 'p1', realtime: 'connected', status: { pending: 2 } })
    tauri.handlers.get('engine-event')?.({
      payload: { type: 'status', profile_id: 'p1', status: { ...STATUS, pending: 7 } },
    })
    expect(store.getState().status?.pending).toBe(7)
    store.dispose()
  })

  it('a local answer of the real http client reaches the freshness tracker with its path', async () => {
    const platform = realPlatform()
    const deps = syncDepsOf(platform)
    if (!deps.offlineMeta) throw new Error('no offline meta')
    const tracker = createFreshnessTracker(deps.offlineMeta)
    const stop = tracker.start()
    await platform.http.get('/parties')
    expect(tracker.current()).toMatchObject({ stale: true, partial: false })
    stop()
  })
})
