import { useTranslation } from 'react-i18next'

// Registered with the other namespaces in src/lib/i18n (typed via i18next.d.ts).
export const INVENTORY_STOCK_NS = 'inventory-stock'

export type InvT = (key: string, options?: Record<string, unknown>) => string

/**
 * Translator for the `inventory-stock` namespace. Keys are often built from values
 * (`movementTypes.${type}`), so the loose signature stays; i18n:check guards key parity.
 */
export function useInvT(): InvT {
  const { t } = useTranslation(INVENTORY_STOCK_NS)
  return t as unknown as InvT
}
