// Test stand-in for the swapped platform runtime: the web `@/platform`
// singleton gets a desktop platform whose shell answers nothing, so importing
// web session code in jsdom does not reach the real Tauri API. Test files use
// it with `vi.mock('@/platform/runtime', () => import('./quietRuntime'))`.

import { createDesktopPlatform } from '../../platform'
import type { Platform, PlatformDeps } from '@/platform/types'

export function createPlatform(deps: PlatformDeps): Platform {
  return createDesktopPlatform({
    deps,
    invoke: () => Promise.reject(new Error('no shell in tests')),
    listen: () => Promise.resolve(() => undefined),
  })
}
