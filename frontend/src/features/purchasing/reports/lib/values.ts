import Decimal from 'decimal.js'
import { isDecimal } from '@/features/sales/invoices/kit/money'
import { PURCH_PERMS } from '../../invoices/kit/permissions'
import { INVOICES_BASE, ORDERS_BASE, RECEIPTS_BASE, RETURNS_BASE } from '../../invoices/kit/links'
import type { ChartDef, LinkKind, Row } from '../definitions'
import { stringAt } from './params'

/** A 0..1 fraction as a percentage string (exact Decimal x100), '' when not a decimal. */
export function ratioToPercent(value: string): string {
  return isDecimal(value) ? new Decimal(value).mul(100).toString() : ''
}

/** Rows for the chart: ratio values are plotted as percentages. */
export function chartRows(chart: ChartDef, rows: readonly Row[]): Row[] {
  if (!chart.ratio) return [...rows]
  return rows.map((r) => {
    const out: Row = { ...r }
    for (const key of chart.values) out[key] = ratioToPercent(stringAt(r, key))
    return out
  })
}

/** Unfiltered meta.totals as a row of strings (the ageing chart reads every bucket from it). */
export function metaTotals(meta: Row | null | undefined): Row | null {
  const totals = meta?.totals
  if (totals === null || typeof totals !== 'object') return null
  const out: Row = {}
  for (const [k, v] of Object.entries(totals as Row)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = String(v)
  }
  return out
}

type Target = Exclude<LinkKind, 'source'>

export const LINK_TARGETS: Record<Target, { base: string; permission: string }> = {
  order: { base: ORDERS_BASE, permission: PURCH_PERMS.orders.view },
  receipt: { base: RECEIPTS_BASE, permission: PURCH_PERMS.receipts.view },
  invoice: { base: INVOICES_BASE, permission: PURCH_PERMS.invoices.view },
  return: { base: RETURNS_BASE, permission: PURCH_PERMS.returns.view },
}

/** The document a link column points to (price variance: invoice, debit note or return). */
export function linkTarget(kind: LinkKind, row: Row): Target | null {
  if (kind !== 'source') return kind
  const source = stringAt(row, 'source')
  if (source === 'invoice' || source === 'debit_note') return 'invoice'
  if (source === 'return') return 'return'
  return null
}
