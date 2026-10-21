import { z } from 'zod'
import { calendarDate } from '@/lib/forms'
import {
  isBlankLine,
  lineProblems,
  serialsElsewhere,
  typeRules,
  type DocValues,
  type LineMessages,
  type LineValues,
} from './lib/lines'
import { EDITABLE_DOC_TYPES, MAX_LINES } from './types'

export interface DocMessages extends LineMessages {
  warehouse: string
  targetWarehouse: string
  sameWarehouse: string
  minLines: string
  maxLines: string
  tooLong: string
}

const TEXT_MAX = 500

export function docSchema(m: DocMessages) {
  return z
    .object({
      docType: z.enum(EDITABLE_DOC_TYPES),
      documentDate: calendarDate(),
      warehouseId: z.string().min(1, m.warehouse),
      targetWarehouseId: z.string(),
      reason: z.string().max(TEXT_MAX, m.tooLong),
      notes: z.string().max(2000, m.tooLong),
      lines: z.array(z.custom<LineValues>()),
    })
    .superRefine((v, ctx) => {
      const rules = typeRules(v.docType)
      if (rules.target) {
        if (!v.targetWarehouseId)
          ctx.addIssue({ code: 'custom', message: m.targetWarehouse, path: ['targetWarehouseId'] })
        else if (v.targetWarehouseId === v.warehouseId)
          ctx.addIssue({ code: 'custom', message: m.sameWarehouse, path: ['targetWarehouseId'] })
      }
      const filled = v.lines.filter((l) => !isBlankLine(l)).length
      if (filled === 0) ctx.addIssue({ code: 'custom', message: m.minLines, path: ['lines'] })
      if (v.lines.length > MAX_LINES)
        ctx.addIssue({ code: 'custom', message: m.maxLines, path: ['lines'] })
      v.lines.forEach((line, i) => {
        for (const [field, message] of lineProblems(line, rules, m, serialsElsewhere(v.lines, i))) {
          ctx.addIssue({ code: 'custom', message, path: ['lines', i, field] })
        }
      })
    }) satisfies z.ZodType<DocValues>
}
