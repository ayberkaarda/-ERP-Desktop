import { useTranslation } from 'react-i18next'

// UI language -> Intl locale for numbers and dates.
const INTL_LOCALES: Record<string, string> = {
  tr: 'tr-TR',
  en: 'en-GB',
  de: 'de-DE',
  fr: 'fr-FR',
}

export function intlLocale(language: string | undefined): string {
  const base = (language ?? 'tr').split('-')[0] ?? 'tr'
  return INTL_LOCALES[base] ?? 'tr-TR'
}

export function useIntlLocale(): string {
  const { i18n } = useTranslation()
  return intlLocale(i18n.language)
}
