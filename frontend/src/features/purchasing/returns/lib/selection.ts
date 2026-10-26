import Decimal from 'decimal.js'
import { dec, isDecimal } from '@/features/sales/invoices/kit/money'
import type { Invoice } from '../../invoices/types'
import { factorOf, parseSerials } from '../../receipts/lib/lines'
import type { Receipt } from '../../receipts/types'
import type { ReturnCreateInput } from '../types'

export type ReturnSourceKind = 'invoice' | 'receipt'

/** One source line offered for return. */
export interface SelectionRow {
  sourceLineId: string
  lineNo: number
  itemLabel: string
  unitCode: string
  tracking: 'none' | 'lot' | 'serial'
  /** Source quantity minus what non-cancelled returns already hold (null when unknown). */
  returnable: string | null
  sourceQuantity: string
  /** Net per unit of the source line (invoice returns: debit value preview). */
  unitNet: string | null
  quantity: string
  lotNo: string
  serialsText: string
  /** Base units per document unit: one serial per base unit. */
  baseFactor: string
  /**
   * Receipt returns: the server also deducts quantities held by invoices of the receipt
   * (Quantities::openOnReceipt), which the UI cannot read; `returnable` is then an upper bound.
   */
  upperBound: boolean
}

const label = (code?: string | null, name?: string | null, description?: string | null) =>
  [code, description ?? name].filter((x) => x).join(' ')

function returnableOf(
  quantity: string,
  returned: Map<string, string> | null,
  id: string,
): string | null {
  if (returned === null) return null
  return Decimal.max(dec(quantity).minus(dec(returned.get(id) ?? '0')), 0).toString()
}

/** Lines of a booked purchase invoice, nothing selected (quantity 0). */
export function rowsFromInvoice(
  inv: Invoice,
  returned: Map<string, string> | null,
): SelectionRow[] {
  // Services are returnable too (debit note without a stock movement).
  return inv.lines.map((l) => ({
    sourceLineId: l.id,
    lineNo: l.line_no,
    itemLabel: label(l.item_code, l.item_name, l.description),
    unitCode: l.unit_code ?? '',
    tracking: l.item_tracking,
    returnable: l.returnable_quantity ?? returnableOf(l.quantity, returned, l.id),
    sourceQuantity: l.quantity,
    unitNet: dec(l.quantity).isZero() ? null : dec(l.net_amount).div(dec(l.quantity)).toString(),
    quantity: '0',
    lotNo: '',
    serialsText: '',
    baseFactor: factorOf(l),
    upperBound: false,
  }))
}

/** Lines of a posted receipt with their lot and serials prefilled, nothing selected. */
export function rowsFromReceipt(r: Receipt, returned: Map<string, string> | null): SelectionRow[] {
  return r.lines.map((l) => ({
    sourceLineId: l.id,
    lineNo: l.line_no,
    itemLabel: label(l.item_code, l.item_name, l.description),
    unitCode: l.unit_code ?? '',
    tracking: l.item_tracking,
    returnable: l.returnable_quantity ?? returnableOf(l.quantity, returned, l.id),
    sourceQuantity: l.quantity,
    unitNet: null,
    quantity: '0',
    lotNo: l.lot_no ?? '',
    serialsText: '',
    baseFactor: factorOf(l),
    upperBound: l.returnable_quantity === undefined,
  }))
}

export const isSelected = (r: SelectionRow) =>
  isDecimal(r.quantity) && dec(r.quantity).greaterThan(0)

/** Rows asking more than is returnable (the server refuses them with lines.N.quantity). */
export function overReturnable(r: SelectionRow): boolean {
  return isSelected(r) && r.returnable !== null && dec(r.quantity).greaterThan(dec(r.returnable))
}

export function serialProblem(r: SelectionRow): boolean {
  if (!isSelected(r) || r.tracking !== 'serial') return false
  return !dec(r.quantity)
    .mul(dec(r.baseFactor || '1'))
    .equals(parseSerials(r.serialsText).length)
}

/** Debit value preview of the selection: unit net × quantity (the server allocates exactly). */
export function selectionValue(rows: readonly SelectionRow[]): string {
  return rows
    .filter(isSelected)
    .reduce((acc, r) => acc.plus(dec(r.unitNet).mul(dec(r.quantity))), new Decimal(0))
    .toFixed(2)
}

export function toCreateInput(
  kind: ReturnSourceKind,
  rows: readonly SelectionRow[],
  header: { documentDate: string; warehouseId: string; reason: string; notes: string },
): ReturnCreateInput {
  const key = kind === 'invoice' ? 'invoice_line_id' : 'receipt_line_id'
  return {
    document_date: header.documentDate,
    warehouse_id: header.warehouseId || null,
    reason: header.reason.trim() || null,
    notes: header.notes.trim() || null,
    lines: rows.filter(isSelected).map((r) => ({
      [key]: r.sourceLineId,
      quantity: r.quantity,
      lot_no: r.tracking !== 'none' ? r.lotNo.trim() || null : null,
      serial_numbers: r.tracking === 'serial' ? parseSerials(r.serialsText) : [],
    })),
  }
}
