import Decimal from 'decimal.js'
import { z } from 'zod'
import { decimalString, MSG, requiredString } from '@/lib/forms'
import { validateBarcode } from '../lib/barcode'
import { factorProblem, MAX_QTY } from '../lib/conversion'
import {
  BARCODE_TYPES,
  DISCOUNT_SCOPES,
  ITEM_TYPES,
  TRACKING_MODES,
  type DiscountRule,
  type DiscountRuleInput,
  type Item,
  type ItemInput,
  type PriceList,
  type PriceListInput,
  type PriceListLine,
} from '../types'
import { fromAttributeRows, toAttributeRows } from '../lib/attributes'
import {
  attributeRows,
  CMSG,
  codeString,
  emptyToNull,
  optionalDate,
  optionalDecimal,
} from './common'

export { CMSG } from './common'

/** Adds a dateOrder issue on `to` when both dates are set and `to` precedes `from`. */
function checkDates(from: string, to: string, ctx: z.RefinementCtx, path: (string | number)[]) {
  if (from && to && to < from) ctx.addIssue({ code: 'custom', message: CMSG.dateOrder, path })
}

// Units ---------------------------------------------------------------------------------------

export const unitSchema = z.object({
  code: codeString,
  name: requiredString(),
  symbol: z.string().trim().max(16, MSG.max),
  is_active: z.boolean(),
})
export type UnitValues = z.infer<typeof unitSchema>

const FACTOR_MESSAGE = {
  number: MSG.number,
  scale: MSG.scale,
  positive: CMSG.factorPositive,
  max: CMSG.factorRange,
} as const

/** Matrix cell / alternate-unit factor: numeric(20,6), strictly above zero. */
export const factorString = z
  .string()
  .min(1, MSG.required)
  .superRefine((value, ctx) => {
    const problem = factorProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: FACTOR_MESSAGE[problem] })
  })

// Categories ----------------------------------------------------------------------------------

export const categorySchema = z.object({
  code: codeString,
  name: requiredString(),
  parent_id: z.string(),
})
export type CategoryValues = z.infer<typeof categorySchema>

// Items ---------------------------------------------------------------------------------------

export const itemSchema = z.object({
  name: requiredString().max(200, MSG.max),
  type: z.enum(ITEM_TYPES),
  base_unit_id: z.string().min(1, MSG.required),
  category_id: z.string(),
  default_tax_code_id: z.string(),
  purchase_tax_code_id: z.string(),
  tracking: z.enum(TRACKING_MODES),
  has_expiry: z.boolean(),
  min_stock: optionalDecimal({ nonNegative: true, scale: 6, max: MAX_QTY }),
  reorder_point: optionalDecimal({ nonNegative: true, scale: 6, max: MAX_QTY }),
  is_active: z.boolean(),
  attributes: attributeRows,
})
export type ItemValues = z.infer<typeof itemSchema>

export function itemDefaults(item?: Item): ItemValues {
  return {
    name: item?.name ?? '',
    type: item?.type ?? 'stock',
    base_unit_id: item?.base_unit_id ?? '',
    category_id: item?.category_id ?? '',
    default_tax_code_id: item?.default_tax_code_id ?? '',
    purchase_tax_code_id: item?.purchase_tax_code_id ?? '',
    tracking: item?.tracking ?? 'none',
    has_expiry: item?.has_expiry ?? false,
    min_stock: item?.min_stock ?? '',
    reorder_point: item?.reorder_point ?? '',
    is_active: item?.is_active ?? true,
    attributes: toAttributeRows(item?.attributes),
  }
}

