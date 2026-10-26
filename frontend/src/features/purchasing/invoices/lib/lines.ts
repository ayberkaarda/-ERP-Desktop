import Decimal from 'decimal.js'
import { dec, isDecimal } from '@/features/sales/invoices/kit/money'
import { lineAmounts, type LineMath } from '@/features/sales/invoices/lib/totals'
import { toIsoDate } from '@/lib/datetime'
import type { TaxCode } from '@/features/reference'
import type { Invoice, InvoiceInput, InvoiceLineInput, PreviewInput } from '../types'

export interface InvoiceLineValues {
  itemId: string
  itemLabel: string
  itemType: 'stock' | 'service' | ''
  description: string
  quantity: string
  unitId: string
  unitPrice: string
  /** Price of the receipt/order line it came from ('' for direct lines). */
  sourcePrice: string
  discountPercent: string
  discountAmount: string
  taxCodeId: string
  /** Rate of the tax code (percent), for the editor estimate. */
  taxRate: string
  withholdingCodeId: string
  /** Withheld share of the VAT in percent ("50" for 5/10). */
  withholdingRate: string
  receiptLineId: string
  orderLineId: string
  /** Kept from the stored line (not edited here) so a save does not change them. */
  taxInclusive: boolean
  variantId: string
  lineWarehouseId: string
}

export interface InvoiceValues {
  partyId: string
  partyLabel: string
  supplierInvoiceNo: string
  documentDate: string
  dueDate: string
  currencyCode: string
  /** Rate as stored or typed (verbatim, '1' included). */
  fxRate: string
  /** True: send fx_rate null so the server takes the day's rate. */
  fxAuto: boolean
  paymentTermId: string
  warehouseId: string
  notes: string
  internalNotes: string
  receiveOnInvoice: boolean
  lines: InvoiceLineValues[]
}

export function emptyInvoiceLine(): InvoiceLineValues {
  return {
    itemId: '',
    itemLabel: '',
    itemType: '',
    description: '',
    quantity: '1',
    unitId: '',
    unitPrice: '',
    sourcePrice: '',
    discountPercent: '0',
    discountAmount: '0',
    taxCodeId: '',
    taxRate: '0',
    withholdingCodeId: '',
    withholdingRate: '0',
    receiptLineId: '',
    orderLineId: '',
    taxInclusive: false,
    variantId: '',
    lineWarehouseId: '',
  }
}

export function emptyInvoice(currency = 'TRY'): InvoiceValues {
  return {
    partyId: '',
    partyLabel: '',
    supplierInvoiceNo: '',
    documentDate: toIsoDate(new Date()),
    dueDate: '',
    currencyCode: currency,
    fxRate: '',
    fxAuto: true,
    paymentTermId: '',
    warehouseId: '',
    notes: '',
    internalNotes: '',
    receiveOnInvoice: false,
    lines: [emptyInvoiceLine()],
  }
}

/** A line nobody filled in: dropped on save. */
export function isBlankInvoiceLine(l: InvoiceLineValues): boolean {
  return !l.itemId && !l.receiptLineId && !l.orderLineId && l.description.trim() === ''
}

/** A line taken from a receipt or order line (item, unit, tax fixed by the source). */
export const isSourced = (l: InvoiceLineValues) => l.receiptLineId !== '' || l.orderLineId !== ''

const label = (code?: string | null, name?: string | null) =>
  [code, name].filter((x) => x).join(' · ')

export function valuesFromInvoice(inv: Invoice): InvoiceValues {
  return {
    partyId: inv.party_id,
    partyLabel: inv.party_snapshot.name || (inv.party_name ?? ''),
    supplierInvoiceNo: inv.supplier_invoice_no ?? '',
    documentDate: inv.document_date,
    dueDate: inv.due_date ?? '',
    currencyCode: inv.currency_code,
    fxRate: inv.fx_rate,
    fxAuto: false,
    paymentTermId: inv.payment_term_id ?? '',
    warehouseId: inv.warehouse_id ?? '',
    notes: inv.notes ?? '',
    internalNotes: inv.internal_notes ?? '',
    receiveOnInvoice: inv.receive_on_invoice,
    lines: inv.lines.map((l) => {
      const sourced = l.receipt_line_id !== null || l.order_line_id !== null
      return {
        itemId: l.item_id,
        itemLabel: label(l.item_code, l.item_name),
        itemType: l.item_type ?? '',
        description: l.description ?? '',
        quantity: l.quantity,
        unitId: l.unit_id,
        unitPrice: l.unit_price,
        // A sourced line keeps its source price unless overridden (price_source manual).
        sourcePrice: sourced && l.price_source !== 'manual' ? l.unit_price : '',
        discountPercent: l.discount_percent,
        discountAmount: l.discount_amount,
        taxCodeId: l.tax_code_id ?? '',
        taxRate: l.tax_rate,
        withholdingCodeId: l.withholding_code_id ?? '',
        withholdingRate: l.withholding_rate,
        receiptLineId: l.receipt_line_id ?? '',
        taxInclusive: l.tax_inclusive,
        variantId: l.variant_id ?? '',
        lineWarehouseId: l.warehouse_id ?? '',
        orderLineId: l.order_line_id ?? '',
      }
    }),
  }
}

