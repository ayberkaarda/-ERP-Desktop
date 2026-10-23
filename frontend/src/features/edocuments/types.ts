export const KINDS = ['e_invoice', 'e_archive', 'e_despatch'] as const
export type Kind = (typeof KINDS)[number]
export const STATUSES = [
  'draft',
  'invalid',
  'ready',
  'sending',
  'sent',
  'delivered',
  'accepted',
  'rejected',
  'failed',
  'cancelled',
] as const
export type DocumentStatus = (typeof STATUSES)[number]
export type Direction = 'outgoing' | 'incoming'
export const PROFILES: Record<Kind, [string, ...string[]]> = {
  e_invoice: ['TEMELFATURA', 'TICARIFATURA', 'IHRACAT', 'KAMU'],
  e_archive: ['EARSIVFATURA'],
  e_despatch: ['TEMELIRSALIYE'],
}
export interface Page<T> {
  data: T[]
  meta: { pagination: { current_page: number; last_page: number; per_page: number; total: number } }
}
export interface ProviderStatus {
  driver: string
  mode: string
  available: boolean
  validation_available: boolean
  live_enabled: boolean
}
export interface Source {
  id: string
  number: string
  document_date: string
  party_name: string
  currency_code: string
  total: string
  version: number
}
export interface ValidationIssue {
  code: string
  message: string
  path?: string
}
export interface Validation {
  valid: boolean
  available: boolean
  errors: ValidationIssue[]
  warnings: (ValidationIssue | string)[]
  metadata?: {
    ubl_version?: string
    customization_id?: string
    schematron_revision?: string
    signature_verified?: boolean
  }
  schema_version?: string
}
export interface EDocument {
  id: string
  company_id: string
  direction: Direction
  kind: Kind
  profile: string
  status: DocumentStatus
  uuid: string
  number: string | null
  series: string
  document_date: string
  currency_code: string
  total: string
  party_name: string
  source_id: string | null
  source_type: string | null
  source_number: string | null
  purchase_invoice_id: string | null
  version: number
  sandbox: boolean
  validation: Validation | null
  snapshot?: Record<string, unknown>
  metadata?: Record<string, unknown>
  events?: {
    id: string
    event: string
    from_status: string | null
    to_status: string
    message: string
    created_at: string
  }[]
  created_at: string
  updated_at: string
}
export interface Alias {
  alias: string
  kind: 'e_invoice' | 'e_despatch'
}
export interface Taxpayer {
  tax_number: string
  registered: boolean
  aliases: Alias[]
  sandbox: boolean
}
export interface CreateDocument {
  source_id: string
  kind: Kind
  profile: string
  series: string
  metadata: Record<string, unknown>
}