export function toItemInput(v: ItemValues): ItemInput {
  // Services carry no stock: tracking, expiry and stock levels are cleared.
  const stock = v.type === 'stock'
  return {
    name: v.name.trim(),
    type: v.type,
    base_unit_id: v.base_unit_id,
    category_id: emptyToNull(v.category_id),
    default_tax_code_id: emptyToNull(v.default_tax_code_id),
    purchase_tax_code_id: emptyToNull(v.purchase_tax_code_id),
    tracking: stock ? v.tracking : 'none',
    has_expiry: stock && v.has_expiry,
    min_stock: stock ? emptyToNull(v.min_stock) : null,
    reorder_point: stock ? emptyToNull(v.reorder_point) : null,
    is_active: v.is_active,
    attributes: fromAttributeRows(v.attributes),
  }
}

export const variantSchema = z.object({
  sku: codeString,
  attributes: attributeRows,
  is_active: z.boolean(),
})
export type VariantValues = z.infer<typeof variantSchema>

export const barcodeSchema = z
  .object({
    barcode: requiredString().max(64, MSG.max),
    type: z.enum(BARCODE_TYPES),
    unit_id: z.string().min(1, MSG.required),
    variant_id: z.string(),
    is_primary: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const check = validateBarcode(v.barcode, v.type)
    if (check.ok || check.problem === 'empty') return
    ctx.addIssue({
      code: 'custom',
      path: ['barcode'],
      message: `catalog:barcode.problem.${check.problem ?? 'checkDigit'}`,
    })
  })
export type BarcodeValues = z.infer<typeof barcodeSchema>

export const itemUnitSchema = z.object({
  unit_id: z.string().min(1, MSG.required),
  factor: factorString,
})
export type ItemUnitValues = z.infer<typeof itemUnitSchema>

// Price lists ---------------------------------------------------------------------------------

export const priceListSchema = z
  .object({
    code: codeString,
    name: requiredString(),
    currency_code: z.string().regex(/^[A-Z]{3}$/, MSG.required),
    is_default: z.boolean(),
    valid_from: optionalDate,
    valid_to: optionalDate,
    is_active: z.boolean(),
    tax_inclusive: z.boolean(),
  })
  .superRefine((v, ctx) => checkDates(v.valid_from, v.valid_to, ctx, ['valid_to']))
export type PriceListValues = z.infer<typeof priceListSchema>

export function priceListDefaults(p?: PriceList): PriceListValues {
  return {
    code: p?.code ?? '',
    name: p?.name ?? '',
    currency_code: p?.currency_code ?? 'TRY',
    is_default: p?.is_default ?? false,
    valid_from: p?.valid_from ?? '',
    valid_to: p?.valid_to ?? '',
    is_active: p?.is_active ?? true,
    tax_inclusive: p?.tax_inclusive ?? false,
  }
}

export function toPriceListInput(v: PriceListValues): PriceListInput {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    currency_code: v.currency_code,
    is_default: v.is_default,
    valid_from: emptyToNull(v.valid_from),
    valid_to: emptyToNull(v.valid_to),
    is_active: v.is_active,
    tax_inclusive: v.tax_inclusive,
  }
}

export const priceLineSchema = z
  .object({
    id: z.string(),
    item_id: z.string().min(1, MSG.required),
    variant_id: z.string(),
    unit_id: z.string().min(1, MSG.required),
    min_qty: decimalString({ nonNegative: true, scale: 6, max: MAX_QTY }),
    price: decimalString({ positive: true, scale: 6, max: MAX_QTY }),
    valid_from: optionalDate,
    valid_to: optionalDate,
  })
  .superRefine((v, ctx) => checkDates(v.valid_from, v.valid_to, ctx, ['valid_to']))
export type PriceLineValues = z.infer<typeof priceLineSchema>

export const priceLinesSchema = z.object({ lines: z.array(priceLineSchema) })
export type PriceLinesValues = z.infer<typeof priceLinesSchema>

export function toLineValues(l: PriceListLine): PriceLineValues {
  return {
    id: l.id ?? '',
    item_id: l.item_id,
    variant_id: l.variant_id ?? '',
    unit_id: l.unit_id,
    min_qty: l.min_qty,
    price: l.price,
    valid_from: l.valid_from ?? '',
    valid_to: l.valid_to ?? '',
  }
}