/** Explicit rate verbatim; null only when automatic resolution is asked for. */
export function fxRateOf(values: InvoiceValues): string | null {
  return !values.fxAuto && isDecimal(values.fxRate) ? values.fxRate : null
}

export function sentInvoiceLines(values: InvoiceValues) {
  return values.lines.flatMap((line, index) => (isBlankInvoiceLine(line) ? [] : [{ line, index }]))
}

/**
 * The API line: sourced lines send only the source id, quantity and price (the server copies
 * item, unit, discount and tax from the source); direct lines send the full item line.
 */
export function toLineInput(l: InvoiceLineValues): InvoiceLineInput {
  if (l.receiptLineId || l.orderLineId) {
    return {
      ...(l.receiptLineId
        ? { receipt_line_id: l.receiptLineId }
        : { order_line_id: l.orderLineId }),
      quantity: l.quantity,
      unit_price: isDecimal(l.unitPrice) ? l.unitPrice : null,
    }
  }
  return {
    item_id: l.itemId,
    description: l.description.trim() || null,
    quantity: l.quantity,
    unit_id: l.unitId,
    unit_price: isDecimal(l.unitPrice) ? l.unitPrice : null,
    discount_percent: isDecimal(l.discountPercent) ? l.discountPercent : '0',
    discount_amount: isDecimal(l.discountAmount) ? l.discountAmount : '0',
    tax_code_id: l.taxCodeId || null,
    withholding_code_id: l.withholdingCodeId || null,
    tax_inclusive: l.taxInclusive,
    variant_id: l.variantId || null,
    warehouse_id: l.lineWarehouseId || null,
  }
}

export function toInvoiceInput(values: InvoiceValues): InvoiceInput {
  return {
    party_id: values.partyId,
    supplier_invoice_no: values.supplierInvoiceNo.trim() || null,
    document_date: values.documentDate,
    due_date: values.dueDate || null,
    currency_code: values.currencyCode,
    fx_rate: fxRateOf(values),
    payment_term_id: values.paymentTermId || null,
    warehouse_id: values.warehouseId || null,
    notes: values.notes.trim() || null,
    internal_notes: values.internalNotes.trim() || null,
    receive_on_invoice: values.receiveOnInvoice,
    lines: sentInvoiceLines(values).map(({ line }) => toLineInput(line)),
  }
}

/** Form indexes of the rows sent to preview-totals, in order (request and answer mapping). */
export function previewRowIndexes(values: InvoiceValues): number[] {
  return sentInvoiceLines(values)
    .filter(({ line }) => line.itemId !== '' && isDecimal(line.quantity) && line.unitId !== '')
    .map(({ index }) => index)
}

export function previewLineFor<T>(
  values: InvoiceValues,
  preview: { lines: readonly T[] } | null | undefined,
  index: number,
): T | undefined {
  const at = previewRowIndexes(values).indexOf(index)
  return at < 0 ? undefined : preview?.lines[at]
}

export function toPreviewInput(values: InvoiceValues): PreviewInput | null {
  const rows = previewRowIndexes(values).flatMap((i) => {
    const line = values.lines[i]
    return line ? [line] : []
  })
  if (rows.length === 0 || !values.documentDate || !values.partyId) return null
  return {
    party_id: values.partyId,
    document_date: values.documentDate,
    currency_code: values.currencyCode,
    fx_rate: fxRateOf(values),
    lines: rows.map((l) => ({
      item_id: l.itemId,
      quantity: l.quantity,
      unit_id: l.unitId,
      unit_price: isDecimal(l.unitPrice) ? l.unitPrice : null,
      discount_percent: isDecimal(l.discountPercent) ? l.discountPercent : '0',
      discount_amount: isDecimal(l.discountAmount) ? l.discountAmount : '0',
      tax_code_id: l.taxCodeId || null,
      withholding_code_id: l.withholdingCodeId || null,
      tax_inclusive: l.taxInclusive,
      variant_id: l.variantId || null,
    })),
  }
}

/** Withheld share of the VAT of a withholding code (numerator/denominator, else its rate). */
export function withholdingPercent(
  code: Pick<TaxCode, 'numerator' | 'denominator' | 'rate'> | undefined,
): string {
  if (!code) return '0'
  if (code.numerator !== null && code.denominator !== null && code.denominator > 0)
    return new Decimal(code.numerator).mul(100).div(code.denominator).toDecimalPlaces(4).toString()
  return code.rate ?? '0'
}

export interface PurchaseLineAmounts {
  net: string
  tax: string
  withholding: string
  total: string
}

/** Editor estimate: sales line rule plus withholding = round(tax × withheld % / 100). */
export function purchaseLineAmounts(l: InvoiceLineValues): PurchaseLineAmounts {
  const math: LineMath = {
    quantity: l.quantity,
    unitPrice: isDecimal(l.unitPrice) ? l.unitPrice : '0',
    discountPercent: l.discountPercent,
    discountAmount: l.discountAmount,
    taxRate: l.taxRate,
  }
  const a = lineAmounts(math)
  const withholding = dec(a.tax)
    .mul(dec(l.withholdingRate))
    .div(100)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  return { net: a.net, tax: a.tax, withholding: withholding.toFixed(2), total: a.total }
}

