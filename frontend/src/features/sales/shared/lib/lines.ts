import Decimal from 'decimal.js'
import { z } from 'zod'
import type { Item } from '@/features/catalog'
import { calendarDate } from '@/lib/forms'
import type { SalesQuote, SalesOrder } from '../api'
import {
  MAX_LINES,
  type PreviewTotalsInput,
  type SalesDocumentInput,
  type SalesKind,
  type SalesLine,
  type SalesLineInput,
} from '../types'

/** Canonical API decimal ("12", "12.500000", "-3.5"). */
export const CANONICAL = /^-?\d+(?:\.\d+)?$/

export const isDecimal = (v: string | null | undefined): v is string =>
  typeof v === 'string' && CANONICAL.test(v.trim())

/** Decimal of a form or API string; empty or malformed text counts as zero. */
export function dec(value: string | null | undefined): Decimal {
  return isDecimal(value) ? new Decimal(value.trim()) : new Decimal(0)
}

/** "1.500000" -> "1.5" for display-free comparisons and labels. */
export function trimDecimal(value: string): string {
  return isDecimal(value) ? new Decimal(value).toString() : value
}

/** Price source the server records for a typed price (sales.price_override). */
export const MANUAL_PRICE = 'manual'

export type PriceSourceGroup = 'manual' | 'list' | 'source' | 'none'

/** Label group of a price source: typed, a price list, copied from the source document, none. */
export function priceSourceGroup(source: string | null | undefined): PriceSourceGroup {
  if (source === MANUAL_PRICE) return 'manual'
  if (source === 'source') return 'source'
  if (source === 'party_price_list' || source === 'default_price_list') return 'list'
  return 'none'
}

/** The item a line refers to, as much as the editor needs of it. */
export interface LineItem {
  id: string
  code: string
  name: string
  type: 'stock' | 'service'
  base_unit_id: string
  base_unit_code?: string | null
  default_tax_code_id?: string | null
}

/** The editor's view of a picked catalog item. */
export function toLineItem(item: Item): LineItem {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    type: item.type,
    base_unit_id: item.base_unit_id,
    base_unit_code: item.base_unit?.code ?? null,
    default_tax_code_id: item.default_tax_code_id,
  }
}

export interface LineValues {
  /** Client key matching preview lines to form lines (stable across reorders). */
  key: string
  /** Stored line id ('' for new lines). */
  id: string
  itemId: string
  item: LineItem | null
  description: string
  quantity: string
  unitId: string
  unitCode: string
  /** Factor of the unit to the item's base unit. */
  factor: string
  /** '' = resolved by the server (price list); a value = explicit override. */
  unitPrice: string
  discountPercent: string
  discountAmount: string
  taxCodeId: string
  /** Variant and warehouse override of a stored line; kept unless the item changes. */
  variantId: string
  warehouseId: string
}

export interface DocValues {
  partyId: string
  partyName: string
  documentDate: string
  validUntil: string
  requestedDeliveryDate: string
  currencyCode: string
  fxRate: string
  paymentTermId: string
  priceListId: string
  warehouseId: string
  notes: string
  internalNotes: string
  lines: LineValues[]
}

let seq = 0
export function newLineKey(): string {
  seq += 1
  return `k${Date.now().toString(36)}${seq}`
}

export function emptyLine(): LineValues {
  return {
    key: newLineKey(),
    id: '',
    itemId: '',
    item: null,
    description: '',
    quantity: '',
    unitId: '',
    unitCode: '',
    factor: '1',
    unitPrice: '',
    discountPercent: '',
    discountAmount: '',
    taxCodeId: '',
    variantId: '',
    warehouseId: '',
  }
}

export function isBlankLine(l: LineValues): boolean {
  return !l.itemId && !l.quantity.trim() && !l.unitPrice.trim()
}

export interface NewDocDefaults {
  today: string
  validityDays?: number
  currencyCode?: string
  warehouseId?: string
}

