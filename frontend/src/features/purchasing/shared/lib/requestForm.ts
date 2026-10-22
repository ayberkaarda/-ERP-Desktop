import { z } from 'zod'
import { calendarDate } from '@/lib/forms'
import {
  MAX_LINES,
  type PurchaseRequest,
  type RequestInput,
  type RequestLine,
  type RequestLineInput,
} from '../types'
import {
  decimalProblem,
  factorOf,
  fieldMapper,
  newLineKey,
  optional,
  orNull,
  storedLineItem,
  trimDecimal,
  type PurchLineItem,
} from './forms'

export interface RequestLineValues {
  key: string
  itemId: string
  item: PurchLineItem | null
  description: string
  quantity: string
  unitId: string
  unitCode: string
  factor: string
  estimatedPrice: string
  suggestedSupplierId: string
  suggestedSupplierName: string
  neededBy: string
  variantId: string
  warehouseId: string
}

export interface RequestValues {
  documentDate: string
  neededBy: string
  warehouseId: string
  notes: string
  internalNotes: string
  lines: RequestLineValues[]
}

export function emptyRequestLine(): RequestLineValues {
  return {
    key: newLineKey(),
    itemId: '',
    item: null,
    description: '',
    quantity: '',
    unitId: '',
    unitCode: '',
    factor: '1',
    estimatedPrice: '',
    suggestedSupplierId: '',
    suggestedSupplierName: '',
    neededBy: '',
    variantId: '',
    warehouseId: '',
  }
}

export const isBlankRequestLine = (l: RequestLineValues) => !l.itemId && !l.quantity.trim()

export function emptyRequestValues(today: string): RequestValues {
  return {
    documentDate: today,
    neededBy: '',
    warehouseId: '',
    notes: '',
    internalNotes: '',
    lines: [emptyRequestLine()],
  }
}

function lineToValues(l: RequestLine): RequestLineValues {
  return {
    key: l.id,
    itemId: l.item_id,
    item: storedLineItem(l),
    description: l.description ?? '',
    quantity: trimDecimal(l.quantity),
    unitId: l.unit_id,
    unitCode: l.unit_code ?? '',
    factor: factorOf(l.quantity, l.base_quantity),
    estimatedPrice: optional(l.estimated_price),
    suggestedSupplierId: l.suggested_supplier_id ?? '',
    suggestedSupplierName: '',
    neededBy: l.needed_by ?? '',
    variantId: l.variant_id ?? '',
    warehouseId: l.warehouse_id ?? '',
  }
}

export function requestToValues(doc: PurchaseRequest): RequestValues {
  return {
    documentDate: doc.document_date,
    neededBy: doc.needed_by ?? '',
    warehouseId: doc.warehouse_id ?? '',
    notes: doc.notes ?? '',
    internalNotes: doc.internal_notes ?? '',
    lines: doc.lines.length > 0 ? doc.lines.map(lineToValues) : [emptyRequestLine()],
  }
}

function lineToInput(l: RequestLineValues): RequestLineInput {
  return {
    item_id: l.itemId,
    variant_id: orNull(l.variantId),
    unit_id: orNull(l.unitId),
    quantity: l.quantity.trim(),
    estimated_price: orNull(l.estimatedPrice),
    suggested_supplier_id: orNull(l.suggestedSupplierId),
    needed_by: orNull(l.neededBy),
    warehouse_id: orNull(l.warehouseId),
    description: orNull(l.description),
  }
}

export function requestToInput(v: RequestValues): RequestInput {
  return {
    document_date: v.documentDate,
    needed_by: orNull(v.neededBy),
    warehouse_id: orNull(v.warehouseId),
    notes: orNull(v.notes),
    internal_notes: orNull(v.internalNotes),
    lines: v.lines.filter((l) => !isBlankRequestLine(l)).map(lineToInput),
  }
}

export function requestLinesUnchanged(v: RequestValues, stored: PurchaseRequest): boolean {
  const now = v.lines.filter((l) => !isBlankRequestLine(l)).map(lineToInput)
  const before = stored.lines.map((l) => lineToInput(lineToValues(l)))
  return JSON.stringify(now) === JSON.stringify(before)
}

export const requestFieldMapper = (v: RequestValues) =>
  fieldMapper(
    v.lines,
    isBlankRequestLine,
    {
      document_date: 'documentDate',
      needed_by: 'neededBy',
      warehouse_id: 'warehouseId',
      notes: 'notes',
      internal_notes: 'internalNotes',
      lines: 'lines',
    },
    {
      item_id: 'itemId',
      description: 'description',
      quantity: 'quantity',
      unit_id: 'unitId',
      estimated_price: 'estimatedPrice',
      suggested_supplier_id: 'suggestedSupplierId',
      needed_by: 'neededBy',
    },
  )

export interface RequestMessages {
  minLines: string
  maxLines: string
  item: string
  unit: string
  quantity: string
  price: string
  neededBy: string
}

export function requestSchema(m: RequestMessages) {
  return z
    .object({
      documentDate: calendarDate(),
      neededBy: z.string(),
      warehouseId: z.string(),
      notes: z.string().max(5000),
      internalNotes: z.string().max(5000),
      lines: z.array(z.custom<RequestLineValues>()),
    })
    .superRefine((v, ctx) => {
      if (v.neededBy && v.neededBy < v.documentDate)
        ctx.addIssue({ code: 'custom', message: m.neededBy, path: ['neededBy'] })
      const filled = v.lines.filter((l) => !isBlankRequestLine(l))
      if (filled.length === 0)
        ctx.addIssue({ code: 'custom', message: m.minLines, path: ['lines'] })
      if (filled.length > MAX_LINES)
        ctx.addIssue({ code: 'custom', message: m.maxLines, path: ['lines'] })
      v.lines.forEach((l, i) => {
        if (isBlankRequestLine(l)) return
        const issue = (field: keyof RequestLineValues, message: string) =>
          ctx.addIssue({ code: 'custom', message, path: ['lines', i, field] })
        if (!l.itemId) issue('itemId', m.item)
        if (l.itemId && !l.unitId) issue('unitId', m.unit)
        if (decimalProblem(l.quantity, { scale: 6, positive: true })) issue('quantity', m.quantity)
        if (decimalProblem(l.estimatedPrice, { scale: 6, optional: true }))
          issue('estimatedPrice', m.price)
      })
    }) satisfies z.ZodType<RequestValues>
}
