/** Inventory reservation policies of a warehouse (backend Enums/ReservationPolicy). */
export const RESERVATION_POLICIES = ['none', 'soft', 'hard'] as const

/**
 * Reference screens that own the warehouse master data and locations
 * (features/reference/routes.tsx: reference/warehouses and reference/warehouses/:id).
 */
export const REFERENCE_WAREHOUSES_PATH = '/reference/warehouses'
export const referenceWarehousePath = (id: string) =>
  `${REFERENCE_WAREHOUSES_PATH}/${encodeURIComponent(id)}`
