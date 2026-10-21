import Decimal from 'decimal.js'
import { toDecimal } from '@/lib/money'

const CANONICAL = /^-?\d+(?:\.\d+)?$/

/** Canonical decimal string or 0 (empty cells and rejected drafts count as nothing). */
export function amountOf(value: string | null | undefined): Decimal {
  return value && CANONICAL.test(value) ? toDecimal(value) : new Decimal(0)
}

export interface BalanceLine {
  debit: string
  credit: string
}

export interface Balance {
  debit: Decimal
  credit: Decimal
  /** debit - credit: positive means credit is missing, negative means debit is missing. */
  difference: Decimal
  balanced: boolean
}

/** Debit vs credit totals; an entry is balanced when both sides are equal and non-zero. */
export function balanceOf(lines: readonly BalanceLine[]): Balance {
  let debit = new Decimal(0)
  let credit = new Decimal(0)
  for (const l of lines) {
    debit = debit.plus(amountOf(l.debit))
    credit = credit.plus(amountOf(l.credit))
  }
  const difference = debit.minus(credit)
  return { debit, credit, difference, balanced: difference.isZero() && debit.greaterThan(0) }
}

/**
 * Amount and side that make the entry balance when put on line `index` (its own amounts are
 * left out); null when the other lines already balance.
 */
export function balancingAmount(
  lines: readonly BalanceLine[],
  index: number,
): { side: 'debit' | 'credit'; amount: string } | null {
  const others = balanceOf(lines.filter((_, i) => i !== index))
  if (others.difference.isZero()) return null
  return others.difference.greaterThan(0)
    ? { side: 'credit', amount: others.difference.toFixed(2) }
    : { side: 'debit', amount: others.difference.abs().toFixed(2) }
}

/** Base-currency preview of a foreign-currency line: fx amount × rate, half-up to 2 places. */
export function baseAmount(fxAmount: string, fxRate: string): string | null {
  if (!CANONICAL.test(fxAmount) || !CANONICAL.test(fxRate)) return null
  return toDecimal(fxAmount).mul(fxRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2)
}

/** Equality of two decimal strings regardless of scale ("10.5" = "10.5000"). */
export function sameAmount(a: string, b: string): boolean {
  return amountOf(a).equals(amountOf(b))
}
