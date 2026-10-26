import { isApiError } from '@/platform'

// Shared sales HTTP helpers for paging, audit mapping and export parameters.
export {
  errorMessage,
  exportParams,
  fetchAll,
  http,
  isVersionConflict,
  seg,
  toAudit,
} from '@/features/sales/invoices/kit/http'

export const MATCH_FAILED = 'purchasing.match_failed'

/** Block-mode three-way match refused the booking (422 purchasing.match_failed). */
export function isMatchFailed(error: unknown): boolean {
  return isApiError(error) && error.code === MATCH_FAILED
}

/** `errors.details` of a match block, as the dialog reads it (the breakdown of the match). */
export function matchFailureDetails(error: unknown): Record<string, unknown> | null {
  if (!isMatchFailed(error)) return null
  const details = (error as { details?: unknown }).details
  return details && typeof details === 'object' ? (details as Record<string, unknown>) : null
}
