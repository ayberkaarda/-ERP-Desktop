import { z } from 'zod'
import { calendarDate, decimalString, MSG, requiredString } from '@/lib/forms'
import {
  LOCATION_TYPES,
  NEGATIVE_STOCK_POLICIES,
  PROJECT_STATUSES,
  TAX_TYPES,
  type CostCenterInput,
  type ExchangeRateInput,
  type LocationInput,
  type PaymentTermInput,
  type ProjectInput,
  type TaxCodeInput,
  type WarehouseInput,
} from '../types'

// Forms keep every control value as a string (DecimalInput contract); the to*Input helpers
// below turn them into the API payload. Messages are `common` keys, translated by the field.

const optionalDate = z.union([z.literal(''), calendarDate()])
const optionalDecimal = (options: Parameters<typeof decimalString>[0]) =>
  z.union([z.literal(''), decimalString(options)])
const digits = z.string().regex(/^\d{1,5}$/, MSG.number)
const optionalDigits = z.union([z.literal(''), digits])

// ---- Exchange rate ------------------------------------------------------------------------

export const exchangeRateSchema = z.object({
  currency_code: z.string().regex(/^[A-Z]{3}$/, MSG.required),
  rate_date: calendarDate(),
  forex_buying: decimalString({ scale: 6, positive: true }),
  forex_selling: decimalString({ scale: 6, positive: true }),
  banknote_buying: optionalDecimal({ scale: 6, positive: true }),
  banknote_selling: optionalDecimal({ scale: 6, positive: true }),
})
export type ExchangeRateFormValues = z.infer<typeof exchangeRateSchema>

export function toExchangeRateInput(v: ExchangeRateFormValues): ExchangeRateInput {
  return {
    currency_code: v.currency_code,
    rate_date: v.rate_date,
    forex_buying: v.forex_buying,
    forex_selling: v.forex_selling,
    ...(v.banknote_buying ? { banknote_buying: v.banknote_buying } : {}),
    ...(v.banknote_selling ? { banknote_selling: v.banknote_selling } : {}),
  }
}

// ---- Tax code -----------------------------------------------------------------------------

export const taxCodeSchema = z
  .object({
    type: z.enum(TAX_TYPES),
    code: requiredString().max(32, MSG.max),
    name: requiredString().max(200, MSG.max),
    rate: optionalDecimal({ scale: 4, nonNegative: true, max: '100' }),
    numerator: optionalDigits,
    denominator: optionalDigits,
    // Required by the backend (tax_codes.effective_from is NOT NULL).
    effective_from: calendarDate(),
    effective_to: optionalDate,
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'vat' && v.rate === '') {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: MSG.required })
    }
    if (v.type === 'withholding') {
      if (v.numerator === '') {
        ctx.addIssue({ code: 'custom', path: ['numerator'], message: MSG.required })
      }
      if (v.denominator === '' || Number(v.denominator) === 0) {
        ctx.addIssue({ code: 'custom', path: ['denominator'], message: MSG.required })
      } else if (v.numerator !== '' && Number(v.numerator) > Number(v.denominator)) {
        ctx.addIssue({ code: 'custom', path: ['numerator'], message: MSG.max })
      }
    }
    if (v.effective_from && v.effective_to && v.effective_to < v.effective_from) {
      ctx.addIssue({ code: 'custom', path: ['effective_to'], message: MSG.min })
    }
  })
export type TaxCodeFormValues = z.infer<typeof taxCodeSchema>

export function toTaxCodeInput(v: TaxCodeFormValues): TaxCodeInput {
  const withholding = v.type === 'withholding'
  return {
    type: v.type,
    code: v.code.trim(),
    name: v.name.trim(),
    rate: v.rate === '' ? null : v.rate,
    numerator: withholding && v.numerator !== '' ? Number(v.numerator) : null,
    denominator: withholding && v.denominator !== '' ? Number(v.denominator) : null,
    effective_from: v.effective_from,
    effective_to: v.effective_to || null,
    is_active: v.is_active,
  }
}

// ---- Payment term -------------------------------------------------------------------------

