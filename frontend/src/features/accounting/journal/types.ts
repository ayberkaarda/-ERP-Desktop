// HTTP shapes of the journal entry endpoints (PHASE3 "HTTP API" /journal-entries). Money and
// rates are decimal strings; calendar dates are "YYYY-MM-DD".
import type { AuditEntry } from '@/components/shared/AuditTrail'

export interface Pagination {
  total: number
  current_page: number
  last_page: number
  per_page: number
}

export interface Paginated<T, M = Record<string, unknown>> {
  data: T[]
  meta: { pagination: Pagination } & M
}

export interface Envelope<T> {
  data: T
}

export const ENTRY_TYPES = [
  'opening',
  'general',
  'receipt',
  'payment',
  'adjustment',
  'revaluation',
  'closing',
  'reversal',
  'system',
] as const
export type EntryType = (typeof ENTRY_TYPES)[number]

/** Types a user may pick for a manual entry; the rest are produced by the system. */
export const MANUAL_ENTRY_TYPES = [
  'general',
  'receipt',
  'payment',
  'adjustment',
  'opening',
] as const satisfies readonly EntryType[]

export const ENTRY_STATUSES = ['draft', 'posted', 'reversed'] as const
export type EntryStatus = (typeof ENTRY_STATUSES)[number]

/** Account as returned by GET /accounts (only what the journal needs). */
export interface AccountRef {
  id: string
  code: string
  name: string
  /** Foreign-currency account: lines carry fx amount and rate. */
  currency_code: string | null
  requires_party: boolean
  requires_cost_center: boolean
  requires_project: boolean
  is_postable?: boolean
  is_active?: boolean
  normal_balance?: 'debit' | 'credit'
}

export interface NamedRef {
  id: string
  code: string
  name: string
}

export interface UserRef {
  id: string
  name: string
}

export interface EntryLink {
  id: string
  number: string | null
  entry_date?: string
}

export interface JournalLine {
  id: string
  line_no: number
  account_id: string
  account?: AccountRef | null
  debit: string
  credit: string
  currency_code: string | null
  fx_amount: string | null
  fx_rate: string | null
  party_id: string | null
  party?: NamedRef | null
  cost_center_id: string | null
  cost_center?: NamedRef | null
  project_id: string | null
  project?: NamedRef | null
  description: string | null
  due_date: string | null
  document_ref: string | null
}

export interface JournalEntrySummary {
  id: string
  /** Assigned only when the entry is posted (gapless per fiscal year). */
  number: string | null
  entry_type: EntryType
  entry_date: string
  period_id: string | null
  description: string | null
  status: EntryStatus
  source_type: string | null
  source_id: string | null
  reverses_id: string | null
  reversed_by_id: string | null
  total_debit: string
  total_credit: string
  posted_at: string | null
  created_at?: string
  updated_at?: string
  line_count?: number
  version: number
}

export interface JournalEntry extends JournalEntrySummary {
  lines: JournalLine[]
  created_by_user?: UserRef | null
  posted_by_user?: UserRef | null
  reverses?: EntryLink | null
  reversed_by?: EntryLink | null
  reversal_reason?: string | null
  /** Activity log of the entry, newest first. */
  audit?: AuditEntry[]
}

export interface JournalLineInput {
  account_id: string
  debit: string
  credit: string
  currency_code: string | null
  fx_amount: string | null
  fx_rate: string | null
  party_id: string | null
  cost_center_id: string | null
  project_id: string | null
  description: string | null
  document_ref: string | null
}

export interface JournalEntryInput {
  entry_type: EntryType
  entry_date: string
  description: string | null
  lines: JournalLineInput[]
}

export interface ReverseInput {
  date: string
  reason: string
}

export interface AccountingPeriod {
  id: string
  fiscal_year_id: string
  fiscal_year?: { id: string; code: string } | null
  number: number
  start_date: string
  end_date: string
  status: 'open' | 'soft_closed' | 'closed'
}

/** API limit per entry. */
export const MAX_LINES = 500
