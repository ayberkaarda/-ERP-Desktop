import Decimal from 'decimal.js'
import { dec, isDecimal } from '@/features/sales/invoices/kit/money'

// Three-way match of a supplier invoice as GET /purchase-invoices/{id}/match (and the details of
// a 422 purchasing.match_failed) send it: per invoice line the order price and the ordered /
// received / invoiced quantities with the tolerances that applied.

export const MATCH_STATUSES = ['matched', 'qty_variance', 'price_variance', 'unmatched'] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export const MATCH_MODES = ['off', 'warn', 'block'] as const
export type MatchMode = (typeof MATCH_MODES)[number]

export interface MatchLine {
  invoice_line_id: string
  status: MatchStatus
  line_no: number | null
  order_line_id: string | null
  ordered: string | null
  received: string | null
  /** All invoices of the order line, this one included. */
  invoiced: string | null
  /** received (lines invoiced from receipts) or ordered (services, goods received at booking). */
  reference: string | null
  order_price: string | null
  invoice_price: string | null
  price_difference_percent: string | null
  qty_tolerance_percent: string | null
  price_tolerance_percent: string | null
  /** no_order for unmatched lines. */
  reason: string | null
}

export interface MatchResult {
  mode: MatchMode
  /** null for debit notes (not matched). */
  status: MatchStatus | null
  lines: MatchLine[]
  override_reason: string | null
  override_by: string | null
}

const str = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null
const decimal = (v: unknown): string | null => {
  const s = str(v)
  return s !== null && isDecimal(s) ? s : null
}
const isStatus = (v: unknown): v is MatchStatus =>
  typeof v === 'string' && (MATCH_STATUSES as readonly string[]).includes(v)
const isMode = (v: unknown): v is MatchMode =>
  typeof v === 'string' && (MATCH_MODES as readonly string[]).includes(v)

/** Reads a match payload defensively (unknown statuses count as unmatched). */
export function parseMatch(raw: unknown): MatchResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const lines = Array.isArray(r.lines) ? (r.lines as unknown[]) : []
  return {
    mode: isMode(r.mode) ? r.mode : 'warn',
    status: isStatus(r.status) ? r.status : null,
    override_reason: str(r.override_reason),
    override_by: str(r.override_by),
    lines: lines.flatMap((x): MatchLine[] => {
      if (!x || typeof x !== 'object') return []
      const l = x as Record<string, unknown>
      const id = str(l.invoice_line_id)
      if (!id) return []
      const lineNo = typeof l.line_no === 'number' ? l.line_no : Number(str(l.line_no) ?? NaN)
      return [
        {
          invoice_line_id: id,
          status: isStatus(l.status) ? l.status : 'unmatched',
          line_no: Number.isFinite(lineNo) ? lineNo : null,
          order_line_id: str(l.order_line_id),
          ordered: decimal(l.ordered),
          received: decimal(l.received),
          invoiced: decimal(l.invoiced),
          reference: decimal(l.reference),
          order_price: decimal(l.order_price),
          invoice_price: decimal(l.invoice_price),
          price_difference_percent: decimal(l.price_difference_percent),
          qty_tolerance_percent: decimal(l.qty_tolerance_percent),
          price_tolerance_percent: decimal(l.price_tolerance_percent),
          reason: str(l.reason),
        },
      ]
    }),
  }
}

export const isVariance = (s: MatchStatus | null | undefined): boolean =>
  s === 'qty_variance' || s === 'price_variance'

/** Quantity allowed by the match: reference × (1 + tolerance %), as the server truncates (6). */
export function allowedQuantity(l: MatchLine): string | null {
  if (l.reference === null) return null
  const tol = dec(l.qty_tolerance_percent)
  return dec(l.reference)
    .mul(new Decimal(100).plus(tol))
    .div(100)
    .toDecimalPlaces(6, Decimal.ROUND_DOWN)
    .toString()
}

/** Invoiced beyond the allowed quantity (positive) or null when within it / unknown. */
export function quantityExcess(l: MatchLine): string | null {
  const allowed = allowedQuantity(l)
  if (allowed === null || l.invoiced === null) return null
  const excess = dec(l.invoiced).minus(allowed)
  return excess.greaterThan(0) ? excess.toString() : null
}

/** Price difference beyond the tolerance (independent of the status, which shows qty first). */
export function priceOff(l: MatchLine): boolean {
  if (l.price_difference_percent === null) return false
  return dec(l.price_difference_percent).greaterThan(dec(l.price_tolerance_percent))
}

export function quantityOff(l: MatchLine): boolean {
  return quantityExcess(l) !== null
}

/** Counts per status for the summary chips. */
export function matchCounts(m: MatchResult): Record<MatchStatus, number> {
  const out: Record<MatchStatus, number> = {
    matched: 0,
    qty_variance: 0,
    price_variance: 0,
    unmatched: 0,
  }
  for (const l of m.lines) out[l.status] += 1
  return out
}

/**
 * What booking does with this match: `block` refuses a variance unless overridden with a reason
 * (purchasing.match_override); `warn` books with a warning; `off` and clean matches just book.
 */
export function bookingOutcome(m: MatchResult | null): 'clean' | 'warn' | 'block' | 'off' {
  if (!m) return 'clean'
  if (m.mode === 'off') return 'off'
  if (!isVariance(m.status)) return 'clean'
  return m.mode === 'block' ? 'block' : 'warn'
}