/** Calendar date plus days (no time zone involved). */
export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

export function emptyValues(kind: SalesKind, defaults: NewDocDefaults): DocValues {
  return {
    partyId: '',
    partyName: '',
    documentDate: defaults.today,
    validUntil:
      kind === 'quote' ? addCalendarDays(defaults.today, defaults.validityDays ?? 30) : '',
    requestedDeliveryDate: '',
    currencyCode: defaults.currencyCode ?? 'TRY',
    fxRate: '',
    paymentTermId: '',
    priceListId: '',
    warehouseId: defaults.warehouseId ?? '',
    notes: '',
    internalNotes: '',
    lines: [emptyLine()],
  }
}

/** Factor of a stored line: base quantity / quantity (1 when it cannot be derived). */
export function factorOf(quantity: string, base: string): string {
  const q = dec(quantity)
  if (q.isZero() || !isDecimal(base)) return '1'
  return new Decimal(base).div(q).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString()
}

/** "0.0000" and "" are both "no discount" in the form. */
const optional = (v: string) => (dec(v).isZero() ? '' : trimDecimal(v))

export function lineToValues(l: SalesLine): LineValues {
  return {
    key: l.id,
    id: l.id,
    itemId: l.item_id,
    item: {
      id: l.item_id,
      code: l.item_code ?? '',
      name: l.item_name ?? '',
      type: l.item_type ?? 'stock',
      base_unit_id: l.base_unit_id ?? '',
      base_unit_code: l.base_unit_code ?? null,
    },
    description: l.description ?? '',
    quantity: trimDecimal(l.quantity),
    unitId: l.unit_id,
    unitCode: l.unit_code ?? '',
    factor: factorOf(l.quantity, l.base_quantity),
    // Resolved prices are resolved again on save; only overrides travel back as values.
    unitPrice: l.price_source === MANUAL_PRICE ? trimDecimal(l.unit_price) : '',
    discountPercent: optional(l.discount_percent),
    discountAmount: optional(l.discount_amount),
    taxCodeId: l.tax_code_id ?? '',
    variantId: l.variant_id ?? '',
    warehouseId: l.warehouse_id ?? '',
  }
}

export function toValues(doc: SalesQuote | SalesOrder): DocValues {
  return {
    partyId: doc.party_id,
    partyName: doc.party.name,
    documentDate: doc.document_date,
    validUntil: 'valid_until' in doc ? (doc.valid_until ?? '') : '',
    requestedDeliveryDate:
      'requested_delivery_date' in doc ? (doc.requested_delivery_date ?? '') : '',
    currencyCode: doc.currency_code,
    fxRate: dec(doc.fx_rate).eq(1) ? '' : trimDecimal(doc.fx_rate),
    paymentTermId: doc.payment_term_id ?? '',
    priceListId: doc.price_list_id ?? '',
    warehouseId: doc.warehouse_id ?? '',
    notes: doc.notes ?? '',
    internalNotes: doc.internal_notes ?? '',
    lines: doc.lines.length > 0 ? doc.lines.map(lineToValues) : [emptyLine()],
  }
}

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())
const orZero = (v: string) => (v.trim() === '' ? '0' : v.trim())

export function lineToInput(l: LineValues): SalesLineInput {
  return {
    item_id: l.itemId,
    variant_id: orNull(l.variantId),
    description: orNull(l.description),
    quantity: l.quantity.trim(),
    unit_id: l.unitId,
    unit_price: orNull(l.unitPrice),
    discount_percent: orZero(l.discountPercent),
    discount_amount: orZero(l.discountAmount),
    tax_code_id: orNull(l.taxCodeId),
    warehouse_id: orNull(l.warehouseId),
  }
}

/**
 * Whether the form lines would send exactly what the stored document holds. A PATCH or revise
 * then leaves the lines out, so the server keeps them as stored (prices copied from a quote stay
 * as they are instead of being resolved again).
 */
