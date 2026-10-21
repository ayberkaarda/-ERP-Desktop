import { z } from 'zod'
import { MSG } from '@/lib/forms/schemas'
import { ibanProblem, normalizeIban, type IbanProblem } from '../lib/iban'
import { ADDRESS_TYPES } from '../types'
import { countryCode, V } from './party'

const required = (max: number) => z.string().trim().min(1, MSG.required).max(max, V.tooLong)
const optional = (max: number) => z.string().trim().max(max, V.tooLong)

export const addressSchema = z.object({
  type: z.enum(ADDRESS_TYPES),
  label: optional(100),
  line1: required(255),
  line2: optional(255),
  district: optional(100),
  city: required(100),
  postal_code: optional(20),
  country: countryCode,
  is_default: z.boolean(),
})

export const contactSchema = z.object({
  name: required(150),
  title: optional(100),
  email: z
    .string()
    .trim()
    .max(255, V.tooLong)
    .refine((v) => v === '' || z.email().safeParse(v).success, V.email),
  phone: optional(40),
  is_primary: z.boolean(),
})

const IBAN_MESSAGE: Record<IbanProblem, string> = {
  format: V.ibanFormat,
  length: V.ibanLength,
  trFormat: V.ibanTrFormat,
  checksum: V.ibanChecksum,
}

export const bankAccountSchema = z.object({
  bank_name: required(150),
  iban: z
    .string()
    .min(1, MSG.required)
    .superRefine((v, ctx) => {
      const problem = ibanProblem(v)
      if (problem) ctx.addIssue({ code: 'custom', message: IBAN_MESSAGE[problem] })
    }),
  swift: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[A-Za-z]{6}[A-Za-z0-9]{2}(?:[A-Za-z0-9]{3})?$/.test(v), V.swift),
  currency_code: z.string().regex(/^(?:[A-Z]{3})?$/, V.currency),
  is_default: z.boolean(),
})

export type AddressFormValues = z.infer<typeof addressSchema>
export type ContactFormValues = z.infer<typeof contactSchema>
export type BankAccountFormValues = z.infer<typeof bankAccountSchema>

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

/** Empty optional strings travel as null; IBAN and SWIFT are sent normalized. */
export function toSubresourceInput(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== 'string') out[key] = value
    else if (key === 'iban') out[key] = normalizeIban(value)
    else if (key === 'swift') out[key] = orNull(value.toUpperCase())
    else if (key === 'line1' || key === 'city' || key === 'name' || key === 'bank_name')
      out[key] = value.trim()
    else if (key === 'type' || key === 'country') out[key] = value
    else out[key] = orNull(value)
  }
  return out
}
