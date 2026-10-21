// Public surface of the catalog feature for other features and the app shell.
export { ItemCombobox, type ItemComboboxProps } from './components/ItemCombobox'
export { UnitSelect } from './components/pickers'
export { catalogRoutes } from './routes'
export { catalogCommands, registerCatalogCommands } from './commands'
export { catalogKeys } from './api/keys'
export { gs1CheckDigit, validateBarcode } from './lib/barcode'
export type { Item, ItemType, Unit, PriceList, PricingResult } from './types'