export function linesUnchanged(values: DocValues, stored: SalesQuote | SalesOrder): boolean {
  const now = values.lines.filter((l) => !isBlankLine(l)).map(lineToInput)
  const before = stored.lines.map((l) => lineToInput(lineToValues(l)))
  return JSON.stringify(now) === JSON.stringify(before)
}

/** Create / PATCH / revise body: blank lines are dropped, header fields by document kind. */
export function toInput(values: DocValues, kind: SalesKind): SalesDocumentInput {
  const input: SalesDocumentInput = {
    party_id: values.partyId,
    document_date: values.documentDate,
    currency_code: values.currencyCode,
    fx_rate: orNull(values.fxRate),
    payment_term_id: orNull(values.paymentTermId),
    price_list_id: orNull(values.priceListId),
    warehouse_id: orNull(values.warehouseId),
    notes: orNull(values.notes),
    internal_notes: orNull(values.internalNotes),
    lines: values.lines.filter((l) => !isBlankLine(l)).map(lineToInput),
  }
  if (kind === 'quote') input.valid_until = orNull(values.validUntil)
  else input.requested_delivery_date = orNull(values.requestedDeliveryDate)
  return input
}

/** A line the server can price: item, unit and a positive quantity. */
export function isPriceable(l: LineValues): boolean {
  return Boolean(l.itemId && l.unitId) && isDecimal(l.quantity) && dec(l.quantity).gt(0)
}

/**
 * Preview body for the current form: only priceable lines (keyed so results map back), or null
 * when nothing can be priced yet.
 */
export function previewInput(values: DocValues, kind: SalesKind): PreviewTotalsInput | null {
  const lines = values.lines.filter(isPriceable).map((l) => ({
    key: l.key,
    item_id: l.itemId,
    variant_id: orNull(l.variantId),
    quantity: l.quantity.trim(),
    unit_id: l.unitId,
    unit_price: isDecimal(l.unitPrice) ? l.unitPrice.trim() : null,
    discount_percent: isDecimal(l.discountPercent) ? l.discountPercent.trim() : '0',
    discount_amount: isDecimal(l.discountAmount) ? l.discountAmount.trim() : '0',
    tax_code_id: orNull(l.taxCodeId),
    warehouse_id: orNull(l.warehouseId),
  }))
  if (lines.length === 0) return null
  return {
    document_type: kind,
    party_id: orNull(values.partyId),
    document_date: values.documentDate,
    currency_code: values.currencyCode,
    fx_rate: isDecimal(values.fxRate) ? values.fxRate.trim() : null,
    price_list_id: orNull(values.priceListId),
    warehouse_id: orNull(values.warehouseId),
    lines,
  }
}

const HEADER_FIELDS: Record<string, keyof DocValues> = {
  party_id: 'partyId',
  document_date: 'documentDate',
  valid_until: 'validUntil',
  requested_delivery_date: 'requestedDeliveryDate',
  currency_code: 'currencyCode',
  fx_rate: 'fxRate',
  payment_term_id: 'paymentTermId',
  price_list_id: 'priceListId',
  warehouse_id: 'warehouseId',
  notes: 'notes',
  internal_notes: 'internalNotes',
  lines: 'lines',
}

const LINE_FIELDS: Record<string, keyof LineValues> = {
  item_id: 'itemId',
  description: 'description',
  quantity: 'quantity',
  unit_id: 'unitId',
  unit_price: 'unitPrice',
  discount_percent: 'discountPercent',
  discount_amount: 'discountAmount',
  tax_code_id: 'taxCodeId',
}

/**
 * Maps API field paths to form paths. Line indexes in the body skip blank form lines, so
 * "lines.1.quantity" is the second non-blank line; unknown fields stay unmapped (listed as text).
 */
