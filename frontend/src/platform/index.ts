import i18n from '@/lib/i18n'
import { useCompanyStore } from '@/stores/company'
import { createPlatform } from './runtime'
import type { AuthFailure } from './types'

export * from './types'
export {
  apiErrorFromEnvelope,
  assertApiPath,
  classifyAuthFailure,
  createIdempotencyKey,
  filenameFromDisposition,
  isPlatformCancelled,
  isStaleRequest,
  PlatformCancelledError,
  readFields,
  STALE_REQUEST,
  withIdempotency,
} from './shared'

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

// Single runtime selection point: ./runtime builds the web adapter; the desktop build swaps
// that module for its own.
export const platform = createPlatform({
  getCompanyId: () => useCompanyStore.getState().activeCompanyId,
  getLocale: () => i18n.language,
  getSessionGeneration,
  onAuthFailure: (failure) => authFailureHandler?.(failure),
})
