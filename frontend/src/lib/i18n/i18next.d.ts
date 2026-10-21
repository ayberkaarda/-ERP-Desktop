import 'i18next'
import type catalogTr from './locales/catalog/tr.json'
import type commonTr from './locales/common/tr.json'
import type tr from './locales/tr.json'

// Turkish is the source of truth for keys; t() is type-checked against it.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof tr; common: typeof commonTr; catalog: typeof catalogTr }
  }
}
