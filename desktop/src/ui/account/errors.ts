// Shell and server error codes as account text. Only the code is shown: the
// shell message is technical English and never carries form input.

import type { DesktopKey, Td } from '../../i18n'
import type trAccount from '../../i18n/locales/tr/account.json'

type KnownCode = Exclude<keyof (typeof trAccount)['errors'], 'unknown'>

const KNOWN = new Set<string>([
  'INVALID_SERVER_URL',
  'DESKTOP_UPDATE_REQUIRED',
  'SYNC_SCHEMA_MISMATCH',
  'NETWORK_ERROR',
  'PROFILES_FILE_INVALID',
  'PROFILE_BUSY',
  'PROFILE_NOT_FOUND',
  'NO_ACTIVE_PROFILE',
  'EXTERNAL_OPEN_FAILED',
  'COMPANY_NOT_AVAILABLE',
  'INVALID_TWO_FACTOR_CODE',
  'TOO_MANY_ATTEMPTS',
  'USER_DEACTIVATED',
  'UNAUTHENTICATED',
  'VALIDATION_ERROR',
  'PROFILE_HAS_PENDING_WORK',
  'STORE_KEY_INVALID',
  'PROFILE_RECORD_MALFORMED',
] satisfies KnownCode[])

/** The code of a command or API failure (`UNKNOWN` without one). */
export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error
    if (typeof code === 'string' && code !== '') return code
  }
  return 'UNKNOWN'
}

export function errorText(td: Td, error: unknown): string {
  const code = errorCode(error)
  if (KNOWN.has(code)) return td(`account.errors.${code}` as DesktopKey)
  return td('account.errors.unknown', { code })
}

/** Counts of the shell's `PROFILE_HAS_PENDING_WORK` message, when it has them. */
export function parsePendingWork(message: string): { outbox: number | undefined; conflicts: number | undefined } {
  const match = /(\d+) unsent changes and (\d+) open conflicts/.exec(message)
  if (!match) return { outbox: undefined, conflicts: undefined }
  return { outbox: Number(match[1]), conflicts: Number(match[2]) }
}
