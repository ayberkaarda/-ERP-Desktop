import Decimal from 'decimal.js'
import { dec, isDecimal } from '@/features/sales/invoices/kit/money'
import { toIsoDate } from '@/lib/datetime'
import type {
  DirectReceiptLineInput,
  OrderReceiptLineInput,
  OrderSource,
  Receipt,
  ReceiptFromOrderInput,
  ReceiptInput,
} from '../types'

export type Tracking = 'none' | 'lot' | 'serial'

export interface ReceiptLineValues {
  /** Order line received ('' on direct receipts). */
  orderLineId: string
  itemId: string
  itemLabel: string
  tracking: Tracking
  hasExpiry: boolean
  unitId: string
  unitCode: string
  quantity: string
  /** Ordered − received of the order line (hint; the server bounds with its tolerance). */
  remaining: string
  /** Direct receipts only: the price and VAT code (no order to copy them from). */
  unitPrice: string
  taxCodeId: string
  lotNo: string
  expiryDate: string
  /** Serial numbers, one per row. */
  serialsText: string
  /** Base units per document unit (base_quantity / quantity of the source line; '1' if unknown). */
  baseFactor: string
  // Fields kept from the stored line so a save does not reset them (the API rebuilds lines).
  locationId: string
  variantId: string
  taxInclusive: boolean
  discountPercent: string
  discountAmount: string
  withholdingCodeId: string
  description: string
}

export interface ReceiptValues {
  /** Order-based receipt: header supplier, currency and line items come from the order. */
  orderId: string
  partyId: string
  partyLabel: string
  currencyCode: string
  documentDate: string
  warehouseId: string
  supplierReference: string
  notes: string
  lines: ReceiptLineValues[]
}

export function emptyReceiptLine(): ReceiptLineValues {
  return {
    orderLineId: '',
    itemId: '',
    itemLabel: '',
    tracking: 'none',
    hasExpiry: false,
    unitId: '',
    unitCode: '',
    quantity: '',
    remaining: '',
    unitPrice: '',
    taxCodeId: '',
    lotNo: '',
    expiryDate: '',
    serialsText: '',
    baseFactor: '1',
    locationId: '',
    variantId: '',
    taxInclusive: false,
    discountPercent: '0',
    discountAmount: '0',
    withholdingCodeId: '',
    description: '',
  }
}

export function emptyReceipt(currency = 'TRY'): ReceiptValues {
  return {
    orderId: '',
    partyId: '',
    partyLabel: '',
    currencyCode: currency,
    documentDate: toIsoDate(new Date()),
    warehouseId: '',
    supplierReference: '',
    notes: '',
    lines: [emptyReceiptLine()],
  }
}

const label = (code?: string | null, name?: string | null) =>
  [code, name].filter((x) => x).join(' · ')

