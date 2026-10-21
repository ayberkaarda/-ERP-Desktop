import { z } from 'zod'
import { calendarDate, decimalString, MSG } from '@/lib/forms'

// Catalog-specific messages are `catalog:` keys; Field components translate them.
export const CMSG = {
  duplicateKey: 'catalog:validation.duplicateKey',
  factorPositive: 'catalog:validation.factorPositive',
  dateOrder: 'catalog:validation.dateOrder',
  percentRange: 'catalog:validation.percentRange',
  integer: 'catalog:validation.integer',
  scopeRef: 'catalog:validation.scopeRef',
  code: 'catalog:validation.code',
} as const

export const attributeRows = z
  .array(z.object({ key: z.string(), value: z.string() }))
  .superRefine((rows, ctx) => {
    const seen = new Set<string>()
    rows.forEach((r, i) => {
      const key = r.key.trim().toLocaleLowerCase('tr')
      if (key === '' && r.value.trim() !== '') {
        ctx.addIssue({ code: 'custom', message: MSG.required, path: [i, 'key'] })
      } else if (key !== '' && seen.has(key)) {
        ctx.addIssue({ code: 'custom', message: CMSG.duplicateKey, path: [i, 'key'] })
      }
      seen.add(key)
    })
  })

/** Optional decimal: '' means "not set" (sent as null). */
export function optionalDecimal(options: Parameters<typeof decimalString>[0] = {}) {
  return z.union([z.literal(''), decimalString(options)])
}

export const optionalDate = z.union([z.literal(''), calendarDate()])

/** Codes are short identifiers: letters, digits, dot, dash, underscore. */
export const codeString = z
  .string()
  .trim()
  .min(1, MSG.required)
  .max(32, MSG.max)
  .regex(/^[\p{L}\p{N}._-]+$/u, CMSG.code)

export const emptyToNull = (v: string | null | undefined): string | null =>
  v === undefined || v === null || v === '' ? null : v
