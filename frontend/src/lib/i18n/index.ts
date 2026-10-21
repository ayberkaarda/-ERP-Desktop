import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import accountingDe from './locales/accounting/de.json'
import accountingEn from './locales/accounting/en.json'
import accountingFr from './locales/accounting/fr.json'
import accountingTr from './locales/accounting/tr.json'
import accountingJournalDe from './locales/accounting-journal/de.json'
import accountingJournalEn from './locales/accounting-journal/en.json'
import accountingJournalFr from './locales/accounting-journal/fr.json'
import accountingJournalTr from './locales/accounting-journal/tr.json'
import catalogDe from './locales/catalog/de.json'
import catalogEn from './locales/catalog/en.json'
import catalogFr from './locales/catalog/fr.json'
import catalogTr from './locales/catalog/tr.json'
import inventoryDocsDe from './locales/inventory-docs/de.json'
import inventoryDocsEn from './locales/inventory-docs/en.json'
import inventoryDocsFr from './locales/inventory-docs/fr.json'
import inventoryDocsTr from './locales/inventory-docs/tr.json'
import commonDe from './locales/common/de.json'
import commonEn from './locales/common/en.json'
import commonFr from './locales/common/fr.json'
import commonTr from './locales/common/tr.json'
import inventoryStockDe from './locales/inventory-stock/de.json'
import inventoryStockEn from './locales/inventory-stock/en.json'
import inventoryStockFr from './locales/inventory-stock/fr.json'
import inventoryStockTr from './locales/inventory-stock/tr.json'
import partiesDe from './locales/parties/de.json'
import partiesEn from './locales/parties/en.json'
import partiesFr from './locales/parties/fr.json'
import partiesTr from './locales/parties/tr.json'
import referenceDe from './locales/reference/de.json'
import referenceEn from './locales/reference/en.json'
import referenceFr from './locales/reference/fr.json'
import referenceTr from './locales/reference/tr.json'
import salesSharedDe from './locales/sales-shared/de.json'
import salesSharedEn from './locales/sales-shared/en.json'
import salesSharedFr from './locales/sales-shared/fr.json'
import salesSharedTr from './locales/sales-shared/tr.json'
import salesQuotesDe from './locales/sales-quotes/de.json'
import salesQuotesEn from './locales/sales-quotes/en.json'
import salesQuotesFr from './locales/sales-quotes/fr.json'
import salesQuotesTr from './locales/sales-quotes/tr.json'
import salesOrdersDe from './locales/sales-orders/de.json'
import salesOrdersEn from './locales/sales-orders/en.json'
import salesOrdersFr from './locales/sales-orders/fr.json'
import salesOrdersTr from './locales/sales-orders/tr.json'
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
    tr: {
      translation: tr,
      common: commonTr,
      accounting: accountingTr,
      catalog: catalogTr,
      parties: partiesTr,
      reference: referenceTr,
      accountingJournal: accountingJournalTr,
      inventoryDocs: inventoryDocsTr,
      'inventory-stock': inventoryStockTr,
      'sales-shared': salesSharedTr,
      'sales-quotes': salesQuotesTr,
      'sales-orders': salesOrdersTr,
    },
    en: {
      translation: en,
      common: commonEn,
      accounting: accountingEn,
      catalog: catalogEn,
      parties: partiesEn,
      reference: referenceEn,
      accountingJournal: accountingJournalEn,
      inventoryDocs: inventoryDocsEn,
      'inventory-stock': inventoryStockEn,
      'sales-shared': salesSharedEn,
      'sales-quotes': salesQuotesEn,
      'sales-orders': salesOrdersEn,
    },
    de: {
      translation: de,
      common: commonDe,
      accounting: accountingDe,
      catalog: catalogDe,
      parties: partiesDe,
      reference: referenceDe,
      accountingJournal: accountingJournalDe,
      inventoryDocs: inventoryDocsDe,
      'inventory-stock': inventoryStockDe,
      'sales-shared': salesSharedDe,
      'sales-quotes': salesQuotesDe,
      'sales-orders': salesOrdersDe,
    },
    fr: {
      translation: fr,
      common: commonFr,
      accounting: accountingFr,
      catalog: catalogFr,
      parties: partiesFr,
      reference: referenceFr,
      accountingJournal: accountingJournalFr,
      inventoryDocs: inventoryDocsFr,
      'inventory-stock': inventoryStockFr,
      'sales-shared': salesSharedFr,
      'sales-quotes': salesQuotesFr,
      'sales-orders': salesOrdersFr,
    },
  },
  ns: [
    'translation',
    'common',
    'accounting',
    'accountingJournal',
    'catalog',
    'parties',
    'reference',
    'inventoryDocs',
    'inventory-stock',
    'sales-shared',
    'sales-quotes',
    'sales-orders',
  ],
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
