// Shapes of the accounting reports (backend Reports/Http/Resources); every amount is a decimal
// string with four decimals. Ranges are a period (`period_id`) or inclusive dates.
import type { EntryStatus, EntryType, Pagination } from '../journal/types'

/** Where the figures came from: account_balances for period-aligned ranges, lines otherwise. */
export type ReportSource = 'balances' | 'lines'

export interface ReportRangeEcho {
  date_from: string
  date_to: string
  period_id: string | null
}

export interface TrialBalanceAmounts {
  opening_debit: string
  opening_credit: string
  /** Movement inside the range. */
  debit: string
  credit: string
  /** Opening + movement. */
  total_debit: string
  total_credit: string
  /** The balance on its side; on totals the sum of the debit (credit) balances. */
  balance_debit: string
  balance_credit: string
}

export interface TrialBalanceRow extends TrialBalanceAmounts {
  account_id: string
  code: string
  name: string
  level: number
  parent_id: string | null
  tdhp_group: number | null
  type?: string
  normal_balance?: 'debit' | 'credit'
  is_postable: boolean
  is_active?: boolean
  /** Same account in the same range one year earlier (compare_with_previous_year). */
  previous?: TrialBalanceAmounts | null
}

/** TDHP class subtotal (1 Dönen Varlıklar ... 9 Nazım Hesaplar). */
export interface TrialBalanceGroup extends TrialBalanceAmounts {
  tdhp_group: number
  name: string
  previous?: TrialBalanceAmounts | null
}

export interface TrialBalance extends ReportRangeEcho {
  source: ReportSource
  level: number | null
  include_zero: boolean
  compare_with_previous_year: boolean
  previous_range: (ReportRangeEcho & { source: ReportSource | null }) | null
  rows: TrialBalanceRow[]
  groups: TrialBalanceGroup[]
  totals: TrialBalanceAmounts
  previous_totals: TrialBalanceAmounts | null
  /** Server-side check of total debit = total credit. */
  balanced: boolean
  /** Total debit - total credit. */
  difference: string
}

export interface LedgerParty {
  id: string
  code: string
  name: string
}

export interface GeneralLedgerLine {
  line_id: string
  entry_id: string
  entry_number: string | null
  entry_date: string
  entry_type: EntryType
  entry_status: EntryStatus
  line_no: number
  /** The posting account (a sub-account when the report runs on a parent account). */
  account_id: string
  account_code: string
  account_name: string
  description: string | null
  debit: string
  credit: string
  /** Signed: positive is a debit balance, negative a credit balance; continues across pages. */
  running_balance: string
  party_id: string | null
  party: LedgerParty | null
  document_ref: string | null
  due_date: string | null
  currency_code: string | null
  fx_amount: string | null
}

export interface LedgerAccount {
  id: string
  code: string
  name: string
  normal_balance: 'debit' | 'credit'
  is_postable: boolean
  currency_code: string | null
  requires_party: boolean
  requires_cost_center: boolean
  requires_project: boolean
}

export interface GeneralLedgerMeta extends ReportRangeEcho {
  pagination: Pagination
  source: ReportSource
  account: LedgerAccount
  /** Signed balance before the range. */
  opening_balance: string
  closing_balance: string
  totals: { debit: string; credit: string }
}

export interface GeneralLedgerPage {
  data: GeneralLedgerLine[]
  meta: GeneralLedgerMeta
}

export interface JournalBookLine {
  line_no: number
  account_id: string
  account_code: string
  account_name: string
  description: string | null
  debit: string
  credit: string
  party_id: string | null
}

export interface JournalBookEntry {
  id: string
  number: string
  entry_date: string
  entry_type: EntryType
  status: EntryStatus
  description: string | null
  total_debit: string
  total_credit: string
  lines: JournalBookLine[]
}

export interface DebitCredit {
  debit: string
  credit: string
}

export interface JournalBookMeta extends ReportRangeEcho {
  /** Paginated by entry. */
  pagination: Pagination
  source: ReportSource
  /** Entries of the same fiscal year before the range (the first "devreden"). */
  carried_forward: DebitCredit
  /** "Devreden" of this page: carried_forward plus the earlier pages of the range. */
  page_brought_forward: DebitCredit
  page_totals: DebitCredit
  /** "Nakledilen": page_brought_forward + page_totals. */
  page_carried_forward: DebitCredit
  /** Movement of the whole range. */
  range_totals: DebitCredit
}

export interface JournalBookPage {
  data: JournalBookEntry[]
  meta: JournalBookMeta
}
