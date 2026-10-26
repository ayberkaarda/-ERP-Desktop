import { createKeyStore } from '@/features/sales/shared/lib/idempotency'

/**
 * Keys of book requests by payload, kept across dialog instances: a retry after a lost response
 * (same invoice, version and override reason) replays instead of booking twice.
 */
export const bookKeys = createKeyStore()

/** Shortest accepted override reason (audited on the invoice). */
export const OVERRIDE_MIN = 5
