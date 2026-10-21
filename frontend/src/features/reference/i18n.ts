import { useTranslation } from 'react-i18next'
import i18n from '@/lib/i18n'
import de from '@/lib/i18n/locales/reference/de.json'
import en from '@/lib/i18n/locales/reference/en.json'
import fr from '@/lib/i18n/locales/reference/fr.json'
import tr from '@/lib/i18n/locales/reference/tr.json'

export const REFERENCE_NS = 'reference'

// The namespace registers itself, so the shared i18n bootstrap stays untouched.
const bundles = { tr, en, de, fr }
for (const [lang, bundle] of Object.entries(bundles)) {
  if (!i18n.hasResourceBundle(lang, REFERENCE_NS)) {
    i18n.addResourceBundle(lang, REFERENCE_NS, bundle, true, false)
  }
}

export type RefT = (key: string, options?: Record<string, unknown>) => string

/** Translator for the `reference` namespace (keys are checked by i18n:check, not by the compiler). */
export function useRefT(): RefT {
  const { t } = useTranslation(REFERENCE_NS as never)
  return t as unknown as RefT
}
