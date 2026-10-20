import i18n from '@/lib/i18n'
import { useCompanyStore } from '@/stores/company'
import type { AuthFailure } from './types'
import { createWebPlatform } from './web'
import { reverbConfigFromEnv } from './web/realtime'

export * from './types'
export { createIdempotencyKey, isStaleRequest, withIdempotency } from './web/http'

let authFailureHandler: ((failure: AuthFailure) => void) | null = null
let sessionGeneration = 0

/** The auth feature registers how session failures are handled (clear stores, redirect). */
export function setAuthFailureHandler(handler: ((failure: AuthFailure) => void) | null) {
  authFailureHandler = handler
}

export function getSessionGeneration(): number {
  return sessionGeneration
}

/** Marks the end of a session; work started before it must not touch the next one. */
export function bumpSessionGeneration(): number {
  sessionGeneration += 1
  return sessionGeneration
}

// Single runtime selection point; the desktop shell will provide its own adapter here.
export const platform = createWebPlatform({
  getCompanyId: () => useCompanyStore.getState().activeCompanyId,
  getLocale: () => i18n.language,
  getSessionGeneration,
  onAuthFailure: (failure) => authFailureHandler?.(failure),
  reverb: reverbConfigFromEnv(import.meta.env),
})
