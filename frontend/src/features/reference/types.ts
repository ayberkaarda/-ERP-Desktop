// HTTP shapes of the Reference module, mirroring PHASE2.md "Reference module endpoints".
// Decimals (rates, percents) travel as strings and are never converted to JS numbers.

export interface ListMeta {
  current_page: number
  per_page: number
  total: number
  last_page: number
}

/** Core ApiResponse::paginated: paging lives under meta.pagination. */
export interface ListResponse<T> {
  data: T[]
  meta?: { pagination?: Partial<ListMeta> }
}

export interface ItemResponse<T> {
  data: T
}

/**
 * Global currency row. `is_active` is the global flag; `company_is_active` is the activation for
 * the active company (false until the company activates it). `version` mirrors `company_version`
 * (the activation row's lock version; 1 before the first activation) and goes with PATCH.
 */
export interface Currency {
  id: string
  code: string
  name: string
  symbol: string
  decimals: number
  is_active: boolean
  company_is_active: boolean
  company_version: number
  version: number
}

export type RateSource = 'tcmb' | 'manual'

export interface ExchangeRate {
  id: string
  currency_code: string
  rate_date: string
  forex_buying: string
  forex_selling: string
  banknote_buying: string | null
  banknote_selling: string | null
  source: RateSource
  /** null for global TCMB fixings, the company id for its manual rates. */
  company_id?: string | null
}

export interface ExchangeRateInput {
  currency_code: string
  rate_date: string
  forex_buying: string
  forex_selling: string
  banknote_buying?: string
  banknote_selling?: string
}

export interface RateStatus {
  last_fetch_date: string | null
  stale_days: number | null
  is_stale?: boolean
}

export const TAX_TYPES = ['vat', 'withholding', 'excise', 'exemption', 'other'] as const
export type TaxType = (typeof TAX_TYPES)[number]

export interface TaxCode {
  id: string
  /** null for global rows maintained by seeders (read-only). */
  company_id: string | null
  type: TaxType
  code: string
  name: string
  rate: string | null
  numerator: number | null
  denominator: number | null
  effective_from: string | null
  effective_to: string | null
  is_active: boolean
  meta?: Record<string, unknown> | null
  version: number
}

export interface TaxCodeInput {
  type: TaxType
  code: string
  name: string
  rate: string | null
  numerator: number | null
  denominator: number | null
  effective_from: string
  effective_to: string | null
  is_active: boolean
}

export interface PaymentTerm {
  id: string
  code: string
  name: string
  due_days: number
  discount_percent: string | null
  discount_days: number | null
  is_active: boolean
  version: number
}

export interface PaymentTermInput {
  code: string
  name: string
  due_days: number
  discount_percent: string
  discount_days: number
  is_active: boolean
}

export const NEGATIVE_STOCK_POLICIES = ['allow', 'warn', 'block'] as const
export type NegativeStockPolicy = (typeof NEGATIVE_STOCK_POLICIES)[number]

export interface WarehouseAddress {
  line1?: string
  line2?: string
  district?: string
  city?: string
  postal_code?: string
  country?: string
}

export interface Warehouse {
  id: string
  code: string
  name: string
  branch_id: string | null
  address: WarehouseAddress | null
  is_active: boolean
  negative_stock_policy: NegativeStockPolicy
  is_default: boolean
  version: number
}

export interface WarehouseInput {
  code: string
  name: string
  address: WarehouseAddress | null
  is_active: boolean
  negative_stock_policy: NegativeStockPolicy
  is_default: boolean
}

export const LOCATION_TYPES = ['aisle', 'rack', 'shelf', 'bin'] as const
export type LocationType = (typeof LOCATION_TYPES)[number]

export interface WarehouseLocation {
  id: string
  code: string
  name: string
  parent_id: string | null
  type: LocationType
  is_active: boolean
  barcode: string | null
  version: number
}

export interface LocationInput {
  code: string
  name: string
  parent_id: string | null
  type: LocationType
  barcode: string | null
  is_active?: boolean
}

export interface CostCenter {
  id: string
  code: string
  name: string
  parent_id: string | null
  is_active: boolean
  version: number
}

export interface CostCenterInput {
  code: string
  name: string
  parent_id: string | null
  is_active: boolean
}

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'closed'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export interface Project {
  id: string
  code: string
  name: string
  status: ProjectStatus
  start_date: string | null
  end_date: string | null
  party_id: string | null
  cost_center_id: string | null
  version: number
}

export interface ProjectInput {
  code: string
  name: string
  status: ProjectStatus
  start_date: string | null
  end_date: string | null
  cost_center_id: string | null
}

/** One row of GET /settings. */
export interface SettingRow {
  key: string
  value: unknown
  default?: unknown
  is_default?: boolean
}

export const BASE_CURRENCY_KEY = 'company.base_currency'

/** Anything a node tree can be built from. */
export interface TreeRow {
  id: string
  parent_id: string | null
  code: string
  name: string
}