export function serverFieldMapper(values: DocValues) {
  const formIndex = values.lines.flatMap((l, i) => (isBlankLine(l) ? [] : [i]))
  return (field: string): string | null => {
    const header = Object.hasOwn(HEADER_FIELDS, field) ? HEADER_FIELDS[field] : undefined
    if (header) return header
    const m = /^lines\.(\d+)\.([a-z_]+)$/.exec(field)
    if (!m) return null
    const index = formIndex[Number(m[1])]
    const key = m[2] ?? ''
    const name = Object.hasOwn(LINE_FIELDS, key) ? LINE_FIELDS[key] : undefined
    return index === undefined || !name ? null : `lines.${index}.${name}`
  }
}

export interface DocMessages {
  party: string
  currency: string
  minLines: string
  maxLines: string
  item: string
  unit: string
  quantity: string
  price: string
  discountPercent: string
  discountAmount: string
  validUntil: string
  fxRate: string
}

function decimalProblem(
  value: string,
  opts: { scale: number; positive?: boolean; max?: string; optional?: boolean },
): boolean {
  const v = value.trim()
  if (v === '') return !opts.optional
  if (!CANONICAL.test(v)) return true
  const d = new Decimal(v)
  if (d.decimalPlaces() > opts.scale) return true
  if (d.isNegative() && !d.isZero()) return true
  if (opts.positive && !d.gt(0)) return true
  return opts.max !== undefined && d.gt(opts.max)
}

export function docSchema(kind: SalesKind, m: DocMessages) {
  return z
    .object({
      partyId: z.string().min(1, m.party),
      partyName: z.string(),
      documentDate: calendarDate(),
      validUntil: z.string(),
      requestedDeliveryDate: z.string(),
      currencyCode: z.string().regex(/^[A-Z]{3}$/, m.currency),
      fxRate: z.string(),
      paymentTermId: z.string(),
      priceListId: z.string(),
      warehouseId: z.string(),
      notes: z.string().max(2000),
      internalNotes: z.string().max(2000),
      lines: z.array(z.custom<LineValues>()),
    })
    .superRefine((v, ctx) => {
      if (kind === 'quote' && v.validUntil && v.validUntil < v.documentDate)
        ctx.addIssue({ code: 'custom', message: m.validUntil, path: ['validUntil'] })
      if (decimalProblem(v.fxRate, { scale: 6, positive: true, optional: true }))
        ctx.addIssue({ code: 'custom', message: m.fxRate, path: ['fxRate'] })
      const filled = v.lines.filter((l) => !isBlankLine(l))
      if (filled.length === 0)
        ctx.addIssue({ code: 'custom', message: m.minLines, path: ['lines'] })
      if (filled.length > MAX_LINES)
        ctx.addIssue({ code: 'custom', message: m.maxLines, path: ['lines'] })
      v.lines.forEach((l, i) => {
        if (isBlankLine(l)) return
        const issue = (field: keyof LineValues, message: string) =>
          ctx.addIssue({ code: 'custom', message, path: ['lines', i, field] })
        if (!l.itemId) issue('itemId', m.item)
        if (l.itemId && !l.unitId) issue('unitId', m.unit)
        if (decimalProblem(l.quantity, { scale: 6, positive: true })) issue('quantity', m.quantity)
        if (decimalProblem(l.unitPrice, { scale: 4, optional: true })) issue('unitPrice', m.price)
        if (decimalProblem(l.discountPercent, { scale: 4, max: '100', optional: true }))
          issue('discountPercent', m.discountPercent)
        if (decimalProblem(l.discountAmount, { scale: 4, optional: true }))
          issue('discountAmount', m.discountAmount)
      })
    }) satisfies z.ZodType<DocValues>
}

/** Quantity in the base unit (scale 6), or null when not computable. */
export function baseQuantity(quantity: string, factor: string): string | null {
  if (!isDecimal(quantity) || !isDecimal(factor)) return null
  return new Decimal(quantity).mul(factor).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6)
}
