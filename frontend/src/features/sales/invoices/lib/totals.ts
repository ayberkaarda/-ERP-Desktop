import Decimal from 'decimal.js'
import { dec } from '../kit/money'

/** Currency scale of document amounts (per_line rounding, the PHASE5 default). */
export const AMOUNT_SCALE = 2

export interface LineMath {
  quantity: string
  unitPrice: string
  discountPercent: string
  discountAmount: string
  /** Tax rate in percent ("20"). */
  taxRate: string
}

export interface LineAmounts {
  gross: string
  discount: string
  net: string
  tax: string
  total: string
}

const round = (d: Decimal, scale = AMOUNT_SCALE) => d.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP)

/**
 * Editor estimate of one line, matching the server rule: net = qty × price × (1 − disc%) −
 * discount_amount, rounded half-up per line; tax = net × rate, rounded per line. The server's
 * preview-totals answer replaces it as soon as it arrives.
 */
export function lineAmounts(line: LineMath, scale = AMOUNT_SCALE): LineAmounts {
  const raw = dec(line.quantity).mul(dec(line.unitPrice))
  const gross = round(raw, scale)
  const pct = Decimal.min(Decimal.max(dec(line.discountPercent), 0), 100)
  const net = round(
    raw.mul(new Decimal(1).minus(pct.div(100))).minus(dec(line.discountAmount)),
    scale,
  )
  const tax = round(net.mul(dec(line.taxRate)).div(100), scale)
  return {
    gross: gross.toFixed(scale),
    discount: gross.minus(net).toFixed(scale),
    net: net.toFixed(scale),
    tax: tax.toFixed(scale),
    total: net.plus(tax).toFixed(scale),
  }
}

export interface DocumentAmounts {
  subtotal: string
  discount_total: string
  tax_total: string
  total: string
  /** Tax per rate: base and amount (sum of the rounded lines). */
  byRate: { rate: string; base: string; tax: string }[]
}

/** Header totals = sums of the rounded line amounts, so the total equals the printed lines. */
export function documentAmounts(lines: readonly LineMath[], scale = AMOUNT_SCALE): DocumentAmounts {
  let subtotal = new Decimal(0)
  let discount = new Decimal(0)
  let tax = new Decimal(0)
  let net = new Decimal(0)
  const byRate = new Map<string, { base: Decimal; tax: Decimal }>()
  for (const line of lines) {
    const a = lineAmounts(line, scale)
    subtotal = subtotal.plus(a.gross)
    discount = discount.plus(a.discount)
    tax = tax.plus(a.tax)
    net = net.plus(a.net)
    const rate = dec(line.taxRate).toString()
    const slot = byRate.get(rate) ?? { base: new Decimal(0), tax: new Decimal(0) }
    byRate.set(rate, { base: slot.base.plus(a.net), tax: slot.tax.plus(a.tax) })
  }
  return {
    subtotal: subtotal.toFixed(scale),
    discount_total: discount.toFixed(scale),
    tax_total: tax.toFixed(scale),
    total: net.plus(tax).toFixed(scale),
    byRate: [...byRate.entries()]
      .sort(([a], [b]) => dec(a).comparedTo(dec(b)))
      .map(([rate, v]) => ({ rate, base: v.base.toFixed(scale), tax: v.tax.toFixed(scale) })),
  }
}

/** Company currency amount: round(amount × fx_rate) at the money scale. */
export function toLocal(amount: string, fxRate: string, scale = AMOUNT_SCALE): string {
  const rate = dec(fxRate).isZero() ? new Decimal(1) : dec(fxRate)
  return round(dec(amount).mul(rate), scale).toFixed(scale)
}
