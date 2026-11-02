import { describe, expect, it, vi } from 'vitest'

import { createFakeBridge } from '../test/fakeBridge'
import { createDesktopPlatform } from '../platform'
import { syncDepsOf } from './deps'
import type { Platform } from '@/platform/types'

vi.mock('sonner', () => ({ toast: {} }))

const deps = {
  getCompanyId: () => 'c-1',
  getLocale: () => 'tr',
  getSessionGeneration: () => 0,
  onAuthFailure: () => undefined,
}

function desktopPlatform() {
  const bridge = createFakeBridge({
    commands: {
      profile_list: () => ({ active_id: null, profiles: [] }),
      sync_status: () => ({}),
      realtime_status: () => ({ profile_id: null, state: 'idle' }),
    },
  })
  return { bridge, platform: createDesktopPlatform({ deps, invoke: bridge.invoke, listen: bridge.listen }) }
}

describe('syncDepsOf', () => {
  it('takes connectivity, http, notify and the offline meta of the desktop platform', () => {
    const { platform } = desktopPlatform()
    const found = syncDepsOf(platform)
    expect(found.connectivity).toBe(platform.connectivity)
    expect(found.http).toBe(platform.http)
    expect(found.notify).toBe(platform.notify)
    expect(found.offlineMeta).toBe(platform.desktop.offlineMeta)
    platform.desktop.dispose()
  })

  it('has no bridge until the platform offers one', () => {
    const { platform } = desktopPlatform()
    expect(syncDepsOf(platform).bridge).toBeNull()
    platform.desktop.dispose()
  })

  it('takes the bridge the platform offers', () => {
    const { bridge, platform } = desktopPlatform()
    const offered = { invoke: bridge.invoke, listen: bridge.listen }
    Object.assign(platform.desktop, { bridge: offered })
    expect(syncDepsOf(platform).bridge).toEqual(offered)
    Object.assign(platform.desktop, { bridge: { invoke: 'no' } })
    expect(syncDepsOf(platform).bridge).toBeNull()
    platform.desktop.dispose()
  })

  it('a web platform gives no bridge and no offline meta', () => {
    const web = { kind: 'web', connectivity: {}, http: {}, notify: {}, realtime: {} } as unknown as Platform
    expect(syncDepsOf(web)).toMatchObject({ bridge: null, offlineMeta: null })
  })
})
