import { z } from 'zod'
import { calendarDate } from '@/lib/forms'
import { MAX_LINES } from '../../invoices/kit/types'
import {
  isSkippedLine,
  receiptLineProblems,
  type ReceiptLineMessages,
  type ReceiptLineValues,
  type ReceiptValues,
} from './lines'

export interface ReceiptMessages extends ReceiptLineMessages {
  party: string
  warehouse: string
  minLines: string
  maxLines: string
  tooLong: string
}

export function receiptSchema(m: ReceiptMessages) {
  return z
    .object({
      orderId: z.string(),
      partyId: z.string(),
      partyLabel: z.string(),
      currencyCode: z.string(),
      documentDate: calendarDate(),
      warehouseId: z.string().min(1, m.warehouse),
      supplierReference: z.string().max(100, m.tooLong),
      notes: z.string().max(5000, m.tooLong),
      lines: z.array(z.custom<ReceiptLineValues>()),
    })
    .superRefine((v, ctx) => {
      if (!v.orderId && !v.partyId)
        ctx.addIssue({ code: 'custom', message: m.party, path: ['partyId'] })
      const filled = v.lines.filter((l) => !isSkippedLine(l)).length
      if (filled === 0) ctx.addIssue({ code: 'custom', message: m.minLines, path: ['lines'] })
      if (filled > MAX_LINES) ctx.addIssue({ code: 'custom', message: m.maxLines, path: ['lines'] })
      v.lines.forEach((line, i) => {
        for (const [field, message] of receiptLineProblems(line, m)) {
          ctx.addIssue({ code: 'custom', message, path: ['lines', i, field] })
        }
      })
    }) satisfies z.ZodType<ReceiptValues>
}

/** Server `lines.N.field` (N among sent lines) -> form path. */
export function receiptFieldMapper(sentIndexes: readonly number[]) {
  const FIELD: Record<string, keyof ReceiptLineValues> = {
    item_id: 'itemId',
    unit_id: 'unitId',
    quantity: 'quantity',
    unit_price: 'unitPrice',
    tax_code_id: 'itemId',
    order_line_id: 'quantity',
    lot_no: 'lotNo',
    expiry_date: 'expiryDate',
    serial_numbers: 'serialsText',
  }
  const HEADER: Record<string, string> = {
    party_id: 'partyId',
    document_date: 'documentDate',
    warehouse_id: 'warehouseId',
    supplier_reference: 'supplierReference',
    notes: 'notes',
    order_id: 'lines',
    lines: 'lines',
  }
  return (path: string): string => {
    const m = /^lines\.(\d+)\.([a-z_]+)/.exec(path)
    if (m) {
      const index = sentIndexes[Number(m[1])]
      const field = FIELD[m[2] ?? '']
      return index !== undefined && field ? `lines.${index}.${field}` : 'lines'
    }
    return HEADER[path] ?? path
  }
}
