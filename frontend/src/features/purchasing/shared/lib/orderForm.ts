import { z } from 'zod'
import { calendarDate } from '@/lib/forms'
import {
  MAX_LINES,
  type OrderInput,
  type OrderLine,
  type OrderLineInput,
  type PreviewInput,
  type PurchaseOrder,
} from '../types'
import {
  decimalProblem,
  factorOf,
  fieldMapper,
  isDecimal,
  newLineKey,
  optional,
  orNull,
  orZero,
  storedLineItem,
  trimDecimal,
  dec,
  type PurchLineItem,
} from './forms'

export interface OrderLineValues {
  /** Client key matching preview lines to form lines. */
  key: string
  /** Stored line id ('' for new lines): sent back so the server keeps provenance. */
  id: string
  itemId: string
  item: PurchLineItem | null
  description: string
  quantity: string
  unitId: string
  unitCode: string
  factor: string
  unitPrice: string
  discountPercent: string
  discountAmount: string
  taxCodeId: string
  withholdingCodeId: string
  variantId: string
  warehouseId: string
  expectedDate: string
  /** manual | quote | request | source (read-only hint). */
  priceSource: string
}

export interface OrderValues {
  partyId: string
  partyName: string
  documentDate: string
  expectedDate: string
  currencyCode: string
  fxRate: string
  paymentTermId: string
  warehouseId: string
  supplierReference: string
  notes: string
  internalNotes: string
  lines: OrderLineValues[]
}

export function emptyOrderLine(): OrderLineValues {
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
    withholdingCodeId: '',
    variantId: '',
    warehouseId: '',
    expectedDate: '',
    priceSource: '',
  }
}

export function isBlankOrderLine(l: OrderLineValues): boolean {
  return !l.itemId && !l.quantity.trim() && !l.unitPrice.trim()
}

export function emptyOrderValues(today: string, currencyCode = 'TRY'): OrderValues {
  return {
    partyId: '',
    partyName: '',
    documentDate: today,
    expectedDate: '',
    currencyCode,
    fxRate: '',
    paymentTermId: '',
    warehouseId: '',
    supplierReference: '',
    notes: '',
    internalNotes: '',
    lines: [emptyOrderLine()],
  }
}

export function orderLineToValues(l: OrderLine): OrderLineValues {
  return {
    key: l.id,
    id: l.id,
    itemId: l.item_id,
    item: storedLineItem(l),
    description: l.description ?? '',
    quantity: trimDecimal(l.quantity),
    unitId: l.unit_id,
    unitCode: l.unit_code ?? '',
    factor: factorOf(l.quantity, l.base_quantity),
    unitPrice: trimDecimal(l.unit_price),
    discountPercent: optional(l.discount_percent),
    discountAmount: optional(l.discount_amount),
    taxCodeId: l.tax_code_id ?? '',
    withholdingCodeId: l.withholding_code_id ?? '',
    variantId: l.variant_id ?? '',
    warehouseId: l.warehouse_id ?? '',
    expectedDate: l.expected_date ?? '',
    priceSource: l.price_source ?? '',
  }
}

export function orderToValues(doc: PurchaseOrder): OrderValues {
  return {
    partyId: doc.party_id,
    partyName: doc.party_name,
    documentDate: doc.document_date,
    expectedDate: doc.expected_date ?? '',
    currencyCode: doc.currency_code,
    fxRate: dec(doc.fx_rate).eq(1) ? '' : trimDecimal(doc.fx_rate),
    paymentTermId: doc.payment_term_id ?? '',
    warehouseId: doc.warehouse_id ?? '',
    supplierReference: doc.supplier_reference ?? '',
    notes: doc.notes ?? '',
    internalNotes: doc.internal_notes ?? '',
    lines: doc.lines.length > 0 ? doc.lines.map(orderLineToValues) : [emptyOrderLine()],
  }
}

export function orderLineToInput(l: OrderLineValues): OrderLineInput {
  return {
    ...(l.id ? { id: l.id } : {}),
    item_id: l.itemId,
    variant_id: orNull(l.variantId),
    unit_id: l.unitId,
    quantity: l.quantity.trim(),
    unit_price: l.unitPrice.trim(),
    discount_percent: orZero(l.discountPercent),
    discount_amount: orZero(l.discountAmount),
    // null = untaxed / no withholding on purpose (the API defaults only absent keys).
    tax_code_id: orNull(l.taxCodeId),
    withholding_code_id: orNull(l.withholdingCodeId),
    description: orNull(l.description),
    warehouse_id: orNull(l.warehouseId),
    expected_date: orNull(l.expectedDate),
  }
}

/** Create / PATCH / revise body; blank lines dropped. */
export function orderToInput(v: OrderValues): OrderInput {
  return {
    party_id: v.partyId,
    document_date: v.documentDate,
    currency_code: v.currencyCode,
    fx_rate: orNull(v.fxRate),
    payment_term_id: orNull(v.paymentTermId),
    warehouse_id: orNull(v.warehouseId),
    expected_date: orNull(v.expectedDate),
    supplier_reference: orNull(v.supplierReference),
    notes: orNull(v.notes),
    internal_notes: orNull(v.internalNotes),
    lines: v.lines.filter((l) => !isBlankOrderLine(l)).map(orderLineToInput),
  }
}

