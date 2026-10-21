import { anyOf } from '@/lib/permissions'

/** Permission names of the Inventory module used by these screens (PHASE4 "HTTP API"). */
export const INV_PERMISSIONS = {
  warehouses: { view: 'inventory.warehouses.view', manage: 'inventory.warehouses.manage' },
  stock: { view: 'inventory.stock.view' },
  documents: { view: 'inventory.documents.view' },
  entries: { view: 'accounting.entries.view' },
} as const

/** Who may open each screen; write actions keep their own single permission. */
export const INV_ACCESS = {
  warehouses: anyOf(INV_PERMISSIONS.warehouses.view, INV_PERMISSIONS.warehouses.manage),
  stock: INV_PERMISSIONS.stock.view,
} as const