export function toLineInput(v: PriceLineValues): PriceListLine {
  return {
    ...(v.id ? { id: v.id } : {}),
    item_id: v.item_id,
    variant_id: emptyToNull(v.variant_id),
    unit_id: v.unit_id,
    min_qty: v.min_qty,
    price: v.price,
    valid_from: emptyToNull(v.valid_from),
    valid_to: emptyToNull(v.valid_to),
  }
}

export const emptyLine = (): PriceLineValues => ({
  id: '',
  item_id: '',
  variant_id: '',
  unit_id: '',
  min_qty: '1',
  price: '',
  valid_from: '',
  valid_to: '',
})

// Discount rules ------------------------------------------------------------------------------

export const discountRuleSchema = z
  .object({
    code: codeString,
    name: requiredString(),
    scope: z.enum(DISCOUNT_SCOPES),
    scope_ref: z.string(),
    party_id: z.string(),
    min_qty: optionalDecimal({ nonNegative: true, scale: 6, max: MAX_QTY }),
    discount_percent: decimalString({ scale: 4 }),
    priority: z.string().regex(/^\d{1,6}$/, CMSG.integer),
    valid_from: optionalDate,
    valid_to: optionalDate,
    is_active: z.boolean(),
    stackable: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (/^-?\d+(?:\.\d+)?$/.test(v.discount_percent)) {
      const d = new Decimal(v.discount_percent)
      if (d.lessThanOrEqualTo(0) || d.greaterThan(100))
        ctx.addIssue({ code: 'custom', message: CMSG.percentRange, path: ['discount_percent'] })
    }
    if (v.scope !== 'all' && v.scope_ref === '')
      ctx.addIssue({ code: 'custom', message: CMSG.scopeRef, path: ['scope_ref'] })
    checkDates(v.valid_from, v.valid_to, ctx, ['valid_to'])
  })
export type DiscountRuleValues = z.infer<typeof discountRuleSchema>

export function discountRuleDefaults(r?: DiscountRule): DiscountRuleValues {
  return {
    code: r?.code ?? '',
    name: r?.name ?? '',
    scope: r?.scope ?? 'all',
    scope_ref: r?.scope_ref ?? '',
    party_id: r?.party_id ?? '',
    min_qty: r?.min_qty ?? '',
    discount_percent: r?.discount_percent ?? '',
    priority: String(r?.priority ?? 10),
    valid_from: r?.valid_from ?? '',
    valid_to: r?.valid_to ?? '',
    is_active: r?.is_active ?? true,
    stackable: r?.stackable ?? false,
  }
}

export function toDiscountRuleInput(v: DiscountRuleValues): DiscountRuleInput {
  return {
    code: v.code.trim(),
    name: v.name.trim(),
    scope: v.scope,
    scope_ref: v.scope === 'all' ? null : emptyToNull(v.scope_ref),
    // A party-scoped rule already names the party in scope_ref.
    party_id: v.scope === 'party' ? null : emptyToNull(v.party_id),
    min_qty: emptyToNull(v.min_qty),
    discount_percent: v.discount_percent,
    priority: Number(v.priority),
    valid_from: emptyToNull(v.valid_from),
    valid_to: emptyToNull(v.valid_to),
    is_active: v.is_active,
    stackable: v.stackable,
  }
}

// Pricing playground --------------------------------------------------------------------------

export const playgroundSchema = z.object({
  item_id: z.string().min(1, MSG.required),
  variant_id: z.string(),
  party_id: z.string(),
  qty: decimalString({ positive: true, scale: 6, max: MAX_QTY }),
  unit_id: z.string(),
  date: z.string().min(1, MSG.required),
  currency: z.string(),
})
export type PlaygroundValues = z.infer<typeof playgroundSchema>
