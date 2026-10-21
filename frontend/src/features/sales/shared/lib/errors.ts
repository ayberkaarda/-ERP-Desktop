import { isApiError } from '@/platform'
import type { CreditBreakdown } from '../types'

export const VERSION_CONFLICT = 'VERSION_CONFLICT'
export const CREDIT_LIMIT_EXCEEDED = 'sales.credit_limit_exceeded'

/** Someone else saved the document first (409 VERSION_CONFLICT from HasVersion). */
export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && error.code === VERSION_CONFLICT
}

export function isCreditLimitExceeded(error: unknown): boolean {
  return isApiError(error) && error.code === CREDIT_LIMIT_EXCEEDED
}

const DECIMAL = /^-?\d+(?:\.\d+)?$/

/**
 * The breakdown of a credit block. The platform error keeps only `errors.fields` (string lists),
 * so the API is asked to put limit / exposure / document / currency there; anything missing is
 * null and the dialog falls back to GET /customers/{id}/exposure.
 */
export function readCreditBreakdown(error: unknown): CreditBreakdown {
  const fields = isApiError(error) ? error.fields : {}
  const num = (key: string) => {
    const v = fields[key]?.[0]
    return v !== undefined && DECIMAL.test(v) ? v : null
  }
  const currency = fields.currency?.[0]
  return {
    limit: num('limit'),
    exposure: num('exposure'),
    document: num('document'),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
  }
}

/** Server text for toasts; the API localizes messages via Accept-Language. */
export function errorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) && error.message) return error.message
  return fallback
}