export interface EstimatedTotals {
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  withholding_total: string
}

/** Editor estimate of the header totals (before the server preview answers). */
export function estimateTotals(values: InvoiceValues): EstimatedTotals {
  let subtotal = new Decimal(0)
  let discount = new Decimal(0)
  let tax = new Decimal(0)
  let net = new Decimal(0)
  let withholding = new Decimal(0)
  for (const { line } of sentInvoiceLines(values)) {
    const a = lineAmounts({
      quantity: line.quantity,
      unitPrice: isDecimal(line.unitPrice) ? line.unitPrice : '0',
      discountPercent: line.discountPercent,
      discountAmount: line.discountAmount,
      taxRate: line.taxRate,
    })
    subtotal = subtotal.plus(a.gross)
    discount = discount.plus(a.discount)
    tax = tax.plus(a.tax)
    net = net.plus(a.net)
    withholding = withholding.plus(purchaseLineAmounts(line).withholding)
  }
  return {
    subtotal: subtotal.toFixed(2),
    discount_total: discount.toFixed(2),
    tax_total: tax.toFixed(2),
    total: net.plus(tax).toFixed(2),
    withholding_total: withholding.toFixed(2),
  }
}

/** A sourced line whose price differs from its source: needs purchasing.price_override. */
export function priceOverridden(l: InvoiceLineValues): boolean {
  return (
    isSourced(l) &&
    l.sourcePrice !== '' &&
    isDecimal(l.unitPrice) &&
    !dec(l.unitPrice).equals(dec(l.sourcePrice))
  )
}

/** Stock goods on the invoice without a receipt line (need receive_on_invoice to book). */
export function unreceivedGoods(values: InvoiceValues): number {
  return sentInvoiceLines(values).filter(
    ({ line }) => line.itemType === 'stock' && line.receiptLineId === '',
  ).length
}

/** Server `lines.N.field` (N among sent lines) -> form path. */
export function invoiceFieldMapper(values: InvoiceValues) {
  const sent = sentInvoiceLines(values)
  const FIELD: Record<string, keyof InvoiceLineValues> = {
    item_id: 'itemId',
    description: 'description',
    quantity: 'quantity',
    unit_id: 'unitId',
    unit_price: 'unitPrice',
    discount_percent: 'discountPercent',
    discount_amount: 'discountAmount',
    tax_code_id: 'taxCodeId',
    withholding_code_id: 'withholdingCodeId',
    receipt_line_id: 'quantity',
    order_line_id: 'quantity',
  }
  const HEADER: Record<string, string> = {
    party_id: 'partyId',
    supplier_invoice_no: 'supplierInvoiceNo',
    document_date: 'documentDate',
    due_date: 'dueDate',
    currency_code: 'currencyCode',
    fx_rate: 'fxRate',
    payment_term_id: 'paymentTermId',
    warehouse_id: 'warehouseId',
    notes: 'notes',
    internal_notes: 'internalNotes',
    receive_on_invoice: 'receiveOnInvoice',
    lines: 'lines',
  }
  return (path: string): string => {
    const m = /^lines\.(\d+)\.([a-z_]+)/.exec(path)
    if (m) {
      const index = sent[Number(m[1])]?.index
      const field = FIELD[m[2] ?? '']
      return index !== undefined && field ? `lines.${index}.${field}` : 'lines'
    }
    return HEADER[path] ?? path
  }
}

export interface InvoiceLineMessages {
  item: string
  unit: string
  quantity: string
  price: string
  discount: string
}

export function invoiceLineProblems(
  l: InvoiceLineValues,
  m: InvoiceLineMessages,
): [keyof InvoiceLineValues, string][] {
  if (isBlankInvoiceLine(l)) return []
  const out: [keyof InvoiceLineValues, string][] = []
  const sourced = isSourced(l)
  if (!sourced && !l.itemId) out.push(['itemId', m.item])
  if (!sourced && !l.unitId) out.push(['unitId', m.unit])
  if (!isDecimal(l.quantity) || dec(l.quantity).lessThanOrEqualTo(0))
    out.push(['quantity', m.quantity])
  // Purchases have no price list: direct lines need a price.
  if (!sourced && (!isDecimal(l.unitPrice) || dec(l.unitPrice).isNegative()))
    out.push(['unitPrice', m.price])
  if (sourced && l.unitPrice !== '' && (!isDecimal(l.unitPrice) || dec(l.unitPrice).isNegative()))
    out.push(['unitPrice', m.price])
  const pct = dec(l.discountPercent)
  if (!isDecimal(l.discountPercent) || pct.isNegative() || pct.greaterThan(100))
    out.push(['discountPercent', m.discount])
  if (!isDecimal(l.discountAmount) || dec(l.discountAmount).isNegative())
    out.push(['discountAmount', m.discount])
  return out
}
