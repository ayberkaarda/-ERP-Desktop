// HTTP shapes of the accounting reports (PHASE3 "Reports"); every amount is a decimal string.
import type { AccountRef, EntryType, Pagination } from '../journal/types'

export interface TrialBalanceAmounts {
  opening_debit: string
  opening_credit: string
  debit: string
  credit: string
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
  is_postable: boolean
  /** Same account in the same range one year earlier (compare_with_previous_year). */
  previous?: Pick<
    TrialBalanceAmounts,
    'debit' | 'credit' | 'balance_debit' | 'balance_credit'
  > | null
}

export interface TrialBalance {
  date_from: string
  date_to: string
  rows: TrialBalanceRow[]
  totals: TrialBalanceAmounts
  previous_totals?: Pick<
    TrialBalanceAmounts,
    'debit' | 'credit' | 'balance_debit' | 'balance_credit'
  > | null
  /** Server-side check of total debit = total credit. */
  balanced: boolean
}

export interface GeneralLedgerLine {
  line_id: string
  entry_id: string
  entry_number: string | null
  entry_date: string
  entry_type: EntryType
  description: string | null
  debit: string
  credit: string
  /** Signed: positive is a debit balance, negative a credit balance. */
  running_balance: string
  party?: { id: string; code: string; name: string } | null
}

export interface GeneralLedgerMeta {
  pagination: Pagination
  account: AccountRef
  /** Signed balance before date_from. */
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
  account_code: string
  account_name: string
  description: string | null
  debit: string
  credit: string
}

export interface JournalBookEntry {
  id: string
  number: string
  entry_date: string
  entry_type: EntryType
  description: string | null
  lines: JournalBookLine[]
}

export interface JournalBookPage {
  data: JournalBookEntry[]
  meta: {
    pagination: Pagination
    /** Totals of entries before the range in the same fiscal year (first "devreden"). */
    carried_forward: { debit: string; credit: string }
  }
}
