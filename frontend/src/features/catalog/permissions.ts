import { anyOf } from '@/lib/permissions'

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

/** Opening a page: read or manage, the alternatives of the API's viewAny policies. */
export const CATALOG_OPEN = {
  units: anyOf(CATALOG_ACCESS.units.read, CATALOG_ACCESS.units.manage),
  categories: anyOf(CATALOG_ACCESS.categories.read, CATALOG_ACCESS.categories.manage),
  discountRules: anyOf(CATALOG_ACCESS.discountRules.read, CATALOG_ACCESS.discountRules.manage),
} as const
