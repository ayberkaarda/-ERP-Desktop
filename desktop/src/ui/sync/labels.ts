// Readable names for the sync screens: a resource's localized name, a
// record's label (name, or document number / "unnumbered" with the party,
// as the web lists show them), a field's localized label and the fields of a
// version conflict worth asking about.

import type { DesktopText } from '../../sync'

const RESOURCES = {
  parties: 'sync.resource.parties',
  items: 'sync.resource.items',
  'items.variants': 'sync.resource.items_variants',
  'items.barcodes': 'sync.resource.items_barcodes',
  'price-lists': 'sync.resource.price_lists',
  'price-lists.lines': 'sync.resource.price_lists_lines',
  'sales-quotes': 'sync.resource.sales_quotes',
  'sales-orders': 'sync.resource.sales_orders',
  'stock-documents': 'sync.resource.stock_documents',
  'purchase-requests': 'sync.resource.purchase_requests',
  'treasury-payments': 'sync.resource.treasury_payments',
} as const

const FIELDS = [
  'name',
  'code',
  'notes',
  'internal_notes',
  'description',
  'tax_number',
  'tax_office',
  'email',
  'phone',
  'address',
  'billing_address',
  'shipping_address',
  'party_id',
  'document_date',
  'valid_until',
  'delivery_date',
  'payment_term_id',
  'warehouse_id',
  'price_list_id',
  'currency',
  'currency_code',
  'reference',
  'is_active',
  'roles',
  'unit_id',
  'category_id',
  'lines',
  'legal_name',
  'type',
  'country',
  'default_currency_code',
  'risk_limit',
  'risk_currency_code',
  'tags',
  'due_date',
  'cost_center_id',
  'project_id',
  'requested_delivery_date',
  'fx_rate',
  'item_id',
  'variant_id',
  'quantity',
  'unit_price',
  'price',
  'discount_percent',
  'discount_amount',
  'tax_code_id',
  'tax_inclusive',
  'lot_no',
  'serial_numbers',
  'base_unit_id',
  'default_tax_code_id',
  'purchase_tax_code_id',
  'tracking',
  'has_expiry',
  'min_stock',
  'reorder_point',
  'attributes',
  'sku',
  'barcode',
  'is_primary',
  'is_default',
  'factor',
  'parent_id',
  'doc_type',
  'target_warehouse_id',
  'reason',
  'unit_cost',
  'expiry_date',
  'location_id',
  'target_location_id',
  'counted_quantity',
  'valid_from',
  'valid_to',
  'amount',
  'account_id',
  'direction',
  'counterparty_module',
  'allocations',
] as const

/**
 * Decimal fields: '2.000' and 2 are the same quantity. Anything else
 * compares as text, so '05321234567' is not '5321234567'.
 */
const NUMERIC = new Set([
  'quantity',
  'counted_quantity',
  'unit_price',
  'price',
  'unit_cost',
  'discount_percent',
  'discount_amount',
  'risk_limit',
  'min_stock',
  'reorder_point',
  'factor',
  'fx_rate',
])

function isNumericField(field: string | undefined): boolean {
  return field !== undefined && (NUMERIC.has(field) || /_(rate|amount|total|percent|quantity|price|cost)$/.test(field))
}

/** Documents whose number comes from the server: unnumbered until pushed. */
const NUMBERED = new Set([
  'sales-quotes',
  'sales-orders',
  'stock-documents',
  'purchase-requests',
  'treasury-payments',
])

/**
 * Fields the server computes or owns: never a choice for the user, even when
 * the server lists them as conflicting (party snapshot, totals, rates, state).
 */
const SERVER_FIELDS = new Set([
  'id',
  'version',
  'number',
  'status',
  'company_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'updated_by',
  'party_name',
  'party_tax_number',
  'party_tax_office',
  'fx_rate',
  'subtotal',
  'tax_total',
  'discount_total',
  'grand_total',
  'total',
  'estimated_total',
])

/**
 * Fields the server overwrites on every write of one resource only: the
 * `when: ["*"]` rules of `write.derived_fields` in
 * contracts/offline-manifest.json (labels.test.ts keeps the two in step).
 * Per resource, because a sales document's currency_code is the user's.
 */
const RESOURCE_SERVER_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  'purchase-requests': new Set(['currency_code']),
  'treasury-payments': new Set(['currency_code', 'fx_rate']),
}

/** Web routes where a record of the resource can be opened and edited. */
const RECORD_PATHS: Readonly<Record<string, (id: string) => string>> = {
  parties: (id) => `/parties/${id}/edit`,
  items: (id) => `/catalog/items/${id}`,
  'sales-quotes': (id) => `/sales/quotes/${id}`,
  'sales-orders': (id) => `/sales/orders/${id}`,
  'treasury-payments': (id) => `/treasury/payments/${id}`,
}

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

