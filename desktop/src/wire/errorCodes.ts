// Every error code the window can show, and its `errors.<CODE>` text key.
// scripts/check-desktop-i18n.mjs reads the same three sources, so errors.json
// has exactly these keys in every language.

import type { ShellErrorCode } from '../bridge/generated/ShellErrorCode'
import trErrors from '../i18n/locales/tr/errors.json'
import type { ErrorCode } from './generated/error-codes'

/**
 * Codes the TypeScript side makes up, on top of the server codes
 * (contracts/sync/error-codes.schema.json) and the shell codes (ShellErrorCode):
 * REQUEST_STALE is the web `STALE_REQUEST` (answer of an old session or company),
 * INVALID_URL comes from `assertApiPath`, STREAM_UNAVAILABLE from the assistant
 * when the platform has no `streamPost` (the desktop one has none).
 */
export const ADAPTER_ERROR_CODES = ['REQUEST_STALE', 'INVALID_URL', 'STREAM_UNAVAILABLE'] as const

export type AdapterErrorCode = (typeof ADAPTER_ERROR_CODES)[number]
export type DesktopErrorCode = ErrorCode | ShellErrorCode | AdapterErrorCode
export type TranslatedErrorCode = Extract<keyof typeof trErrors, string>
export type ErrorKey = `errors.${TranslatedErrorCode}`

const TRANSLATED: ReadonlySet<string> = new Set(Object.keys(trErrors))

/** `errors.<code>` for a code with a text, else undefined (show the server message). */
export function errorKey(code: string): ErrorKey | undefined {
  return TRANSLATED.has(code) ? (`errors.${code}` as ErrorKey) : undefined
}
