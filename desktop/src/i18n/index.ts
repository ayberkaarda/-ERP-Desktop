import i18next, { type i18n as I18n } from 'i18next'
import { useTranslation } from 'react-i18next'

import deAccount from './locales/de/account.json'
import deErrors from './locales/de/errors.json'
import deOnlineOnly from './locales/de/onlineOnly.json'
import deShell from './locales/de/shell.json'
import deSync from './locales/de/sync.json'
import enAccount from './locales/en/account.json'
import enErrors from './locales/en/errors.json'
import enOnlineOnly from './locales/en/onlineOnly.json'
import enShell from './locales/en/shell.json'
import enSync from './locales/en/sync.json'
import frAccount from './locales/fr/account.json'
import frErrors from './locales/fr/errors.json'
import frOnlineOnly from './locales/fr/onlineOnly.json'
import frShell from './locales/fr/shell.json'
import frSync from './locales/fr/sync.json'
import trAccount from './locales/tr/account.json'
import trErrors from './locales/tr/errors.json'
import trOnlineOnly from './locales/tr/onlineOnly.json'
import trShell from './locales/tr/shell.json'
import trSync from './locales/tr/sync.json'
import type { DesktopKey, DesktopResources, DesktopSection } from './types'

export type { DesktopKey, DesktopResources, DesktopSection } from './types'

// One i18next namespace for all desktop text, kept apart from the web
// namespaces; manifest keys such as "desktop.onlineOnly.<action>" point here.
export const DESKTOP_NS = 'desktop'

export const DESKTOP_LANGUAGES = ['tr', 'en', 'de', 'fr'] as const
export type DesktopLanguage = (typeof DESKTOP_LANGUAGES)[number]

export const DESKTOP_SECTIONS = [
  'shell',
  'sync',
  'account',
  'errors',
  'onlineOnly',
] as const satisfies readonly DesktopSection[]

export const desktopResources: Record<DesktopLanguage, DesktopResources> = {
  tr: {
    shell: trShell,
    sync: trSync,
    account: trAccount,
    errors: trErrors,
    onlineOnly: trOnlineOnly,
  },
  en: {
    shell: enShell,
    sync: enSync,
    account: enAccount,
    errors: enErrors,
    onlineOnly: enOnlineOnly,
  },
  de: {
    shell: deShell,
    sync: deSync,
    account: deAccount,
    errors: deErrors,
    onlineOnly: deOnlineOnly,
  },
  fr: {
    shell: frShell,
    sync: frSync,
    account: frAccount,
    errors: frErrors,
    onlineOnly: frOnlineOnly,
  },
}

// Adds the desktop namespace to an i18next instance that the web app already
// initialised. Safe to call more than once.
export function addDesktopResources(instance: I18n = i18next): void {
  for (const lang of DESKTOP_LANGUAGES) {
    instance.addResourceBundle(lang, DESKTOP_NS, desktopResources[lang], true, true)
  }
}

export type Td = (key: DesktopKey, options?: Record<string, unknown>) => string

// The web CustomTypeOptions only knows the web namespaces, so desktop keys
// are checked against DesktopKey here instead.
type UntypedT = (key: string, options: Record<string, unknown>) => string

export function createTd(instance: I18n): Td {
  const t = instance.t.bind(instance) as unknown as UntypedT
  return (key, options) => t(key, { ...options, ns: DESKTOP_NS })
}

export const td: Td = (key, options) => createTd(i18next)(key, options)

// One td per i18next instance and language, so every caller gets the same
// function until the language changes.
const tdCache = new WeakMap<I18n, { language: string; td: Td }>()

function cachedTd(instance: I18n, language: string): Td {
  const hit = tdCache.get(instance)
  if (hit?.language === language) return hit.td
  const td = createTd(instance)
  tdCache.set(instance, { language, td })
  return td
}

// Re-renders on language change, like useTranslation. The returned function
// is stable: it changes only when the language does, so it is safe in effect
// and callback dependency lists.
export function useTd(): Td {
  const { i18n } = useTranslation()
  // react-i18next hands each hook call its own copy of the instance (new on
  // every language change) and keeps the shared one in __original; key the
  // cache on the shared one so all callers get the same td.
  const shared = (i18n as I18n & { __original?: I18n }).__original ?? i18n
  return cachedTd(shared, i18n.language)
}
