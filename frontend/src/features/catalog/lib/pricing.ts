import Decimal from 'decimal.js'
import type { PricingResult } from '../types'

/** The resolver's fixed order (PHASE2 PriceResolver); the playground explains each step. */
export const PRECEDENCE_STEPS = [
  'partyList',
  'defaultList',
  'validity',
  'minQty',
  'discount',
  'stacking',
] as const
export type PrecedenceStep = (typeof PRECEDENCE_STEPS)[number]

export type StepState = 'decided' | 'passed' | 'skipped' | 'none'

/** Which steps decided the result, derived from `source` when the API sends no trace. */
export function explainResult(result: PricingResult): Record<PrecedenceStep, StepState> {
  const priced = result.unit_price !== null
  const discounted = !new Decimal(result.discount_percent || '0').isZero()
  const fromParty = result.source === 'party_price_list'
  const fromDefault = result.source === 'default_price_list'
  const stacked = (result.discount_rule_ids?.length ?? 0) > 1
  return {
    partyList: fromParty ? 'decided' : 'skipped',
    defaultList: fromDefault ? 'decided' : fromParty ? 'passed' : 'skipped',
    validity: priced ? 'passed' : 'none',
    minQty: priced ? 'decided' : 'none',
    discount: discounted ? 'decided' : 'none',
    stacking: stacked ? 'decided' : discounted ? 'passed' : 'none',
  }
}

/** unit_price × (1 − discount/100), at price scale (6). */
export function netUnitPrice(unitPrice: string | null, discountPercent: string): string | null {
  if (unitPrice === null) return null
  const factor = new Decimal(1).minus(new Decimal(discountPercent || '0').dividedBy(100))
  return new Decimal(unitPrice).times(factor).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed()
}

/** Net line amount for the playground's quantity, at money scale (2). */
export function lineTotal(net: string | null, qty: string): string | null {
  if (net === null || !/^-?\d+(?:\.\d+)?$/.test(qty)) return null
  return new Decimal(net).times(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
}
