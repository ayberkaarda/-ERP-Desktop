import { fileURLToPath } from 'node:url'

import type { ModuleSwap } from './moduleSwap'

const frontendSrc = (path: string) => fileURLToPath(new URL(`../../frontend/src/${path}`, import.meta.url))
const desktopSrc = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url))

/**
 * The two web modules the desktop bundle replaces. Everything else of the web
 * app is bundled as it is (frontend/ is never edited here).
 */
export const DESKTOP_SWAPS: readonly ModuleSwap[] = [
  // createPlatform(deps): Tauri commands and events instead of axios and Echo.
  { replaced: frontendSrc('platform/runtime.ts'), by: desktopSrc('platform/runtime.ts') },
  // appExtensions: desktop pages and slots.
  { replaced: frontendSrc('app/extensions.tsx'), by: desktopSrc('app/extensions.tsx') },
]
