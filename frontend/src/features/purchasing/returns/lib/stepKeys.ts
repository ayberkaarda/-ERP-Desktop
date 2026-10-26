import { createKeyStore } from '@/features/sales/shared/lib/idempotency'

/** Step keys by payload across instances: a retry after a lost response replays the step. */
export const returnStepKeys = createKeyStore()
