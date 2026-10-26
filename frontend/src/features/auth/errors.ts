import type { TFunction } from 'i18next'
import { isApiError } from '@/platform'

// ErrorCode -> message key. Unlisted codes fall back to the (already localized) server message.
const CODE_KEYS = {
  TOO_MANY_ATTEMPTS: 'auth.errors.tooManyAttempts',
  INVALID_TWO_FACTOR_CODE: 'auth.errors.invalidCode',
  USER_DEACTIVATED: 'auth.errors.deactivated',
  UNAUTHENTICATED: 'auth.errors.invalidCredentials',
  INVALID_CREDENTIALS: 'auth.errors.invalidCredentials',
  TWO_FACTOR_REQUIRED: 'auth.errors.twoFactorRequired',
  NETWORK_ERROR: 'auth.errors.network',
  SERVER_ERROR: 'auth.errors.server',
} as const

export function errorMessage(error: unknown, t: TFunction): string {
  if (!isApiError(error)) return t('auth.errors.generic')
  const key = CODE_KEYS[error.code as keyof typeof CODE_KEYS] as string | undefined
  if (key) return t(key as (typeof CODE_KEYS)[keyof typeof CODE_KEYS])
  if (error.status >= 500) return t('auth.errors.server')
  return error.message || t('auth.errors.generic')
}

/** First server message per field, for forms mapping 422 VALIDATION_ERROR onto inputs. */
export function serverFieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error)) return {}
  const out: Record<string, string> = {}
  for (const [field, messages] of Object.entries(error.fields)) {
    if (messages[0]) out[field] = messages[0]
  }
  return out
}
