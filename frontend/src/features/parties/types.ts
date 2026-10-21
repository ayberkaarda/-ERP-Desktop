// HTTP shapes of the Parties module (PHASE2 "Parties module endpoints"). Money is a string.

export const PARTY_ROLES = ['customer', 'supplier'] as const
export type PartyRole = (typeof PARTY_ROLES)[number]

export const PARTY_TYPES = ['company', 'person'] as const
export type PartyType = (typeof PARTY_TYPES)[number]

export interface Party {
  id: string
  code: string
  name: string
  legal_name: string | null
  type: PartyType
  roles: PartyRole[]
  tax_office: string | null
  tax_number: string | null
  /** ISO 3166-1 alpha-2. */
  country: string
  default_currency_code: string | null
  payment_term_id: string | null
  price_list_id: string | null
  /** numeric(20,4) as string. */
  risk_limit: string | null
  risk_currency_code: string | null
  is_active: boolean
  notes: string | null
  tags: string[]
  version: number
  created_at?: string
  updated_at?: string
}

/** Writable party fields (code is assigned by the server's number sequence). */
export interface PartyInput {
  name: string
  legal_name: string | null
  type: PartyType
  roles: PartyRole[]
  tax_office: string | null
  tax_number: string | null
  country: string
  default_currency_code: string | null
  payment_term_id: string | null
  price_list_id: string | null
  risk_limit: string | null
  risk_currency_code: string | null
  is_active: boolean
  notes: string | null
  tags: string[]
}

export type PartyPatch = Partial<PartyInput> & { version: number }

export const ADDRESS_TYPES = ['billing', 'shipping', 'other'] as const
export type AddressType = (typeof ADDRESS_TYPES)[number]

export interface PartyAddress {
  id: string
  party_id?: string
  type: AddressType
  label: string | null
  line1: string
  line2: string | null
  district: string | null
  city: string
  postal_code: string | null
  country: string
  is_default: boolean
  version?: number
}

export interface PartyContact {
  id: string
  party_id?: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  is_primary: boolean
  version?: number
}

export interface PartyBankAccount {
  id: string
  party_id?: string
  bank_name: string
  iban: string
  swift: string | null
  currency_code: string | null
  is_default: boolean
  version?: number
}

export type AddressInput = Omit<PartyAddress, 'id' | 'party_id' | 'version'>
export type ContactInput = Omit<PartyContact, 'id' | 'party_id' | 'version'>
export type BankAccountInput = Omit<PartyBankAccount, 'id' | 'party_id' | 'version'>

/** One hit of GET /parties/duplicates. */
export interface PartyDuplicate {
  id: string
  code: string
  name: string
  tax_number: string | null
  is_active: boolean
  /** Which input matched; absent on older payloads. */
  match?: 'tax_number' | 'name'
}

export interface Pagination {
  current_page: number
  per_page: number
  total: number
  last_page: number
}

export interface Paginated<T> {
  data: T[]
  meta?: { pagination?: Pagination }
}

/** One row of GET /logs/audit (Identity ActivityResource). */
export interface ApiActivity {
  id: string
  event: string | null
  description: string | null
  causer_id: string | null
  causer?: { id: string; name: string } | null
  old?: Record<string, unknown> | null
  attributes?: Record<string, unknown> | null
  created_at: string
}

/** Morph alias the API uses for parties (attachments, audit subject). */
export const PARTY_MORPH = 'party'
