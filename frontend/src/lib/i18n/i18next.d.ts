import 'i18next'
import type accountingTr from './locales/accounting/tr.json'
import type accountingJournalTr from './locales/accounting-journal/tr.json'
import type catalogTr from './locales/catalog/tr.json'
import type commonTr from './locales/common/tr.json'
import type inventoryStockTr from './locales/inventory-stock/tr.json'
import type partiesTr from './locales/parties/tr.json'
import type referenceTr from './locales/reference/tr.json'
import type tr from './locales/tr.json'

// Turkish is the source of truth for keys; t() is type-checked against it.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof tr
      common: typeof commonTr
      accounting: typeof accountingTr
      catalog: typeof catalogTr
      parties: typeof partiesTr
      reference: typeof referenceTr
      accountingJournal: typeof accountingJournalTr
      'inventory-stock': typeof inventoryStockTr
    }
  }
}
