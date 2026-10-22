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
 * The breakdown of a credit block from `errors.details` (mode, limit, currency, exposure,
 * document, total, available; amounts in the risk currency). Anything missing is null and the
 * dialog falls back to GET /customers/{id}/exposure.
 */
export function readCreditBreakdown(error: unknown): CreditBreakdown {
  const details = isApiError(error) ? error.details : {}
  const num = (key: string) => {
    const v = details[key]
    const text = typeof v === 'number' ? String(v) : v
    return typeof text === 'string' && DECIMAL.test(text) ? text : null
  }
  const currency = details.currency
  const mode = details.mode
  return {
    mode: typeof mode === 'string' ? mode : null,
    limit: num('limit'),
    exposure: num('exposure'),
    document: num('document'),
    total: num('total'),
    available: num('available'),
    currency: typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null,
  }
}

/** Server text for toasts; the API localizes messages via Accept-Language. */
export function errorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) && error.message) return error.message
  return fallback
}
