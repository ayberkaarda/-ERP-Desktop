import type { Platform, PlatformDeps } from './types'
import { createWebPlatform } from './web'
import { reverbConfigFromEnv } from './web/realtime'

/**
 * Runtime selection point. This is the only module that reaches ./web; the desktop build
 * replaces this file with its own `createPlatform` and must keep the same signature.
 */
export function createPlatform(deps: PlatformDeps): Platform {
  return createWebPlatform({ ...deps, reverb: reverbConfigFromEnv(import.meta.env) })
}
