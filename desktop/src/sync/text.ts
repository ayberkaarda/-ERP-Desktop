// Desktop text with lookups by a code that is only known at run time: shell and
// server error codes (`desktop.errors.<code>`, the wire error table) and
// online-only actions (`desktop.onlineOnly.<action>`, the manifest table). A
// code without a text falls back to the code itself; a name outside the
// manifest to the general online-only sentence.

import type { i18n as I18n } from 'i18next'
import { useTranslation } from 'react-i18next'

import { createTd, type Td } from '../i18n'
import { errorKey, ONLINE_ONLY_ACTIONS, onlineOnlyKey, type OnlineOnlyAction } from '../wire'

export interface DesktopText {
  td: Td
  error(code: string): string
  onlineOnly(action: string): string
}

function isAction(action: string): action is OnlineOnlyAction {
  return (ONLINE_ONLY_ACTIONS as readonly string[]).includes(action)
}

export function createDesktopText(i18n: I18n): DesktopText {
  const td = createTd(i18n)
  return {
    td,
    error: (code) => {
      const key = errorKey(code)
      return key ? td(key) : code
    },
    onlineOnly: (action) => td(isAction(action) ? onlineOnlyKey(action) : 'sync.onlineOnly.fallback'),
  }
}

/**
 * Re-renders on a language change, like useTranslation. A new object on every
 * render: never a hook dependency (keep codes in state, translate in render).
 */
export function useDesktopText(): DesktopText {
  const { i18n } = useTranslation()
  return createDesktopText(i18n)
}
