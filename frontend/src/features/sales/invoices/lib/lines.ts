import { toIsoDate } from '@/lib/datetime'
import { dec, isDecimal } from '../kit/money'
import type { Invoice } from '../api'
import type { InvoiceInput, InvoiceLineInput, InvoiceType, PreviewInput } from '../types'
import { documentAmounts, type LineMath } from './totals'

export interface InvoiceLineValues {
  itemId: string
  itemLabel: string
  itemType: 'stock' | 'service' | ''
  description: string
  quantity: string
  unitId: string
  /** '' lets the server resolve the price (PriceResolver); typing one needs price_override. */
  unitPrice: string
  discountPercent: string
  discountAmount: string
  taxCodeId: string
  /** Rate of the tax code (percent), for the editor estimate. */
  taxRate: string
  deliveryLineId: string
  sourceLineId: string
}

export interface InvoiceValues {
  partyId: string
  partyLabel: string
  invoiceType: InvoiceType
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
  deliverOnInvoice: boolean
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
    discountPercent: '0',
    discountAmount: '0',
    taxCodeId: '',
    taxRate: '0',
    deliveryLineId: '',
    sourceLineId: '',
  }
}

export function emptyInvoice(currency = 'TRY'): InvoiceValues {
  return {
    partyId: '',
    partyLabel: '',
    invoiceType: 'sale',
    documentDate: toIsoDate(new Date()),
    dueDate: '',
    currencyCode: currency,
    fxRate: '',
    fxAuto: true,
    paymentTermId: '',
    warehouseId: '',
    notes: '',
    internalNotes: '',
    deliverOnInvoice: false,
    lines: [emptyInvoiceLine()],
  }
}

/** A line nobody filled in (no item and no description): dropped on save. */
export function isBlankInvoiceLine(l: InvoiceLineValues): boolean {
  return !l.itemId && l.description.trim() === ''
}

const label = (code?: string | null, name?: string | null) =>
  [code, name].filter((x) => x).join(' · ')

export function valuesFromInvoice(inv: Invoice): InvoiceValues {
  return {
    partyId: inv.party_id,
    partyLabel: inv.party_snapshot?.name ?? inv.party_name ?? '',
    invoiceType: inv.invoice_type,
    documentDate: inv.document_date,
    dueDate: inv.due_date ?? '',
    currencyCode: inv.currency_code,
    fxRate: inv.fx_rate,
    fxAuto: false,
    paymentTermId: inv.payment_term_id ?? '',
    warehouseId: inv.warehouse_id ?? '',
    notes: inv.notes ?? '',
    internalNotes: inv.internal_notes ?? '',
    deliverOnInvoice: inv.deliver_on_invoice ?? false,
    lines: inv.lines.map((l) => ({
      itemId: l.item_id ?? '',
      itemLabel: label(l.item_code, l.item_name),
      itemType: l.item_type ?? '',
      description: l.description ?? '',
      quantity: l.quantity,
      unitId: l.unit_id,
      unitPrice: l.unit_price,
      discountPercent: l.discount_percent,
      discountAmount: l.discount_amount,
      taxCodeId: l.tax_code_id ?? '',
      taxRate: l.tax_rate,
      deliveryLineId: l.delivery_line_id ?? '',
      sourceLineId: l.source_line_id ?? '',
    })),
  }
}

/** Explicit rate verbatim; null only when automatic resolution is asked for. */
export function fxRateOf(values: InvoiceValues): string | null {
  return !values.fxAuto && isDecimal(values.fxRate) ? values.fxRate : null
}

export function sentInvoiceLines(values: InvoiceValues) {
  return values.lines.flatMap((line, index) => (isBlankInvoiceLine(line) ? [] : [{ line, index }]))
}

export function toLineInput(l: InvoiceLineValues): InvoiceLineInput {
  return {
    item_id: l.itemId || null,
    description: l.description.trim() || null,
    quantity: l.quantity,
    unit_id: l.unitId,
    unit_price: isDecimal(l.unitPrice) ? l.unitPrice : null,
    discount_percent: isDecimal(l.discountPercent) ? l.discountPercent : '0',
    discount_amount: isDecimal(l.discountAmount) ? l.discountAmount : '0',
    tax_code_id: l.taxCodeId || null,
    delivery_line_id: l.deliveryLineId || null,
    source_line_id: l.sourceLineId || null,
  }
}

