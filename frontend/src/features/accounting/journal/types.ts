// Shapes of the journal entry endpoints (backend JournalEntryResource / JournalLineResource).
// Money and rates are decimal strings; calendar dates are "YYYY-MM-DD". The API sends ids for
// accounts and dimensions; the client adds the records (`account`, `party`, ...) after loading.
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

/** Types a user may pick for a manual entry (EntryType::manual()); the rest come from the system. */
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

export interface EntryLink {
  id: string
  number: string | null
  entry_date?: string
}

/** A line as the journal entry endpoints send it. */
export interface ApiJournalLine {
  id: string
  line_no: number
  account_id: string
  account_code?: string
  account_name?: string
  debit: string
  credit: string
  currency_code: string | null
  fx_amount: string | null
  fx_rate: string | null
  party_id: string | null
  cost_center_id: string | null
  project_id: string | null
  description: string | null
  due_date: string | null
  document_ref: string | null
}

/** A line with the records behind its ids (filled by the client; null when unavailable). */
export interface JournalLine extends ApiJournalLine {
  account?: AccountRef | null
  party?: NamedRef | null
  cost_center?: NamedRef | null
  project?: NamedRef | null
}

export interface JournalEntrySummary {
  id: string
  /** Assigned only when the entry is posted (gapless per fiscal year). */
  number: string | null
  entry_type: EntryType
  entry_date: string
  period_id: string | null
  fiscal_year_id?: string | null
  description: string | null
  status: EntryStatus
  source_type: string | null
  source_id: string | null
  reverses_id: string | null
  reversed_by_id: string | null
  reversal_reason?: string | null
  total_debit: string
  total_credit: string
  difference?: string
  /** User ids. */
  created_by?: string | null
  posted_by?: string | null
  posted_at: string | null
  created_at?: string
  updated_at?: string
  line_count?: number
  version: number
}

/** Activity row of GET /journal-entries/{id} (newest first, at most 100). */
export interface ApiAuditRow {
  event: string | null
  description: string | null
  causer_id: string | null
  created_at: string | null
}

export interface ApiJournalEntry extends JournalEntrySummary {
  lines: ApiJournalLine[]
  /** Only on GET /journal-entries/{id}. */
  audit?: ApiAuditRow[]
}

export interface JournalEntry extends JournalEntrySummary {
  lines: JournalLine[]
  /** The linked entries with their numbers (looked up by the client). */
  reverses?: EntryLink | null
  reversed_by?: EntryLink | null
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
  /** Code of the fiscal year, joined by the client from GET /fiscal-years when it can read it. */
  fiscal_year_code?: string | null
  number: number
  is_adjustment?: boolean
  start_date: string
  end_date: string
  status: 'open' | 'soft_closed' | 'closed'
}

/** API limit per entry. */
export const MAX_LINES = 500
