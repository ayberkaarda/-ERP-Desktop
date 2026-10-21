// HTTP shapes of the Accounting module for accounts, fiscal years, periods and account
// determination, mirroring PHASE3.md "Data model" and "HTTP API". Money travels as decimal
// strings (numeric(20,4)) and is never converted to a JS number.

export interface PaginationMeta {
  current_page: number
  per_page: number
  total: number
  last_page: number
}

/** Core ApiResponse::paginated: paging lives under meta.pagination. */
export interface ListResponse<T> {
  data: T[]
  meta?: { pagination?: Partial<PaginationMeta> }
}

export interface ItemResponse<T> {
  data: T
}

// --- Accounts -------------------------------------------------------------------------------

export const ACCOUNT_TYPES = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
  'cost',
  'memo',
] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const NORMAL_BALANCES = ['debit', 'credit'] as const
export type NormalBalance = (typeof NORMAL_BALANCES)[number]

export interface Account {
  id: string
  code: string
  name: string
  parent_id: string | null
  level: number
  type: AccountType
  normal_balance: NormalBalance
  is_postable: boolean
  is_active: boolean
  is_system: boolean
  tdhp_group: number | null
  currency_code: string | null
  requires_party: boolean
  requires_cost_center: boolean
  requires_project: boolean
  is_revaluable: boolean
  notes: string | null
  version: number
  /** Present on tree responses and some lists; computed by the API. */
  has_children?: boolean
  children_count?: number
  /** True once posted lines reference it (it can then neither be deleted nor made non-postable). */
  has_postings?: boolean
}

/** GET /accounts/tree may nest children; flat rows with parent_id are accepted too. */
export type AccountTreeRow = Account & { children?: AccountTreeRow[] }

export interface AccountInput {
  code: string
  name: string
  parent_id: string | null
  type: AccountType
  normal_balance: NormalBalance
  is_postable: boolean
  is_active: boolean
  tdhp_group: number | null
  currency_code: string | null
  requires_party: boolean
  requires_cost_center: boolean
  requires_project: boolean
  is_revaluable: boolean
  notes: string | null
}

/** GET /accounts/{id}/balance?as_of= */
export interface AccountBalance {
  account_id: string
  as_of: string
  debit: string
  credit: string
  /** Absolute net amount; `side` says which way it leans (null when zero). */
  balance: string
  side: NormalBalance | null
  currency_code?: string | null
  fx_balance?: string | null
}

export type ImportRowStatus = 'create' | 'update' | 'skip' | 'error'

export interface ImportRowResult {
  /** 1-based row number in the uploaded sheet (header excluded). */
  row: number
  code: string | null
  name: string | null
  status: ImportRowStatus
  errors: string[]
}

/** POST /accounts/import (multipart: file, dry_run) */
export interface ImportResult {
  dry_run: boolean
  total: number
  created: number
  updated: number
  skipped: number
  failed: number
  rows: ImportRowResult[]
}

// --- Fiscal years and periods ---------------------------------------------------------------

export type FiscalYearStatus = 'open' | 'closed'

export interface FiscalYear {
  id: string
  code: string
  name: string
  start_date: string
  end_date: string
  status: FiscalYearStatus
  closed_at: string | null
  closed_by: string | null
  version: number
  /** Some responses embed the generated periods. */
  periods?: AccountingPeriod[]
  has_posted_entries?: boolean
}

export interface FiscalYearInput {
  code: string
  name: string
  start_date: string
  end_date: string
  /** Generates period 13 (year-end adjustments). */
  with_adjustment_period: boolean
}

export type PeriodStatus = 'open' | 'soft_closed' | 'closed'
export const PERIOD_STATUSES: readonly PeriodStatus[] = ['open', 'soft_closed', 'closed']

export interface AccountingPeriod {
  id: string
  fiscal_year_id: string
  number: number
  start_date: string
  end_date: string
  status: PeriodStatus
  version: number
  /** Drafts block close; the API may report the count up front. */
  draft_entries_count?: number
  posted_entries_count?: number
}

export type PeriodAction = 'soft-close' | 'close' | 'reopen'

/**
 * Optional GET /fiscal-years/{id}/close-preview: what the closing procedure would generate.
 * The UI shows it when the API provides it and says so when it does not.
 */
export interface ClosingPreview {
  result: string
  result_side: NormalBalance | null
  result_account_code: string | null
  entries: ClosingPreviewEntry[]
  warnings?: string[]
}

export interface ClosingPreviewEntry {
  entry_type: 'closing' | 'opening'
  description: string
  entry_date: string
  line_count: number
  total_debit: string
  total_credit: string
}

// --- Account determination ------------------------------------------------------------------

export const DETERMINATION_EVENTS = [
  'sales.receivable',
  'sales.revenue.goods',
  'sales.revenue.services',
  'sales.vat_output',
  'sales.returns',
  'purchase.payable',
  'purchase.expense',
  'purchase.vat_input',
  'purchase.vat_withholding',
  'inventory.stock',
  'inventory.cogs',
  'treasury.cash',
  'treasury.bank',
  'treasury.cheque_portfolio',
  'fx.gain',
  'fx.loss',
] as const

/** Context keys the resolver matches on (PHASE3: party group, item category, currency, tax code). */
export const CONDITION_KEYS = ['party_group', 'item_category', 'currency', 'tax_code'] as const
export type ConditionKey = (typeof CONDITION_KEYS)[number]

export type RuleConditions = Record<string, string | string[]>

export interface AccountRef {
  id: string
  code: string
  name: string
}

export interface DeterminationRule {
  id: string
  event_key: string
  priority: number
  conditions: RuleConditions | null
  account_id: string
  account?: AccountRef | null
  side: NormalBalance | null
  description: string | null
  is_system: boolean
  version: number
}

export interface DeterminationRuleInput {
  event_key: string
  priority: number
  conditions: RuleConditions
  account_id: string
  side: NormalBalance | null
  description: string | null
}

/** POST /account-determination/test */
export interface DeterminationTestResult {
  account_id: string
  account?: AccountRef | null
  rule_id: string | null
  side?: NormalBalance | null
  /** 'rule' when a conditional rule matched, 'default' for the fallback rule. */
  source?: 'rule' | 'default'
}
