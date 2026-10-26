// HTTP shapes of the Catalog module (PHASE2 "Catalog module endpoints"). Decimals are strings.

export interface Pagination {
  total: number
  current_page: number
  last_page: number
  per_page: number
}

/** ApiResponse::paginated: rows plus meta.pagination. */
export interface Paginated<T> {
  data: T[]
  meta: { pagination: Pagination }
}

export interface Envelope<T> {
  data: T
}

export interface UnitRef {
  id: string
  code: string
  name: string
  symbol: string | null
}

export interface Unit extends UnitRef {
  is_active: boolean
  version: number
}

export interface UnitInput {
  code: string
  name: string
  symbol: string | null
  is_active: boolean
}

export interface UnitConversion {
  id: string
  from_unit_id: string
  to_unit_id: string
  /** 1 from-unit = factor to-units. */
  factor: string
  version: number
}

export interface ItemCategory {
  id: string
  code: string
  name: string
  parent_id: string | null
  /** Server-maintained tree position (root = 1) and ancestor ids from the root down. */
  depth?: number
  path_ids?: string[]
  is_active?: boolean
  version: number
}

export interface ItemCategoryInput {
  code: string
  name: string
  parent_id: string | null
}

export const ITEM_TYPES = ['stock', 'service'] as const
export type ItemType = (typeof ITEM_TYPES)[number]

export const TRACKING_MODES = ['none', 'lot', 'serial'] as const
export type TrackingMode = (typeof TRACKING_MODES)[number]

export type Attributes = Record<string, string>

export interface Item {
  id: string
  code: string
  name: string
  description?: string | null
  type: ItemType
  base_unit_id: string
  category_id: string | null
  default_tax_code_id: string | null
  purchase_tax_code_id: string | null
  tracking: TrackingMode
  has_expiry: boolean
  min_stock: string | null
  reorder_point: string | null
  is_active: boolean
  attributes: Attributes
  version: number
  /** Embedded when the API includes relations. */
  base_unit?: UnitRef | null
  category?: { id: string; code: string; name: string } | null
}

export interface ItemInput {
  name: string
  type: ItemType
  base_unit_id: string
  category_id: string | null
  default_tax_code_id: string | null
  purchase_tax_code_id: string | null
  tracking: TrackingMode
  has_expiry: boolean
  min_stock: string | null
  reorder_point: string | null
  is_active: boolean
  attributes: Attributes
}

export interface ItemVariant {
  id: string
  item_id: string
  sku: string
  name?: string | null
  attributes: Attributes
  is_active: boolean
  version: number
}

export interface ItemVariantInput {
  sku: string
  attributes: Attributes
  is_active: boolean
}

export const BARCODE_TYPES = ['ean13', 'ean8', 'upca', 'code128', 'other'] as const
export type BarcodeType = (typeof BARCODE_TYPES)[number]

export interface ItemBarcode {
  id: string
  item_id: string
  barcode: string
  type: BarcodeType
  unit_id: string
  variant_id: string | null
  is_primary: boolean
  version: number
}

export interface ItemBarcodeInput {
  barcode: string
  type: BarcodeType
  unit_id: string
  variant_id: string | null
  is_primary: boolean
}

export interface ItemUnit {
  id: string
  item_id: string
  unit_id: string
  /** 1 alternate unit = factor base units. */
  factor: string
  version: number
}

export interface ItemUnitInput {
  unit_id: string
  factor: string
}

export interface PriceList {
  id: string
  code: string
  name: string
  currency_code: string
  is_default: boolean
  valid_from: string | null
  valid_to: string | null
  is_active: boolean
  tax_inclusive: boolean
  version: number
}

export interface PriceListInput {
  code: string
  name: string
  currency_code: string
  is_default: boolean
  valid_from: string | null
  valid_to: string | null
  is_active: boolean
  tax_inclusive: boolean
}

export interface PriceListLine {
  id?: string
  item_id: string
  variant_id: string | null
  unit_id: string
  min_qty: string
  price: string
  valid_from: string | null
  valid_to: string | null
  version?: number
}

/**
 * One line of PUT /price-lists/{id}/lines. The server upserts by the natural key
 * (item, variant, unit, min_qty, valid_from) and never deletes; overwriting an existing line
 * needs the version it was read with. Unknown keys (such as `id`) are rejected.
 */
export interface PriceListLineInput {
  item_id: string
  variant_id: string | null
  unit_id: string
  min_qty: string
  price: string
  valid_from: string | null
  valid_to: string | null
  version?: number
}

export const DISCOUNT_SCOPES = ['item', 'category', 'party', 'all'] as const
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number]

export interface DiscountRule {
  id: string
  code: string
  name: string
  scope: DiscountScope
  scope_ref: string | null
  /** Required for scope=party (scope_ref stays null); an optional extra condition otherwise. */
  party_id: string | null
  /** Always a decimal string on the wire ("0.000000" = no minimum); null is rejected. */
  min_qty: string
  discount_percent: string
  priority: number
  valid_from: string | null
  valid_to: string | null
  is_active: boolean
  stackable: boolean
  version: number
}

export type DiscountRuleInput = Omit<DiscountRule, 'id' | 'version'>

export interface PricingQuery {
  item_id: string
  variant_id?: string
  party_id?: string
  qty: string
  unit_id?: string
  date: string
  /** Required by the API (ISO 4217). */
  currency: string
}

export type PriceSource = 'party_price_list' | 'default_price_list' | 'none'

export interface PricingTraceStep {
  step: string
  outcome: 'matched' | 'skipped' | 'rejected'
  detail?: string | null
}

export interface PricingResult {
  unit_price: string | null
  currency: string
  price_list_id: string | null
  discount_percent: string
  /** A PriceSource; typed loosely so a new server value does not break parsing. */
  source: string
  /** unit_price after discounts, computed by the server. */
  net_unit_price?: string | null
  price_unit_id?: string | null
  tax_inclusive?: boolean | null
  /** Optional extras; the UI degrades gracefully without them. */
  price_list_line_id?: string | null
  discount_rule_ids?: string[]
  trace?: PricingTraceStep[]
}

// Other modules' rows used in pickers, read defensively.
export interface TaxCodeRef {
  id: string
  code: string
  name: string
  rate: string | null
  type?: string
}

export interface CurrencyRef {
  code: string
  name: string
}

export interface PartyRef {
  id: string
  code: string
  name: string
}
