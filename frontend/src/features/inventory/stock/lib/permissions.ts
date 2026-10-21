import { anyOf } from '@/lib/permissions'

/**
 * Permission names used by these screens: Inventory (backend Modules/Inventory/permissions.php),
 * the Reference warehouse master (warehouses.*: locations are read with view and maintained
 * with update) and accounting for journal links.
 */
export const INV_PERMISSIONS = {
  warehouses: { view: 'inventory.warehouses.view', manage: 'inventory.warehouses.manage' },
  stock: { view: 'inventory.stock.view' },
  documents: { view: 'inventory.documents.view' },
  entries: { view: 'accounting.entries.view' },
  referenceWarehouses: {
    view: 'warehouses.view',
    create: 'warehouses.create',
    update: 'warehouses.update',
  },
} as const

/** Who may open each screen; write actions keep their own single permission. */
export const INV_ACCESS = {
  warehouses: anyOf(INV_PERMISSIONS.warehouses.view, INV_PERMISSIONS.warehouses.manage),
  stock: INV_PERMISSIONS.stock.view,
  /** Editing warehouse master data or locations happens on the Reference warehouse screens. */
  referenceWarehousesEdit: anyOf(
    INV_PERMISSIONS.referenceWarehouses.create,
    INV_PERMISSIONS.referenceWarehouses.update,
  ),
} as const
