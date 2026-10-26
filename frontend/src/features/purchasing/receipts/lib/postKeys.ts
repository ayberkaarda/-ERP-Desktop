import { createKeyStore } from '@/features/sales/shared/lib/idempotency'

/** Post keys by payload across dialog instances: a retry after a lost response replays. */
export const postKeys = createKeyStore()
