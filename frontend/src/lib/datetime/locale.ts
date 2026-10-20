import { useTranslation } from 'react-i18next'

// Bare UI language -> default Intl locale for numbers and dates.
const INTL_LOCALES: Record<string, string> = {
  tr: 'tr-TR',
  en: 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
}

/**
 * A regional language tag ("en-US", "de-CH") is kept as-is when its language is supported and
 * the runtime knows the locale; only a bare language falls back to the default region.
 */
export function intlLocale(language: string | undefined): string {
  const tag = language ?? 'tr'
  const base = tag.split('-')[0]?.toLowerCase() ?? 'tr'
  const fallback = Object.hasOwn(INTL_LOCALES, base) ? INTL_LOCALES[base] : undefined
  if (!fallback) return 'tr-TR'
  if (tag.includes('-')) {
    try {
      const [supported] = Intl.NumberFormat.supportedLocalesOf(tag)
      if (supported) return supported
    } catch {
      // Malformed tag: use the language default.
    }
  }
  return fallback
}

export function useIntlLocale(): string {
  const { i18n } = useTranslation()
  return intlLocale(i18n.language)
}
