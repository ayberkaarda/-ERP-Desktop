import { INV_ACCESS } from './permissions'

/** Screens of the warehouse/stock part of Inventory, in subnav order. */
export const INVENTORY_STOCK_ROUTES = [
  { key: 'stock', path: '/inventory/stock', permission: INV_ACCESS.stock },
  { key: 'movements', path: '/inventory/movements', permission: INV_ACCESS.stock },
  { key: 'lots', path: '/inventory/lots', permission: INV_ACCESS.stock },
  { key: 'serials', path: '/inventory/serials', permission: INV_ACCESS.stock },
  { key: 'warehouses', path: '/inventory/warehouses', permission: INV_ACCESS.warehouses },
] as const

/** Screen of a stock document (documents lane) and of a journal entry (accounting). */
export const documentPath = (id: string) => `/inventory/documents/${encodeURIComponent(id)}`
export const journalEntryPath = (id: string) =>
  `/accounting/journal-entries/${encodeURIComponent(id)}`
export const lotPath = (id: string) => `/inventory/lots/${encodeURIComponent(id)}`
export const itemStockPath = (itemId: string) =>
  `/inventory/stock?item=${encodeURIComponent(itemId)}`
