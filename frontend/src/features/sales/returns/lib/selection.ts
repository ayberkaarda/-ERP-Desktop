import { toIsoDate } from '@/lib/datetime'
import type { InvoiceLine } from '../../invoices/types'
import { dec, isDecimal } from '../../invoices/kit/money'
import type { ReturnInput, ReturnStatus, ReturnAction } from '../types'

export interface ReturnLineValues {
  invoiceLineId: string
  selected: boolean
  itemLabel: string
  unitCode: string
  unitPrice: string
  /** Discounted net amount of the invoice line (before tax). */
  netAmount: string
  invoiced: string
  /** Invoiced minus already returned (never negative). */
  returnable: string
  quantity: string
  /** Shipped serials still returnable (serial-shipped lines return by serial). */
  serials: string[]
  /** Serials picked for this return; the quantity follows their count. */
  pickedSerials: string[]
}

export interface ReturnValues {
  documentDate: string
  warehouseId: string
  reason: string
  notes: string
  lines: ReturnLineValues[]
}

/** Invoiced minus what other non-cancelled returns already hold (never negative). */
export function returnableOf(line: Pick<InvoiceLine, 'quantity'>, returned = '0'): string {
  const r = dec(line.quantity).minus(dec(returned))
  return r.isNegative() ? '0' : r.toString()
}

const label = (code?: string | null, name?: string | null, text?: string | null) =>
  [code, name ?? text].filter((x) => x).join(' · ')

/**
 * Every invoice line, unselected, at its returnable quantity (fully returned lines disabled).
 * `returned`: quantity per invoice line on the invoice's other returns.
 */
export function valuesFromInvoice(
  lines: readonly InvoiceLine[],
  warehouseId: string,
  returned: Readonly<Record<string, string>> = {},
): ReturnValues {
  return {
    documentDate: toIsoDate(new Date()),
    warehouseId,
    reason: '',
    notes: '',
    lines: lines.map((l) => {
      const serials = l.returnable_serials ?? []
      const left = returnableOf(l, returned[l.id])
      // Serial-shipped lines can only give back serials no other return holds.
      const returnable =
        serials.length > 0 && dec(left).greaterThan(serials.length) ? String(serials.length) : left
      return {
        invoiceLineId: l.id,
        selected: false,
        itemLabel: label(l.item_code, l.item_name, l.description),
        unitCode: l.unit_code ?? '',
        unitPrice: l.unit_price,
        netAmount: l.net_amount,
        invoiced: l.quantity,
        returnable,
        quantity: serials.length > 0 ? '0' : returnable,
        serials,
        pickedSerials: [],
      }
    }),
  }
}

export interface ReturnLineProblem {
  index: number
  message: 'quantity' | 'overReturnable' | 'serials'
}

/** Selected lines need 0 < quantity <= returnable; serial-shipped lines need picked serials. */
export function selectionProblems(values: ReturnValues): ReturnLineProblem[] {
  const out: ReturnLineProblem[] = []
  values.lines.forEach((l, index) => {
    if (!l.selected) return
    if (l.serials.length > 0 && l.pickedSerials.length === 0)
      out.push({ index, message: 'serials' })
    else if (!isDecimal(l.quantity) || dec(l.quantity).lessThanOrEqualTo(0))
      out.push({ index, message: 'quantity' })
    else if (dec(l.quantity).greaterThan(dec(l.returnable)))
      out.push({ index, message: 'overReturnable' })
  })
  return out
}

export function toReturnInput(values: ReturnValues): ReturnInput {
  return {
    document_date: values.documentDate,
    warehouse_id: values.warehouseId || null,
    reason: values.reason.trim() || null,
    notes: values.notes.trim() || null,
    lines: values.lines
      .filter((l) => l.selected)
      .map((l) => ({
        invoice_line_id: l.invoiceLineId,
        quantity: l.serials.length > 0 ? String(l.pickedSerials.length) : l.quantity,
        lot_no: null,
        serial_numbers: l.serials.length > 0 ? [...l.pickedSerials] : [],
      })),
  }
}

/**
 * Value of the selected lines before tax: the invoice line's discounted net amount, taken in
 * proportion to the returned quantity (so line discounts are honoured).
 */
export function selectionValue(values: ReturnValues): string {
  return values.lines
    .filter((l) => l.selected && isDecimal(l.quantity))
    .reduce(
      (acc, l) =>
        dec(l.invoiced).isZero()
          ? acc
          : acc.plus(dec(l.netAmount).mul(dec(l.quantity)).div(dec(l.invoiced)).toDecimalPlaces(2)),
      dec('0'),
    )
    .toFixed(2)
}

/** The next step of a return in its state machine (cancel is offered separately). */
export function nextAction(status: ReturnStatus): Exclude<ReturnAction, 'cancel'> | null {
  switch (status) {
    case 'draft':
      return 'approve'
    case 'approved':
      return 'receive'
    case 'received':
      return 'credit'
    default:
      return null
  }
}

export const cancellable = (status: ReturnStatus) => status === 'draft' || status === 'approved'
