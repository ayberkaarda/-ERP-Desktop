import { createKeyStore } from '@/features/sales/shared/lib/idempotency'

const store = createKeyStore()

/**
 * Idempotency keys of creating requests (drafts, conversions) by company + action + payload, kept
 * at module level until the request is known to have succeeded: leaving the page after a lost
 * response and submitting the same thing again replays instead of creating a second document.
 */
export const createKeys = {
  keyFor: (company: string, action: string, payload: unknown): string =>
    store.keyFor({ company, action, payload }),
  release: (company: string, action: string, payload: unknown): void =>
    store.release({ company, action, payload }),
}
