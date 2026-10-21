import { z } from 'zod'
import { calendarDate, MSG } from '@/lib/forms'
import { ENTRY_TYPES, MAX_LINES } from './types'
import { amountOf } from './lib/balance'
import { isBlankLine, type EntryValues, type LineValues } from './lib/lines'

/** Already translated texts for rules that have no `common` validation key. */
export interface EntryMessages {
  account: string
  amountRequired: string
  bothSides: string
  party: string
  costCenter: string
  project: string
  fxAmount: string
  fxRate: string
  minLines: string
  maxLines: string
  descriptionTooLong: string
}

const CANONICAL = /^\d+(?:\.\d+)?$/
const DESCRIPTION_MAX = 500

function checkLine(line: LineValues, m: EntryMessages): [keyof LineValues, string][] {
  const out: [keyof LineValues, string][] = []
  if (!line.accountId) out.push(['accountId', m.account])
  for (const side of ['debit', 'credit'] as const) {
    if (line[side] !== '' && !CANONICAL.test(line[side])) out.push([side, MSG.number])
  }
  const debit = amountOf(line.debit)
  const credit = amountOf(line.credit)
  if (debit.isZero() && credit.isZero() && !out.some(([f]) => f === 'debit' || f === 'credit')) {
    out.push(['debit', m.amountRequired])
  } else if (debit.greaterThan(0) && credit.greaterThan(0)) {
    out.push(['credit', m.bothSides])
  }
  const account = line.account
  if (account?.requires_party && !line.partyId) out.push(['partyId', m.party])
  if (account?.requires_cost_center && !line.costCenterId) out.push(['costCenterId', m.costCenter])
  if (account?.requires_project && !line.projectId) out.push(['projectId', m.project])
  if (account?.currency_code) {
    if (!CANONICAL.test(line.fxAmount) || amountOf(line.fxAmount).isZero())
      out.push(['fxAmount', m.fxAmount])
    if (!CANONICAL.test(line.fxRate) || amountOf(line.fxRate).isZero())
      out.push(['fxRate', m.fxRate])
  }
  if (line.description.length > DESCRIPTION_MAX) out.push(['description', m.descriptionTooLong])
  return out
}

/** Problems of one line (blank lines have none: they are dropped on save). */
export function lineProblems(line: LineValues, m: EntryMessages) {
  return isBlankLine(line) ? [] : checkLine(line, m)
}

export function entrySchema(m: EntryMessages) {
  return z.object({
    entryType: z.enum(ENTRY_TYPES),
    entryDate: calendarDate(),
    description: z.string().max(DESCRIPTION_MAX, m.descriptionTooLong),
    lines: z.array(z.custom<LineValues>()).superRefine((lines, ctx) => {
      const filled = lines.filter((l) => !isBlankLine(l)).length
      if (filled === 0) ctx.addIssue({ code: 'custom', message: m.minLines })
      if (lines.length > MAX_LINES) ctx.addIssue({ code: 'custom', message: m.maxLines })
      lines.forEach((line, i) => {
        for (const [field, message] of lineProblems(line, m)) {
          ctx.addIssue({ code: 'custom', message, path: [i, field] })
        }
      })
    }),
  }) satisfies z.ZodType<EntryValues>
}
