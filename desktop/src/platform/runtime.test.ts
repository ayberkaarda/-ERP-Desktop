import { describe, expect, it, vi } from 'vitest'

// The Tauri modules are replaced: no test talks to a real Tauri runtime.
const tauri = vi.hoisted(() => ({
  invoke: vi.fn((command: string) =>
    Promise.resolve(command === 'profile_list' ? { active_id: null, profiles: [] } : undefined),
  ),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: tauri.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: tauri.listen }))
vi.mock('sonner', () => ({ toast: {} }))

import { createPlatform } from './runtime'

describe('createPlatform (desktop runtime)', () => {
  it('builds the desktop platform on the real Tauri invoke and listen', async () => {
    const platform = createPlatform({
      getCompanyId: () => null,
      getLocale: () => 'tr',
      getSessionGeneration: () => 0,
      onAuthFailure: () => undefined,
    })
    expect(platform.kind).toBe('desktop')
    expect(platform.session?.passwordChange).toBe('external')
    await Promise.resolve()
    expect(tauri.invoke).toHaveBeenCalledWith('profile_list', undefined)
    expect(tauri.listen.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(['engine-event', 'realtime-event'])
  })
})
