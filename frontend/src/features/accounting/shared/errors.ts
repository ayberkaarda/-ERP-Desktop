import { isApiError } from '@/platform'

export const VERSION_CONFLICT = 'VERSION_CONFLICT'

/** Someone else saved the record first (409 VERSION_CONFLICT from HasVersion). */
export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && error.code === VERSION_CONFLICT
}

/** A lost answer (network, 5xx): the request may have been applied. */
export function isUncertain(error: unknown): boolean {
  return !isApiError(error) || error.status === 0 || error.status >= 500
}

/** Server text (localized via Accept-Language) or the given fallback. */
export function errorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) && error.message) return error.message
  return fallback
}

/** First message per field, flattened, for blocks that are not a form. */
export function fieldMessages(error: unknown): string[] {
  if (!isApiError(error)) return []
  return Object.values(error.fields)
    .map((m) => m[0])
    .filter((m): m is string => typeof m === 'string' && m !== '')
}
