import { z } from 'zod'
import { calendarDate } from '@/lib/forms'
import { dec, isDecimal } from '../kit/money'
import { MAX_LINES } from '../kit/types'
import {
  invoiceLineProblems,
  isBlankInvoiceLine,
  type InvoiceLineMessages,
  type InvoiceLineValues,
  type InvoiceValues,
} from './lines'

export interface InvoiceMessages extends InvoiceLineMessages {
  party: string
  currency: string
  fxRate: string
  dueBeforeDate: string
  minLines: string
  maxLines: string
  tooLong: string
}

export function invoiceSchema(m: InvoiceMessages) {
  return z
    .object({
      partyId: z.string().min(1, m.party),
      partyLabel: z.string(),
      invoiceType: z.enum(['sale', 'return']),
      documentDate: calendarDate(),
      dueDate: z.string(),
      currencyCode: z.string().min(3, m.currency),
      fxRate: z.string(),
      fxAuto: z.boolean(),
      paymentTermId: z.string(),
      warehouseId: z.string(),
      notes: z.string().max(2000, m.tooLong),
      internalNotes: z.string().max(2000, m.tooLong),
      deliverOnInvoice: z.boolean(),
      lines: z.array(z.custom<InvoiceLineValues>()),
    })
    .superRefine((v, ctx) => {
      if (!v.fxAuto && (!isDecimal(v.fxRate) || dec(v.fxRate).lessThanOrEqualTo(0)))
        ctx.addIssue({ code: 'custom', message: m.fxRate, path: ['fxRate'] })
      if (v.dueDate && v.dueDate < v.documentDate)
        ctx.addIssue({ code: 'custom', message: m.dueBeforeDate, path: ['dueDate'] })
      const filled = v.lines.filter((l) => !isBlankInvoiceLine(l)).length
      if (filled === 0) ctx.addIssue({ code: 'custom', message: m.minLines, path: ['lines'] })
      if (filled > MAX_LINES) ctx.addIssue({ code: 'custom', message: m.maxLines, path: ['lines'] })
      v.lines.forEach((line, i) => {
        for (const [field, message] of invoiceLineProblems(line, m)) {
          ctx.addIssue({ code: 'custom', message, path: ['lines', i, field] })
        }
      })
    }) satisfies z.ZodType<InvoiceValues>
}
