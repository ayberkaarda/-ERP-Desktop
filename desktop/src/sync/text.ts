// Desktop text with lookups by a code that is only known at run time: shell and
// server error codes (`desktop.errors.<code>`) and online-only actions
// (`desktop.onlineOnly.<action>`). A code without a translation falls back to
// the code itself; an action without one to the general online-only sentence.

import type { i18n as I18n } from 'i18next'
import { useTranslation } from 'react-i18next'

import { createTd, DESKTOP_NS, type Td } from '../i18n'

export interface DesktopText {
  td: Td
  error(code: string): string
  onlineOnly(action: string): string
}

// The web CustomTypeOptions know only the web namespaces and literal keys; these
// keys are built at run time inside the desktop namespace.
interface LooseI18n {
  exists(key: string, options: { ns: string }): boolean
  t(key: string, options: { ns: string }): string
}

export function createDesktopText(i18n: I18n): DesktopText {
  const td = createTd(i18n)
  const loose = i18n as unknown as LooseI18n
  const lookup = (key: string): string | undefined =>
    loose.exists(key, { ns: DESKTOP_NS }) ? loose.t(key, { ns: DESKTOP_NS }) : undefined
  return {
    td,
    error: (code) => lookup(`errors.${code}`) ?? code,
    onlineOnly: (action) => lookup(`onlineOnly.${action}`) ?? td('sync.onlineOnly.fallback'),
  }
}

/** Re-renders on a language change, like useTranslation. */
export function useDesktopText(): DesktopText {
  const { i18n } = useTranslation()
  return createDesktopText(i18n)
}
