import Decimal from 'decimal.js'
import { z } from 'zod'
import { isValidCalendarDate } from '@/lib/datetime/calendar'

// Messages are keys in the `common` namespace; Field components translate them.
export const MSG = {
  required: 'validation.required',
  number: 'validation.number',
  scale: 'validation.scale',
  positive: 'validation.positive',
  nonNegative: 'validation.nonNegative',
  min: 'validation.min',
  max: 'validation.max',
  date: 'validation.date',
} as const

const CANONICAL = /^-?\d+(?:\.\d+)?$/

export interface DecimalStringOptions {
  scale?: number
  min?: string
  max?: string
  positive?: boolean
  nonNegative?: boolean
}

/** Canonical decimal string ("1234.50") as MoneyInput/QuantityInput emit; compared exactly. */
export function decimalString(options: DecimalStringOptions = {}) {
  return z
    .string()
    .min(1, MSG.required)
    .superRefine((value, ctx) => {
      if (!CANONICAL.test(value)) {
        ctx.addIssue({ code: 'custom', message: MSG.number })
        return
      }
      const d = new Decimal(value)
      if (options.scale !== undefined && d.decimalPlaces() > options.scale) {
        ctx.addIssue({ code: 'custom', message: MSG.scale })
      } else if (options.positive && !d.greaterThan(0)) {
        ctx.addIssue({ code: 'custom', message: MSG.positive })
      } else if (options.nonNegative && d.isNegative() && !d.isZero()) {
        ctx.addIssue({ code: 'custom', message: MSG.nonNegative })
      } else if (options.min !== undefined && d.lessThan(options.min)) {
        ctx.addIssue({ code: 'custom', message: MSG.min })
      } else if (options.max !== undefined && d.greaterThan(options.max)) {
        ctx.addIssue({ code: 'custom', message: MSG.max })
      }
    })
}

/** Calendar date "YYYY-MM-DD" (never an instant). */
export function calendarDate() {
  return z.string().min(1, MSG.required).refine(isValidCalendarDate, MSG.date)
}

export function requiredString() {
  return z.string().trim().min(1, MSG.required)
}
