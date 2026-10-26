export type Area = 'accounts' | 'payments' | 'transfers' | 'instruments' | 'banking' | 'plans'
export type Direction = 'receipt' | 'payment'
export interface Envelope<T> {
  data: T
  meta?: Record<string, unknown>
}
export interface Page<T> {
  data: T[]
  meta: { pagination: { current_page: number; last_page: number; total: number; per_page: number } }
}
export interface RecordBase {
  id: string
  version: number
  status?: string
  number?: string | null
  journal_entry_id?: string | null
  reversal_journal_entry_id?: string | null
}
export interface Account extends RecordBase {
  type: 'cash' | 'bank' | 'pos'
  code: string
  name: string
  currency_code: string
  gl_account_id: string
  bank_name: string | null
  branch: string | null
  iban: string | null
  is_active: boolean
  allow_negative: boolean
  balance?: string
  has_movements?: boolean
}
export interface Allocation {
  currency_code?: string
  invoice_module: 'sales' | 'purchasing'
  invoice_id: string
  amount: string
  fx_rate: string
  carrying_amount?: string
  settlement_amount?: string
  realized_fx?: string
}
export interface Payment extends RecordBase {
  counterparty_module?: 'sales' | 'purchasing' | null
  direction: Direction
  account_id: string
  party_id: string
  party_name?: string
  document_date: string
  currency_code: string
  fx_rate: string
  amount: string
  reference: string | null
  description: string | null
  allocations: Allocation[]
  amount_local?: string
}
export interface Transfer extends RecordBase {
  from_account_id: string
  to_account_id: string
  document_date: string
  amount: string
  target_amount: string
  source_fx_rate: string
  target_fx_rate: string
  fee_amount: string
  expense_account_id: string | null
  currency_code?: string
}
export interface Plan extends RecordBase {
  party_id: string
  direction: Direction
  currency_code: string
  amount: string
  due_date: string
  description: string | null
  account_id: string | null
  payment_id: string | null
}
export interface Instrument extends RecordBase {
  kind: 'cheque' | 'note'
  direction: 'received' | 'issued'
  instrument_number: string
  party_id: string
  party_name?: string
  amount: string
  currency_code: string
  fx_rate: string
  issue_date: string
  due_date: string
  bank_name: string | null
  drawer: string | null
  reference: string | null
  allocations: Allocation[]
  events?: {
    action: string
    document_date: string
    reason?: string | null
    journal_entry_id?: string | null
  }[]
}
export interface StatementLine {
  id: string
  line_no: number
  date: string
  value_date?: string | null
  reference: string | null
  description: string | null
  amount: string
  payment_id?: string | null
  movement_id?: string | null
  matched?: boolean
}
export interface MatchSuggestion {
  id: string
  movement_id: string
  payment_id?: string | null
  account_id: string
  direction: Direction
  amount: string
  currency_code: string
  document_date: string
  reference?: string | null
  source_type: string
}
export interface Statement extends RecordBase {
  account_id: string
  format: 'csv' | 'mt940'
  bank_reference: string | null
  start_date: string
  end_date: string
  opening_balance: string
  closing_balance: string
  currency_code: string
  lines: StatementLine[]
}
export interface StatementInput {
  account_id: string
  format: 'csv' | 'mt940'
  content: string
  currency_code?: string
  opening_balance?: string
  closing_balance?: string
  bank_reference?: string
  delimiter?: 'comma' | 'semicolon' | 'tab'
  decimal_separator?: string
  mapping?: {
    date: string
    amount: string
    reference: string
    description: string
    value_date: string
  }
}
export interface OpenItem {
  id: string
  module: 'sales' | 'purchasing'
  number: string | null
  invoice_type: string
  status: string
  party_id: string
  party_name: string
  document_date: string
  due_date: string | null
  currency_code: string
  fx_rate: string
  total: string
  historical_local: string
  paid_amount: string
  balance_due: string
}
export interface Preview {
  currency: string
  amount_local: string
  allocated_local: string
  advance_local: string
  realized_fx: string
  lines: { account_id: string; debit: string; credit: string; party_id?: string | null }[]
}
export interface Movement {
  id: string
  document_date: string
  direction?: string
  amount: string
  reference?: string | null
  balance?: string
  source_id?: string | null
}
export interface Report {
  data: Record<string, unknown>[]
  meta?: Record<string, unknown>
}
export type TreasuryRecord = Account | Payment | Transfer | Instrument | Statement | Plan
export const AREA_BASE: Record<Area, string> = {
  accounts: '/treasury-accounts',
  payments: '/treasury-payments',
  transfers: '/treasury-transfers',
  instruments: '/treasury-instruments',
  banking: '/treasury-bank-statements',
  plans: '/treasury-payment-plans',
}
export const permission = (area: Area, action: string) => `treasury.${area}.${action}`
