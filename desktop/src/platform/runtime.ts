// Desktop counterpart of the web `frontend/src/platform/runtime.ts`: the desktop
// build swaps that module for this one (same `createPlatform(deps)` signature).
// The only file that binds the real Tauri `invoke` and `listen`.
//
// Types come from `@/platform/types`, not from `@/platform`, whose index.ts
// imports this module.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { createDesktopPlatform } from './desktop'
import type { Platform, PlatformDeps } from '@/platform/types'

export function createPlatform(deps: PlatformDeps): Platform {
  return createDesktopPlatform({ deps, invoke, listen })
}