export function toInvoiceInput(values: InvoiceValues): InvoiceInput {
  return {
    party_id: values.partyId,
    invoice_type: values.invoiceType,
    document_date: values.documentDate,
    due_date: values.dueDate || null,
    currency_code: values.currencyCode,
    fx_rate: fxRateOf(values),
    payment_term_id: values.paymentTermId || null,
    warehouse_id: values.warehouseId || null,
    notes: values.notes.trim() || null,
    internal_notes: values.internalNotes.trim() || null,
    deliver_on_invoice: values.deliverOnInvoice,
    lines: sentInvoiceLines(values).map(({ line }) => toLineInput(line)),
  }
}

/** Preview request of the current form, or null while it cannot be priced (no line yet). */
export function toPreviewInput(values: InvoiceValues): PreviewInput | null {
  const lines = sentInvoiceLines(values)
    .map(({ line }) => line)
    .filter((l) => isDecimal(l.quantity) && l.unitId !== '')
  if (lines.length === 0 || !values.documentDate) return null
  return {
    document_type: 'sales_invoice',
    party_id: values.partyId || null,
    document_date: values.documentDate,
    currency_code: values.currencyCode,
    fx_rate: fxRateOf(values),
    lines: lines.map(toLineInput),
  }
}

export function toLineMath(l: InvoiceLineValues, resolvedPrice?: string): LineMath {
  return {
    quantity: l.quantity,
    unitPrice: isDecimal(l.unitPrice) ? l.unitPrice : (resolvedPrice ?? '0'),
    discountPercent: l.discountPercent,
    discountAmount: l.discountAmount,
    taxRate: l.taxRate,
  }
}

/** Editor estimate of the header totals (before the server preview answers). */
export function estimateTotals(values: InvoiceValues) {
  return documentAmounts(sentInvoiceLines(values).map(({ line }) => toLineMath(line)))
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
    delivery_line_id: 'quantity',
    source_line_id: 'quantity',
  }
  const HEADER: Record<string, string> = {
    party_id: 'partyId',
    document_date: 'documentDate',
    due_date: 'dueDate',
    currency_code: 'currencyCode',
    fx_rate: 'fxRate',
    payment_term_id: 'paymentTermId',
    warehouse_id: 'warehouseId',
    notes: 'notes',
    internal_notes: 'internalNotes',
    deliver_on_invoice: 'deliverOnInvoice',
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
  taxCode: string
}

export function invoiceLineProblems(
  l: InvoiceLineValues,
  m: InvoiceLineMessages,
): [keyof InvoiceLineValues, string][] {
  if (isBlankInvoiceLine(l)) return []
  const out: [keyof InvoiceLineValues, string][] = []
  if (!l.itemId && l.description.trim() === '') out.push(['itemId', m.item])
  if (!l.unitId) out.push(['unitId', m.unit])
  if (!isDecimal(l.quantity) || dec(l.quantity).lessThanOrEqualTo(0))
    out.push(['quantity', m.quantity])
  if (l.unitPrice !== '' && (!isDecimal(l.unitPrice) || dec(l.unitPrice).isNegative()))
    out.push(['unitPrice', m.price])
  const pct = dec(l.discountPercent)
  if (!isDecimal(l.discountPercent) || pct.isNegative() || pct.greaterThan(100))
    out.push(['discountPercent', m.discount])
  if (!isDecimal(l.discountAmount) || dec(l.discountAmount).isNegative())
    out.push(['discountAmount', m.discount])
  if (!l.taxCodeId) out.push(['taxCodeId', m.taxCode])
  return out
}

/** Stock goods on the invoice without a delivery line (need deliver_on_invoice to issue). */
export function undeliveredGoods(values: InvoiceValues): number {
  return sentInvoiceLines(values).filter(
    ({ line }) => line.itemType === 'stock' && line.deliveryLineId === '',
  ).length
}
