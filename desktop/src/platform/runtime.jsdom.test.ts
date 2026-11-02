import { describe, expect, it, vi } from 'vitest'

// No Tauri mock here: the real `@tauri-apps/api` runs in jsdom, where the shell
// internals are missing and every `invoke`/`listen` rejects.
vi.mock('sonner', () => ({ toast: {} }))

import { createPlatform } from './runtime'
import { desktopBridgeOf } from '.'

describe('desktop runtime outside the shell (jsdom)', () => {
  it('builds the platform without an unhandled rejection; the bridge rejects with CommandErrors', async () => {
    expect('__TAURI_INTERNALS__' in window).toBe(false)
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const platform = createPlatform({
        getCompanyId: () => null,
        getLocale: () => 'tr',
        getSessionGeneration: () => 0,
        onAuthFailure: () => undefined,
      })
      const bridge = desktopBridgeOf(platform)
      await expect(bridge?.invoke('profile_state')).rejects.toMatchObject({ name: 'CommandError' })
      await expect(bridge?.listen('profile-state', () => undefined)).rejects.toMatchObject({ name: 'CommandError' })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(platform.connectivity.isOnline()).toBe(true)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
