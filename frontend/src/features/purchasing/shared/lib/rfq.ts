import Decimal from 'decimal.js'
import type { PurchaseRfq, QuoteEntryInput, RfqComparison } from '../types'
import { decimalProblem, dec, orNull, plain } from './forms'

export interface QuoteRow {
  rfqLineId: string
  unitPrice: string
  discountPercent: string
  leadTimeDays: string
  validUntil: string
  notes: string
}

/** Entry rows of one supplier, prefilled with its stored quotes. */
export function quoteRows(rfq: PurchaseRfq, partyId: string): QuoteRow[] {
  return rfq.lines.map((l) => {
    const q = rfq.quotes.find((x) => x.party_id === partyId && x.rfq_line_id === l.id)
    return {
      rfqLineId: l.id,
      unitPrice: q ? plain(q.unit_price) : '',
      discountPercent: q && !dec(q.discount_percent).isZero() ? plain(q.discount_percent) : '',
      leadTimeDays: q?.lead_time_days === null || q === undefined ? '' : String(q.lead_time_days),
      validUntil: q?.valid_until ?? '',
      notes: q?.notes ?? '',
    }
  })
}

export type QuoteRowProblem = 'price' | 'discount' | 'leadTime' | null

/** A row with no price is "not quoted"; filled rows must be valid API values. */
export function quoteRowProblem(row: QuoteRow): QuoteRowProblem {
  if (row.unitPrice.trim() === '') return null
  if (decimalProblem(row.unitPrice, { scale: 6 })) return 'price'
  if (decimalProblem(row.discountPercent, { scale: 4, max: '100', optional: true }))
    return 'discount'
  const lead = row.leadTimeDays.trim()
  if (lead !== '' && (!/^\d{1,4}$/.test(lead) || Number(lead) > 3650)) return 'leadTime'
  return null
}

/** POST /purchase-rfqs/{id}/quotes body; declined sends no quotes. */
export function quoteInput(
  partyId: string,
  rows: readonly QuoteRow[],
  declined: boolean,
  version: number,
): QuoteEntryInput {
  if (declined) return { party_id: partyId, declined: true, version }
  return {
    party_id: partyId,
    version,
    quotes: rows
      .filter((r) => r.unitPrice.trim() !== '')
      .map((r) => ({
        rfq_line_id: r.rfqLineId,
        unit_price: r.unitPrice.trim(),
        discount_percent: orNull(r.discountPercent),
        lead_time_days: r.leadTimeDays.trim() === '' ? null : Number(r.leadTimeDays.trim()),
        valid_until: orNull(r.validUntil),
        notes: orNull(r.notes),
      })),
  }
}

/** Net price after the quote discount (what the comparison ranks by). */
export function netPrice(unitPrice: string, discountPercent: string): Decimal {
  return dec(unitPrice).mul(new Decimal(1).minus(dec(discountPercent).div(100)))
}

/** Per line the supplier with the lowest net price (the API sorts quotes lowest first). */
export function lowestPicks(comparison: RfqComparison): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of comparison.lines) {
    const best = l.quotes[0]
    if (best) out[l.rfq_line_id] = best.party_id
  }
  return out
}

/** Per supplier the lines and value a per-line award would give it. */
export function awardSummary(
  comparison: RfqComparison,
  picks: Record<string, string>,
): { party_id: string; party_name: string; lines: number; total: string }[] {
  const by = new Map<
    string,
    { party_id: string; party_name: string; lines: number; total: Decimal }
  >()
  for (const l of comparison.lines) {
    const party = picks[l.rfq_line_id]
    const q = l.quotes.find((x) => x.party_id === party)
    if (!q) continue
    const row = by.get(q.party_id) ?? {
      party_id: q.party_id,
      party_name: q.party_name ?? '',
      lines: 0,
      total: new Decimal(0),
    }
    row.lines += 1
    row.total = row.total.plus(dec(q.line_total))
    by.set(q.party_id, row)
  }
  return [...by.values()].map((r) => ({ ...r, total: r.total.toFixed(2) }))
}
