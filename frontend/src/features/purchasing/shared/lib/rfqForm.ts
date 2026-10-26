import { z } from 'zod'
import { calendarDate } from '@/lib/forms'
import {
  MAX_LINES,
  type PurchaseRfq,
  type RfqInput,
  type RfqLine,
  type RfqLineInput,
} from '../types'
import {
  decimalProblem,
  factorOf,
  fieldMapper,
  newLineKey,
  orNull,
  storedLineItem,
  trimDecimal,
  type PurchLineItem,
} from './forms'

export interface RfqLineValues {
  key: string
  itemId: string
  item: PurchLineItem | null
  description: string
  quantity: string
  unitId: string
  unitCode: string
  factor: string
  neededBy: string
  variantId: string
}

export interface RfqSupplierValue {
  id: string
  name: string
}

export interface RfqValues {
  documentDate: string
  responseDue: string
  currencyCode: string
  warehouseId: string
  notes: string
  internalNotes: string
  suppliers: RfqSupplierValue[]
  lines: RfqLineValues[]
}

export function emptyRfqLine(): RfqLineValues {
  return {
    key: newLineKey(),
    itemId: '',
    item: null,
    description: '',
    quantity: '',
    unitId: '',
    unitCode: '',
    factor: '1',
    neededBy: '',
    variantId: '',
  }
}

export const isBlankRfqLine = (l: RfqLineValues) => !l.itemId && !l.quantity.trim()

export function emptyRfqValues(today: string, currencyCode = 'TRY'): RfqValues {
  return {
    documentDate: today,
    responseDue: '',
    currencyCode,
    warehouseId: '',
    notes: '',
    internalNotes: '',
    suppliers: [],
    lines: [emptyRfqLine()],
  }
}

function lineToValues(l: RfqLine): RfqLineValues {
  return {
    key: l.id,
    itemId: l.item_id,
    item: storedLineItem(l),
    description: l.description ?? '',
    quantity: trimDecimal(l.quantity),
    unitId: l.unit_id,
    unitCode: l.unit_code ?? '',
    factor: factorOf(l.quantity, l.base_quantity),
    neededBy: l.needed_by ?? '',
    variantId: l.variant_id ?? '',
  }
}

export function rfqToValues(doc: PurchaseRfq): RfqValues {
  return {
    documentDate: doc.document_date,
    responseDue: doc.response_due ?? '',
    currencyCode: doc.currency_code,
    warehouseId: doc.warehouse_id ?? '',
    notes: doc.notes ?? '',
    internalNotes: doc.internal_notes ?? '',
    suppliers: doc.suppliers.map((s) => ({ id: s.party_id, name: s.party_name })),
    lines: doc.lines.length > 0 ? doc.lines.map(lineToValues) : [emptyRfqLine()],
  }
}

function lineToInput(l: RfqLineValues): RfqLineInput {
  return {
    item_id: l.itemId,
    variant_id: orNull(l.variantId),
    unit_id: orNull(l.unitId),
    quantity: l.quantity.trim(),
    description: orNull(l.description),
    needed_by: orNull(l.neededBy),
  }
}

export function rfqToInput(v: RfqValues): RfqInput {
  return {
    document_date: v.documentDate,
    response_due: orNull(v.responseDue),
    currency_code: v.currencyCode,
    warehouse_id: orNull(v.warehouseId),
    notes: orNull(v.notes),
    internal_notes: orNull(v.internalNotes),
    supplier_ids: v.suppliers.map((s) => s.id),
    lines: v.lines.filter((l) => !isBlankRfqLine(l)).map(lineToInput),
  }
}

/**
 * Lines taken from a purchase request: the RFQ API rewrites lines from the payload without
 * request_line_id (not part of its line rules), which would drop the link that bounds the award
 * by the request. Such lines are shown read-only and never sent back.
 */
export function rfqLinesLocked(doc: Pick<PurchaseRfq, 'lines'>): boolean {
  return doc.lines.some((l) => l.request_line_id !== null)
}

/**
 * Unchanged lines are left out of a PATCH: the API would otherwise rewrite them and drop their
 * link to the purchase request lines.
 */
export function rfqLinesUnchanged(v: RfqValues, stored: PurchaseRfq): boolean {
  const now = v.lines.filter((l) => !isBlankRfqLine(l)).map(lineToInput)
  const before = stored.lines.map((l) => lineToInput(lineToValues(l)))
  return JSON.stringify(now) === JSON.stringify(before)
}

export const rfqFieldMapper = (v: RfqValues) =>
  fieldMapper(
    v.lines,
    isBlankRfqLine,
    {
      document_date: 'documentDate',
      response_due: 'responseDue',
      currency_code: 'currencyCode',
      warehouse_id: 'warehouseId',
      notes: 'notes',
      internal_notes: 'internalNotes',
      supplier_ids: 'suppliers',
      lines: 'lines',
    },
    {
      item_id: 'itemId',
      description: 'description',
      quantity: 'quantity',
      unit_id: 'unitId',
      needed_by: 'neededBy',
    },
  )

export interface RfqMessages {
  currency: string
  minLines: string
  maxLines: string
  item: string
  unit: string
  quantity: string
  responseDue: string
  suppliers: string
}

export function rfqSchema(m: RfqMessages) {
  return z
    .object({
      documentDate: calendarDate(),
      responseDue: z.string(),
      currencyCode: z.string().regex(/^[A-Z]{3}$/, m.currency),
      warehouseId: z.string(),
      notes: z.string().max(5000),
      internalNotes: z.string().max(5000),
      suppliers: z.array(z.object({ id: z.string(), name: z.string() })).max(100, m.suppliers),
      lines: z.array(z.custom<RfqLineValues>()),
    })
    .superRefine((v, ctx) => {
      if (v.responseDue && v.responseDue < v.documentDate)
        ctx.addIssue({ code: 'custom', message: m.responseDue, path: ['responseDue'] })
      const filled = v.lines.filter((l) => !isBlankRfqLine(l))
      if (filled.length === 0)
        ctx.addIssue({ code: 'custom', message: m.minLines, path: ['lines'] })
      if (filled.length > MAX_LINES)
        ctx.addIssue({ code: 'custom', message: m.maxLines, path: ['lines'] })
      v.lines.forEach((l, i) => {
        if (isBlankRfqLine(l)) return
        const issue = (field: keyof RfqLineValues, message: string) =>
          ctx.addIssue({ code: 'custom', message, path: ['lines', i, field] })
        if (!l.itemId) issue('itemId', m.item)
        if (l.itemId && !l.unitId) issue('unitId', m.unit)
        if (decimalProblem(l.quantity, { scale: 6, positive: true })) issue('quantity', m.quantity)
      })
    }) satisfies z.ZodType<RfqValues>
}
