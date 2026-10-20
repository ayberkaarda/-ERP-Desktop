import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import commonDe from './locales/common/de.json'
import commonEn from './locales/common/en.json'
import commonFr from './locales/common/fr.json'
import commonTr from './locales/common/tr.json'
import de from './locales/de.json'
import en from './locales/en.json'
import fr from './locales/fr.json'
import tr from './locales/tr.json'

export const SUPPORTED_LANGUAGES = ['tr', 'en', 'de', 'fr'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

const STORAGE_KEY = 'keystone.lang'

function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return SUPPORTED_LANGUAGES.find((l) => l === value) ?? 'tr'
  } catch {
    return 'tr'
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    tr: { translation: tr, common: commonTr },
    en: { translation: en, common: commonEn },
    de: { translation: de, common: commonDe },
    fr: { translation: fr, common: commonFr },
  },
  ns: ['translation', 'common'],
  lng: storedLanguage(),
  fallbackLng: 'tr',
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    // Storage may be unavailable (private mode); language still applies for the session.
  }
})

export default i18n