export const paymentTermSchema = z
  .object({
    code: requiredString().max(32, MSG.max),
    name: requiredString().max(200, MSG.max),
    due_days: digits,
    discount_percent: optionalDecimal({ scale: 4, nonNegative: true, max: '100' }),
    discount_days: optionalDigits,
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const hasPercent = v.discount_percent !== '' && Number(v.discount_percent) > 0
    if (hasPercent && v.discount_days === '') {
      ctx.addIssue({ code: 'custom', path: ['discount_days'], message: MSG.required })
    }
    if (v.discount_days !== '' && Number(v.discount_days) > Number(v.due_days)) {
      ctx.addIssue({ code: 'custom', path: ['discount_days'], message: MSG.max })
    }
  })
export type PaymentTermFormValues = z.infer<typeof paymentTermSchema>

export function toPaymentTermInput(v: PaymentTermFormValues): PaymentTermInput {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    due_days: Number(v.due_days),
    // The backend columns are NOT NULL (default 0) and reject null; empty means no discount.
    discount_percent: v.discount_percent === '' ? '0' : v.discount_percent,
    discount_days: v.discount_days === '' ? 0 : Number(v.discount_days),
    is_active: v.is_active,
  }
}

// ---- Warehouse ----------------------------------------------------------------------------

export const warehouseSchema = z.object({
  code: requiredString().max(32, MSG.max),
  name: requiredString().max(200, MSG.max),
  negative_stock_policy: z.enum(NEGATIVE_STOCK_POLICIES),
  is_active: z.boolean(),
  is_default: z.boolean(),
  line1: z.string().max(200, MSG.max),
  line2: z.string().max(200, MSG.max),
  district: z.string().max(100, MSG.max),
  city: z.string().max(100, MSG.max),
  postal_code: z.string().max(20, MSG.max),
  country: z.union([z.literal(''), z.string().regex(/^[A-Za-z]{2}$/, 'validation.invalid')]),
})
export type WarehouseFormValues = z.infer<typeof warehouseSchema>

const ADDRESS_KEYS = ['line1', 'line2', 'district', 'city', 'postal_code', 'country'] as const

export function toWarehouseInput(v: WarehouseFormValues): WarehouseInput {
  const address: Record<string, string> = {}
  for (const key of ADDRESS_KEYS) {
    const value = v[key].trim()
    if (value) address[key] = key === 'country' ? value.toUpperCase() : value
  }
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    address: Object.keys(address).length > 0 ? address : null,
    is_active: v.is_active,
    negative_stock_policy: v.negative_stock_policy,
    is_default: v.is_default,
  }
}

// ---- Warehouse location -------------------------------------------------------------------

export const locationSchema = z.object({
  code: requiredString().max(32, MSG.max),
  name: requiredString().max(200, MSG.max),
  type: z.enum(LOCATION_TYPES),
  parent_id: z.string(),
  barcode: z.string().max(64, MSG.max),
})
export type LocationFormValues = z.infer<typeof locationSchema>

export function toLocationInput(v: LocationFormValues): LocationInput {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    type: v.type,
    parent_id: v.parent_id || null,
    barcode: v.barcode.trim() || null,
  }
}

// ---- Cost center --------------------------------------------------------------------------

export const costCenterSchema = z.object({
  code: requiredString().max(32, MSG.max),
  name: requiredString().max(200, MSG.max),
  parent_id: z.string(),
  is_active: z.boolean(),
})
export type CostCenterFormValues = z.infer<typeof costCenterSchema>

export function toCostCenterInput(v: CostCenterFormValues): CostCenterInput {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    parent_id: v.parent_id || null,
    is_active: v.is_active,
  }
}

// ---- Project ------------------------------------------------------------------------------

export const projectSchema = z
  .object({
    code: requiredString().max(32, MSG.max),
    name: requiredString().max(200, MSG.max),
    status: z.enum(PROJECT_STATUSES),
    start_date: optionalDate,
    end_date: optionalDate,
    cost_center_id: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.start_date && v.end_date && v.end_date < v.start_date) {
      ctx.addIssue({ code: 'custom', path: ['end_date'], message: MSG.min })
    }
  })
export type ProjectFormValues = z.infer<typeof projectSchema>

export function toProjectInput(v: ProjectFormValues): ProjectInput {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    status: v.status,
    start_date: v.start_date || null,
    end_date: v.end_date || null,
    cost_center_id: v.cost_center_id || null,
  }
}
