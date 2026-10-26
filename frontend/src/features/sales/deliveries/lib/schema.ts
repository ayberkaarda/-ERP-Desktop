import { z } from 'zod'
import { calendarDate } from '@/lib/forms'
import { MAX_LINES } from '../../invoices/kit/types'
import {
  isSkipped,
  lineProblems,
  serialsElsewhere,
  type DeliveryLineValues,
  type DeliveryValues,
  type LineMessages,
} from './lines'

export interface DeliveryMessages extends LineMessages {
  party: string
  warehouse: string
  minLines: string
  maxLines: string
  tooLong: string
}

export function deliverySchema(m: DeliveryMessages) {
  return z
    .object({
      partyId: z.string().min(1, m.party),
      partyLabel: z.string(),
      orderId: z.string(),
      documentDate: calendarDate(),
      warehouseId: z.string().min(1, m.warehouse),
      notes: z.string().max(2000, m.tooLong),
      lines: z.array(z.custom<DeliveryLineValues>()),
    })
    .superRefine((v, ctx) => {
      const sent = v.lines.filter((l) => !isSkipped(l)).length
      if (sent === 0) ctx.addIssue({ code: 'custom', message: m.minLines, path: ['lines'] })
      if (sent > MAX_LINES) ctx.addIssue({ code: 'custom', message: m.maxLines, path: ['lines'] })
      v.lines.forEach((line, i) => {
        for (const [field, message] of lineProblems(line, m, serialsElsewhere(v.lines, i))) {
          ctx.addIssue({ code: 'custom', message, path: ['lines', i, field] })
        }
      })
    }) satisfies z.ZodType<DeliveryValues>
}