/** `payment_term_id` → "Payment term", `items.variants` → "Items variants". */
export function humanize(name: string): string {
  const words = name
    .replace(/_id$/, '')
    .split(/[._\s-]+/)
    .filter(Boolean)
    .join(' ')
  return capitalize(words)
}

export function resourceName(text: DesktopText, resource: string): string {
  return Object.hasOwn(RESOURCES, resource)
    ? text.td(RESOURCES[resource as keyof typeof RESOURCES])
    : humanize(resource)
}

function oneField(text: DesktopText, field: string): string {
  return isOneOf(FIELDS, field) ? text.td(`sync.field.${field}`) : humanize(field)
}

/**
 * A field's label; a server error path too: `lines.0.quantity` is
 * "Line 1 · Quantity", `serial_numbers.2` is "Serial numbers",
 * `billing_address.city` is "Billing address · City".
 */
export function fieldName(text: DesktopText, field: string): string {
  const path = field.replace(/(\.\d+)+$/, '')
  const line = /^lines\.(\d+)\.(.+)$/.exec(path)
  if (line?.[1] !== undefined && line[2] !== undefined) {
    return text.td('sync.field.lineField', { number: Number(line[1]) + 1, field: fieldName(text, line[2]) })
  }
  const [head, ...rest] = path.split('.')
  if (head !== undefined && rest.length > 0) return `${oneField(text, head)} · ${fieldName(text, rest.join('.'))}`
  return oneField(text, path)
}

function textOf(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/**
 * A record's label from a row or a draft payload: its name, else its document
 * number (or "unnumbered" for a document) with the party, else its code.
 * `null` when the row says nothing a person would recognise.
 */
export function recordLabel(
  resource: string,
  value: unknown,
  unnumbered: string,
): string | null {
  const row = asRecord(value)
  if (!row) return null
  const name = textOf(row, 'name') ?? textOf(row, 'title')
  if (name) return name
  const party = asRecord(row.party)
  const partyName = textOf(row, 'party_name') ?? (party ? textOf(party, 'name') : null)
  const number = textOf(row, 'number') ?? textOf(row, 'document_number')
  if (number) return partyName ? `${number} · ${partyName}` : number
  if (partyName) return NUMBERED.has(resource) ? `${unnumbered} · ${partyName}` : partyName
  return textOf(row, 'code')
}

/** Last characters of an id: what is left when nothing names the record. */
export function shortId(id: string): string {
  return `…${id.slice(-6)}`
}

export function isNumbered(resource: string): boolean {
  return NUMBERED.has(resource)
}

export function recordPath(resource: string, id: string): string | null {
  return Object.hasOwn(RECORD_PATHS, resource) ? (RECORD_PATHS[resource]?.(id) ?? null) : null
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T/

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

function blank(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * Whether the draft's value is what the server has. A decimal field (or a
 * JSON number) compares by value, a date by its day, and an object only by the keys
 * the draft sent (a server line carries its own computed fields).
 */
export function sameValue(mine: unknown, server: unknown, field?: string): boolean {
  if (blank(mine) && blank(server)) return true
  // By value only for a decimal field, or when one side is a JSON number.
  if (isNumericField(field) || typeof mine === 'number' || typeof server === 'number') {
    const a = numeric(mine)
    const b = numeric(server)
    if (a !== null && b !== null) return a === b
  }
  if (typeof mine === 'string' && typeof server === 'string') {
    if (DATE_ONLY.test(mine) && DATE_TIME.test(server)) return server.startsWith(mine)
    if (DATE_ONLY.test(server) && DATE_TIME.test(mine)) return mine.startsWith(server)
    return mine === server
  }
  if (Array.isArray(mine) && Array.isArray(server)) {
    return mine.length === server.length && mine.every((value, index) => sameValue(value, server[index], field))
  }
  const left = asRecord(mine)
  const right = asRecord(server)
  if (left && right) return Object.entries(left).every(([key, value]) => sameValue(value, right[key], key))
  return mine === server
}

export function isServerField(field: string, resource?: string): boolean {
  return (
    SERVER_FIELDS.has(field) ||
    field.endsWith('_local') ||
    (resource !== undefined && RESOURCE_SERVER_FIELDS[resource]?.has(field) === true)
  )
}

/**
 * The conflicting fields to ask about: those the draft itself sent, that the
 * user can edit, and whose values really differ from the server's.
 */
export function differingFields(
  fields: readonly string[],
  mine: Record<string, unknown>,
  server: Record<string, unknown>,
  resource?: string,
): string[] {
  return fields.filter(
    (field) => !isServerField(field, resource) && Object.hasOwn(mine, field) && !sameValue(mine[field], server[field], field),
  )
}
