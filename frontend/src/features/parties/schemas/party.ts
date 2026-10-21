import Decimal from 'decimal.js'
import { z } from 'zod'
import { MSG } from '@/lib/forms/schemas'
import { taxNumberProblem } from '../lib/taxNumber'
import { PARTY_ROLES, PARTY_TYPES, type Party, type PartyInput } from '../types'

// Messages are i18n keys; `parties:` ones resolve in this feature's namespace.
export const V = {
  rolesRequired: 'parties:validation.rolesRequired',
  vknLength: 'parties:validation.vknLength',
  vknChecksum: 'parties:validation.vknChecksum',
  tcknLength: 'parties:validation.tcknLength',
  tcknChecksum: 'parties:validation.tcknChecksum',
  foreign: 'parties:validation.foreign',
  country: 'parties:validation.country',
  currency: 'parties:validation.currency',
  riskCurrency: 'parties:validation.riskCurrency',
  email: 'parties:validation.email',
  ibanFormat: 'parties:validation.ibanFormat',
  ibanCountry: 'parties:validation.ibanCountry',
  ibanLength: 'parties:validation.ibanLength',
  ibanBban: 'parties:validation.ibanBban',
  ibanTrFormat: 'parties:validation.ibanTrFormat',
  ibanChecksum: 'parties:validation.ibanChecksum',
  swift: 'parties:validation.swift',
  tooLong: 'parties:validation.tooLong',
} as const

const DECIMAL = /^\d+(?:\.\d{1,4})?$/

export const countryCode = z.string().regex(/^[A-Z]{2}$/, V.country)
const currencyOrEmpty = z.string().regex(/^(?:[A-Z]{3})?$/, V.currency)
const text = (max: number) => z.string().trim().max(max, V.tooLong)

export const partyFormSchema = z
  .object({
    name: z.string().trim().min(1, MSG.required).max(255, V.tooLong),
    legal_name: text(255),
    type: z.enum(PARTY_TYPES),
    roles: z.array(z.enum(PARTY_ROLES)).min(1, V.rolesRequired),
    tax_office: text(120),
    tax_number: text(32),
    country: countryCode,
    default_currency_code: currencyOrEmpty,
    risk_limit: z.string().refine((v) => v === '' || DECIMAL.test(v), MSG.number),
    risk_currency_code: currencyOrEmpty,
    is_active: z.boolean(),
    notes: text(2000),
    tags: text(500),
  })
  .superRefine((v, ctx) => {
    const problem = taxNumberProblem(v.tax_number, v.country, v.type)
    if (problem) ctx.addIssue({ code: 'custom', path: ['tax_number'], message: V[problem] })
    if (v.risk_limit !== '' && v.risk_currency_code === '') {
      ctx.addIssue({ code: 'custom', path: ['risk_currency_code'], message: V.riskCurrency })
    }
  })

export type PartyFormValues = z.infer<typeof partyFormSchema>

export function emptyPartyValues(overrides: Partial<PartyFormValues> = {}): PartyFormValues {
  return {
    name: '',
    legal_name: '',
    type: 'company',
    roles: ['customer'],
    tax_office: '',
    tax_number: '',
    country: 'TR',
    default_currency_code: 'TRY',
    risk_limit: '',
    risk_currency_code: '',
    is_active: true,
    notes: '',
    tags: '',
    ...overrides,
  }
}

/** Server money strings come as "1500.0000"; the form keeps them canonical. */
function trimDecimal(value: string | null): string {
  if (value === null || value === '') return ''
  return new Decimal(value).toFixed()
}

export function partyToFormValues(p: Party): PartyFormValues {
  return {
    name: p.name,
    legal_name: p.legal_name ?? '',
    type: p.type,
    roles: [...p.roles],
    tax_office: p.tax_office ?? '',
    tax_number: p.tax_number ?? '',
    country: p.country,
    default_currency_code: p.default_currency_code ?? '',
    risk_limit: trimDecimal(p.risk_limit),
    risk_currency_code: p.risk_currency_code ?? '',
    is_active: p.is_active,
    notes: p.notes ?? '',
    tags: p.tags.join(', '),
  }
}

export function parseTags(value: string): string[] {
  const seen = new Set<string>()
  for (const raw of value.split(',')) {
    const tag = raw.trim()
    if (tag) seen.add(tag)
  }
  return [...seen]
}

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

/** Fields the form does not edit (payment term, price list) are carried over from `base`. */
export function formValuesToInput(v: PartyFormValues, base?: Party): PartyInput {
  return {
    name: v.name.trim(),
    legal_name: orNull(v.legal_name),
    type: v.type,
    roles: v.roles,
    tax_office: orNull(v.tax_office),
    tax_number: orNull(v.tax_number.replace(/\s+/g, v.country === 'TR' ? '' : ' ')),
    country: v.country,
    default_currency_code: orNull(v.default_currency_code),
    payment_term_id: base?.payment_term_id ?? null,
    price_list_id: base?.price_list_id ?? null,
    risk_limit: orNull(v.risk_limit),
    risk_currency_code: v.risk_limit === '' ? null : orNull(v.risk_currency_code),
    is_active: v.is_active,
    notes: orNull(v.notes),
    tags: parseTags(v.tags),
  }
}