/** Serials typed one per row (or separated by commas/semicolons), trimmed, empty rows dropped. */
export function parseSerials(text: string): string[] {
  return text
    .split(/[\n,;\t]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export function duplicateSerials(serials: readonly string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const s of serials) {
    if (seen.has(s)) dup.add(s)
    seen.add(s)
  }
  return [...dup]
}

/** Base units per document unit of a stored line ('1' when the quantity is zero). */
export function factorOf(l: { quantity: string; base_quantity: string }): string {
  const q = dec(l.quantity)
  return q.isZero() ? '1' : dec(l.base_quantity).div(q).toString()
}

/** Serials a line needs: one per base unit received. */
export function serialsNeeded(l: Pick<ReceiptLineValues, 'quantity' | 'baseFactor'>): Decimal {
  return dec(l.quantity).mul(dec(l.baseFactor || '1'))
}

/** Remaining quantity of an order line (never negative). */
export function remainingOf(line: { quantity: string; received_quantity: string }): string {
  return Decimal.max(dec(line.quantity).minus(dec(line.received_quantity)), 0).toString()
}

/** New receipt for an order: its open stock lines at the remaining quantity. */
export function valuesFromOrder(order: OrderSource, today = toIsoDate(new Date())): ReceiptValues {
  return {
    orderId: order.id,
    partyId: order.party_id,
    partyLabel: order.party_name ?? '',
    currencyCode: order.currency_code,
    documentDate: today,
    warehouseId: order.warehouse_id ?? '',
    supplierReference: '',
    notes: '',
    lines: order.lines
      .filter((l) => l.item_type !== 'service')
      .map((l) => {
        const remaining = remainingOf(l)
        return {
          ...emptyReceiptLine(),
          orderLineId: l.id,
          itemId: l.item_id,
          itemLabel: label(l.item_code, l.item_name) || (l.description ?? ''),
          tracking: l.item_tracking,
          hasExpiry: l.item_has_expiry,
          unitId: l.unit_id,
          unitCode: l.unit_code ?? '',
          quantity: remaining,
          remaining,
          baseFactor: factorOf(l),
          variantId: l.variant_id ?? '',
        }
      })
      .filter((l) => dec(l.remaining).greaterThan(0)),
  }
}

export function valuesFromReceipt(r: Receipt, order?: OrderSource | null): ReceiptValues {
  return {
    orderId: r.order_id ?? '',
    partyId: r.party_id,
    partyLabel: r.party_snapshot.name || (r.party_name ?? ''),
    currencyCode: r.currency_code,
    documentDate: r.document_date,
    warehouseId: r.warehouse_id ?? '',
    supplierReference: r.supplier_reference ?? '',
    notes: r.notes ?? '',
    lines: r.lines.map((l) => {
      const src = order?.lines.find((o) => o.id === l.order_line_id)
      return {
        orderLineId: l.order_line_id ?? '',
        itemId: l.item_id,
        itemLabel: label(l.item_code, l.item_name) || (l.description ?? ''),
        tracking: l.item_tracking,
        hasExpiry: l.item_has_expiry,
        unitId: l.unit_id,
        unitCode: l.unit_code ?? '',
        quantity: l.quantity,
        // received_quantity counts posted receipts only; other drafts are checked by the server.
        remaining: src ? remainingOf(src) : '',
        unitPrice: l.unit_price,
        taxCodeId: l.tax_code_id ?? '',
        lotNo: l.lot_no ?? '',
        expiryDate: l.expiry_date ?? '',
        serialsText: l.serial_numbers.join('\n'),
        baseFactor: factorOf(l),
        locationId: l.location_id ?? '',
        variantId: l.variant_id ?? '',
        taxInclusive: l.tax_inclusive,
        discountPercent: l.discount_percent,
        discountAmount: l.discount_amount,
        withholdingCodeId: l.withholding_code_id ?? '',
        description: l.description ?? '',
      }
    }),
  }
}

/** A line nobody filled in: dropped on save. Zero-quantity order lines are not received. */
export function isSkippedLine(l: ReceiptLineValues): boolean {
  if (l.orderLineId) return !isDecimal(l.quantity) || dec(l.quantity).isZero()
  return !l.itemId
}

export function sentReceiptLines(values: ReceiptValues) {
  return values.lines.flatMap((line, index) => (isSkippedLine(line) ? [] : [{ line, index }]))
}

function tracking(l: ReceiptLineValues) {
  return {
    lot_no: l.tracking !== 'none' ? l.lotNo.trim() || null : null,
    expiry_date: l.hasExpiry || l.expiryDate ? l.expiryDate || null : null,
    serial_numbers: l.tracking === 'serial' ? parseSerials(l.serialsText) : [],
  }
}

export function toLineInput(l: ReceiptLineValues): OrderReceiptLineInput | DirectReceiptLineInput {
  const location = { location_id: l.locationId || null }
  if (l.orderLineId)
    return { order_line_id: l.orderLineId, quantity: l.quantity, ...tracking(l), ...location }
  return {
    item_id: l.itemId,
    variant_id: l.variantId || null,
    unit_id: l.unitId,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    tax_code_id: l.taxCodeId || null,
    tax_inclusive: l.taxInclusive,
    discount_percent: isDecimal(l.discountPercent) ? l.discountPercent : '0',
    discount_amount: isDecimal(l.discountAmount) ? l.discountAmount : '0',
    withholding_code_id: l.withholdingCodeId || null,
    description: l.description.trim() || null,
    ...tracking(l),
    ...location,
  }
}

export function toFromOrderInput(values: ReceiptValues): ReceiptFromOrderInput {
  return {
    document_date: values.documentDate,
    warehouse_id: values.warehouseId,
    supplier_reference: values.supplierReference.trim() || null,
    notes: values.notes.trim() || null,
    lines: sentReceiptLines(values).map(({ line }) => toLineInput(line) as OrderReceiptLineInput),
  }
}

export function toReceiptInput(values: ReceiptValues): ReceiptInput {
  return {
    ...(values.orderId ? {} : { party_id: values.partyId, currency_code: values.currencyCode }),
    document_date: values.documentDate,
    warehouse_id: values.warehouseId,
    supplier_reference: values.supplierReference.trim() || null,
    notes: values.notes.trim() || null,
    lines: sentReceiptLines(values).map(({ line }) => toLineInput(line)),
  }
}

/**
 * Splits line `index` for another lot: a copy of the line with the remaining quantity moved to
 * it when the original holds more than one unit, else an empty quantity. Tracking is cleared.
 */
export function splitLine(lines: readonly ReceiptLineValues[], index: number): ReceiptLineValues[] {
  const line = lines[index]
  if (!line) return [...lines]
  const copy: ReceiptLineValues = {
    ...line,
    quantity: '',
    lotNo: '',
    expiryDate: '',
    serialsText: '',
  }
  return [...lines.slice(0, index + 1), copy, ...lines.slice(index + 1)]
}

/** Sum of the quantities of all lines for one order line (split lots add up). */
export function receivedOnForm(lines: readonly ReceiptLineValues[], orderLineId: string): Decimal {
  return lines
    .filter((l) => l.orderLineId === orderLineId)
    .reduce((acc, l) => acc.plus(dec(l.quantity)), new Decimal(0))
}

export interface ReceiptLineMessages {
  item: string
  unit: string
  quantity: string
  price: string
  lot: string
  expiry: string
  serialCount: string
  serialDuplicate: string
}

/** Client checks of one line: tracking completeness (lot, expiry, serial count = quantity). */
export function receiptLineProblems(
  l: ReceiptLineValues,
  m: ReceiptLineMessages,
): [keyof ReceiptLineValues, string][] {
  if (isSkippedLine(l)) return []
  const out: [keyof ReceiptLineValues, string][] = []
  if (!l.orderLineId && !l.itemId) out.push(['itemId', m.item])
  if (!l.orderLineId && !l.unitId) out.push(['unitId', m.unit])
  if (!isDecimal(l.quantity) || dec(l.quantity).lessThanOrEqualTo(0))
    out.push(['quantity', m.quantity])
  if (!l.orderLineId && (!isDecimal(l.unitPrice) || dec(l.unitPrice).isNegative()))
    out.push(['unitPrice', m.price])
  if (l.tracking === 'lot' && l.lotNo.trim() === '') out.push(['lotNo', m.lot])
  if (l.hasExpiry && l.expiryDate === '') out.push(['expiryDate', m.expiry])
  if (l.tracking === 'serial') {
    const serials = parseSerials(l.serialsText)
    if (duplicateSerials(serials).length > 0) out.push(['serialsText', m.serialDuplicate])
    else if (!isDecimal(l.quantity) || !serialsNeeded(l).equals(serials.length))
      out.push(['serialsText', m.serialCount])
  }
  return out
}