/** The form would send exactly the stored lines: a PATCH then leaves them out. */
export function orderLinesUnchanged(v: OrderValues, stored: PurchaseOrder): boolean {
  const now = v.lines.filter((l) => !isBlankOrderLine(l)).map(orderLineToInput)
  const before = stored.lines.map((l) => orderLineToInput(orderLineToValues(l)))
  return JSON.stringify(now) === JSON.stringify(before)
}

/** A line the server can total: item, unit, positive quantity and a price. */
export function isComputable(l: OrderLineValues): boolean {
  return (
    Boolean(l.itemId && l.unitId) &&
    isDecimal(l.quantity) &&
    dec(l.quantity).gt(0) &&
    isDecimal(l.unitPrice)
  )
}

/** preview-totals body (needs the supplier and at least one computable line). */
export function orderPreviewInput(v: OrderValues): PreviewInput | null {
  const lines = v.lines.filter(isComputable).map((l) => ({
    key: l.key,
    item_id: l.itemId,
    variant_id: orNull(l.variantId),
    unit_id: l.unitId,
    quantity: l.quantity.trim(),
    unit_price: l.unitPrice.trim(),
    discount_percent: isDecimal(l.discountPercent) ? l.discountPercent.trim() : '0',
    discount_amount: isDecimal(l.discountAmount) ? l.discountAmount.trim() : '0',
    tax_code_id: orNull(l.taxCodeId),
    withholding_code_id: orNull(l.withholdingCodeId),
    warehouse_id: orNull(l.warehouseId),
  }))
  if (lines.length === 0 || !v.partyId) return null
  return {
    party_id: v.partyId,
    document_date: v.documentDate,
    currency_code: v.currencyCode,
    fx_rate: isDecimal(v.fxRate) ? v.fxRate.trim() : null,
    warehouse_id: orNull(v.warehouseId),
    lines,
  }
}

export const orderFieldMapper = (v: OrderValues) =>
  fieldMapper(
    v.lines,
    isBlankOrderLine,
    {
      party_id: 'partyId',
      document_date: 'documentDate',
      expected_date: 'expectedDate',
      currency_code: 'currencyCode',
      fx_rate: 'fxRate',
      payment_term_id: 'paymentTermId',
      warehouse_id: 'warehouseId',
      supplier_reference: 'supplierReference',
      notes: 'notes',
      internal_notes: 'internalNotes',
      lines: 'lines',
    },
    {
      item_id: 'itemId',
      description: 'description',
      quantity: 'quantity',
      unit_id: 'unitId',
      unit_price: 'unitPrice',
      discount_percent: 'discountPercent',
      discount_amount: 'discountAmount',
      tax_code_id: 'taxCodeId',
      withholding_code_id: 'withholdingCodeId',
      expected_date: 'expectedDate',
    },
  )

export interface OrderMessages {
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
  fxRate: string
  expectedDate: string
}

export function orderSchema(m: OrderMessages) {
  return z
    .object({
      partyId: z.string().min(1, m.party),
      partyName: z.string(),
      documentDate: calendarDate(),
      expectedDate: z.string(),
      currencyCode: z.string().regex(/^[A-Z]{3}$/, m.currency),
      fxRate: z.string(),
      paymentTermId: z.string(),
      warehouseId: z.string(),
      supplierReference: z.string().max(100),
      notes: z.string().max(5000),
      internalNotes: z.string().max(5000),
      lines: z.array(z.custom<OrderLineValues>()),
    })
    .superRefine((v, ctx) => {
      if (v.expectedDate && v.expectedDate < v.documentDate)
        ctx.addIssue({ code: 'custom', message: m.expectedDate, path: ['expectedDate'] })
      if (decimalProblem(v.fxRate, { scale: 6, positive: true, optional: true }))
        ctx.addIssue({ code: 'custom', message: m.fxRate, path: ['fxRate'] })
      const filled = v.lines.filter((l) => !isBlankOrderLine(l))
      if (filled.length === 0)
        ctx.addIssue({ code: 'custom', message: m.minLines, path: ['lines'] })
      if (filled.length > MAX_LINES)
        ctx.addIssue({ code: 'custom', message: m.maxLines, path: ['lines'] })
      v.lines.forEach((l, i) => {
        if (isBlankOrderLine(l)) return
        const issue = (field: keyof OrderLineValues, message: string) =>
          ctx.addIssue({ code: 'custom', message, path: ['lines', i, field] })
        if (!l.itemId) issue('itemId', m.item)
        if (l.itemId && !l.unitId) issue('unitId', m.unit)
        if (decimalProblem(l.quantity, { scale: 6, positive: true })) issue('quantity', m.quantity)
        if (decimalProblem(l.unitPrice, { scale: 6 })) issue('unitPrice', m.price)
        if (decimalProblem(l.discountPercent, { scale: 4, max: '100', optional: true }))
          issue('discountPercent', m.discountPercent)
        if (decimalProblem(l.discountAmount, { scale: 4, optional: true }))
          issue('discountAmount', m.discountAmount)
      })
    }) satisfies z.ZodType<OrderValues>
}
