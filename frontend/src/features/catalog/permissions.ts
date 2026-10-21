/**
 * Read and write permissions of the catalog setup pages. The API lets item viewers read units,
 * unit conversions and categories and pricing viewers read discount rules; changing them needs the
 * manage permission. Pages open with either one and show write actions only with the manage one.
 */
export const CATALOG_ACCESS = {
  units: { read: 'items.view', manage: 'units.manage' },
  categories: { read: 'items.view', manage: 'item_categories.manage' },
  discountRules: { read: 'pricing.view', manage: 'discount_rules.manage' },
} as const

export type CatalogAccess = (typeof CATALOG_ACCESS)[keyof typeof CATALOG_ACCESS]
