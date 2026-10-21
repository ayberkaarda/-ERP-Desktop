import Decimal from 'decimal.js'
import { toIsoDate } from '@/lib/datetime'
import { dec, isDecimal } from '../../invoices/kit/money'
import type { Delivery } from '../api'
import type {
  DeliveryFromOrderInput,
  DeliveryInput,
  DeliveryLine,
  OrderSource,
  TrackingMode,
} from '../types'
import type { LotAllocation } from './fefo'

export interface DeliveryLineValues {
  /** Stable client id of the row (never sent): async results find their row by it. */
  rowKey: string
  /** Order line delivered ('' on direct deliveries). */
  sourceLineId: string
  itemId: string
  itemLabel: string
  tracking: TrackingMode
  unitId: string
  unitCode: string
  quantity: string
  /** Ordered minus delivered when the line comes from an order ('' otherwise). */
  remaining: string
  warehouseId: string
  lotNo: string
  /** One serial per line of text (also accepts commas and semicolons). */
  serials: string
}

export interface DeliveryValues {
  partyId: string
  partyLabel: string
  orderId: string
  documentDate: string
  warehouseId: string
  notes: string
  lines: DeliveryLineValues[]
}

let rowSeq = 0

/** A new client row id; unique within the page session. */
export function nextRowKey(): string {
  rowSeq += 1
  return `row-${rowSeq}`
}

export function emptyLine(): DeliveryLineValues {
  return {
    rowKey: nextRowKey(),
    sourceLineId: '',
    itemId: '',
    itemLabel: '',
    tracking: 'none',
    unitId: '',
    unitCode: '',
    quantity: '',
    remaining: '',
    warehouseId: '',
    lotNo: '',
    serials: '',
  }
}

/** Splits pasted or typed serial text into trimmed entries. */
export function parseSerials(text: string): string[] {
  return text
    .split(/[\n,;\t]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

/** Serials appearing more than once in the list. */
export function duplicateSerials(serials: readonly string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const s of serials) {
    if (seen.has(s)) dup.add(s)
    seen.add(s)
  }
  return [...dup]
}

/** A line the user left at zero or blank: not sent (partial delivery of an order). */
export function isSkipped(line: DeliveryLineValues): boolean {
  return !line.itemId || !isDecimal(line.quantity) || dec(line.quantity).isZero()
}

/** Remaining quantity of an order line (never negative). */
export function remainingOf(ordered: string, delivered: string): string {
  const r = dec(ordered).minus(dec(delivered))
  return r.isNegative() ? '0' : r.toString()
}

const label = (code?: string | null, name?: string | null) =>
  [code, name].filter((x) => x).join(' · ')

/** A new delivery for an order: every line with something left, at its remaining quantity. */
export function valuesFromOrder(order: OrderSource, warehouseId: string): DeliveryValues {
  return {
    partyId: order.party_id,
    partyLabel: order.party_name ?? order.party_snapshot?.name ?? '',
    orderId: order.id,
    documentDate: toIsoDate(new Date()),
    warehouseId: order.warehouse_id ?? warehouseId,
    notes: '',
    lines: [...order.lines]
      .filter((l) => l.item_type !== 'service')
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => {
        const remaining = remainingOf(l.quantity, l.delivered_quantity)
        return {
          ...emptyLine(),
          sourceLineId: l.id,
          itemId: l.item_id,
          itemLabel: label(l.item_code, l.item_name) || (l.description ?? ''),
          tracking: l.item_tracking ?? 'none',
          unitId: l.unit_id,
          unitCode: l.unit_code ?? '',
          quantity: remaining,
          remaining,
          warehouseId: l.warehouse_id ?? '',
        }
      })
      .filter((l) => dec(l.remaining).greaterThan(0)),
  }
}

export function valuesFromDelivery(
  d: Delivery,
  remaining: Record<string, string> = {},
): DeliveryValues {
  return {
    partyId: d.party_id,
    partyLabel: d.party_name ?? d.party_snapshot?.name ?? '',
    orderId: d.order_id ?? '',
    documentDate: d.document_date,
    warehouseId: d.warehouse_id,
    notes: d.notes ?? '',
    lines: d.lines.map((l: DeliveryLine) => ({
      rowKey: nextRowKey(),
      sourceLineId: l.source_line_id ?? '',
      itemId: l.item_id,
      itemLabel: label(l.item_code, l.item_name) || (l.description ?? ''),
      tracking: l.item_tracking ?? 'none',
      unitId: l.unit_id,
      unitCode: l.unit_code ?? '',
      quantity: l.quantity,
      remaining: l.source_line_id ? (remaining[l.source_line_id] ?? '') : '',
      warehouseId: l.warehouse_id ?? '',
      lotNo: l.lot_no ?? '',
      serials: l.serial_numbers.join('\n'),
    })),
  }
}

/** The sent lines and, for each, its index in the form (to map server errors back). */
export function sentLines(values: DeliveryValues): { line: DeliveryLineValues; index: number }[] {
  return values.lines.flatMap((line, index) => (isSkipped(line) ? [] : [{ line, index }]))
}

export function toDeliveryInput(values: DeliveryValues): DeliveryInput {
  return {
    party_id: values.partyId,
    document_date: values.documentDate,
    warehouse_id: values.warehouseId,
    notes: values.notes.trim() || null,
    lines: sentLines(values).map(({ line }) => ({
      source_line_id: line.sourceLineId || null,
      item_id: line.itemId,
      unit_id: line.unitId,
      quantity: line.quantity,
      warehouse_id: line.warehouseId || null,
      lot_no: line.lotNo.trim() || null,
      serial_numbers: parseSerials(line.serials),
      description: null,
    })),
  }
}

export function toFromOrderInput(values: DeliveryValues): DeliveryFromOrderInput {
  return {
    document_date: values.documentDate,
    warehouse_id: values.warehouseId,
    notes: values.notes.trim() || null,
    lines: sentLines(values).map(({ line }) => ({
      order_line_id: line.sourceLineId,
      quantity: line.quantity,
      warehouse_id: line.warehouseId || null,
      lot_no: line.lotNo.trim() || null,
      serial_numbers: parseSerials(line.serials),
    })),
  }
}

/** Server `lines.N.field` (N among sent lines) -> form path `lines.<form index>.<field>`. */
export function serverFieldMapper(values: DeliveryValues) {
  const sent = sentLines(values)
  const FIELD: Record<string, keyof DeliveryLineValues> = {
    quantity: 'quantity',
    lot_no: 'lotNo',
    serial_numbers: 'serials',
    warehouse_id: 'warehouseId',
    item_id: 'itemId',
    unit_id: 'unitId',
    order_line_id: 'quantity',
    source_line_id: 'quantity',
  }
  const HEADER: Record<string, string> = {
    party_id: 'partyId',
    document_date: 'documentDate',
    warehouse_id: 'warehouseId',
    notes: 'notes',
    lines: 'lines',
  }
  return (path: string): string => {
    const m = /^lines\.(\d+)\.([a-z_]+)/.exec(path)
    if (m) {
      const index = sent[Number(m[1])]?.index
      const field = FIELD[m[2] ?? '']
      if (index !== undefined && field) return `lines.${index}.${field}`
      return 'lines'
    }
    return HEADER[path] ?? path
  }
}

export interface LineMessages {
  quantity: string
  lot: string
  serialCount: (count: number, quantity: string) => string
  serialInteger: string
  serialDuplicate: (serial: string) => string
  overRemaining: string
}

/**
 * Problems of one line: lot required for lot-tracked items, serial count equal to an integer
 * quantity and no serial used twice in the document (`elsewhere` = serials of other lines).
 */
export function lineProblems(
  line: DeliveryLineValues,
  m: LineMessages,
  elsewhere: ReadonlySet<string>,
): [keyof DeliveryLineValues, string][] {
  if (isSkipped(line)) {
    return line.quantity !== '' && !isDecimal(line.quantity) ? [['quantity', m.quantity]] : []
  }
  const out: [keyof DeliveryLineValues, string][] = []
  const q = dec(line.quantity)
  if (q.isNegative()) out.push(['quantity', m.quantity])
  if (line.tracking === 'lot' && line.lotNo.trim() === '') out.push(['lotNo', m.lot])
  if (line.tracking === 'serial') {
    const serials = parseSerials(line.serials)
    if (!q.isInteger()) out.push(['serials', m.serialInteger])
    else if (serials.length !== q.toNumber())
      out.push(['serials', m.serialCount(serials.length, q.toString())])
    const dup = [...duplicateSerials(serials), ...serials.filter((s) => elsewhere.has(s))]
    if (dup[0] !== undefined) out.push(['serials', m.serialDuplicate(dup[0])])
  }
  return out
}

export function serialsElsewhere(lines: readonly DeliveryLineValues[], index: number): Set<string> {
  return new Set(
    lines.flatMap((l, i) =>
      i === index || l.tracking !== 'serial' ? [] : parseSerials(l.serials),
    ),
  )
}

/** Over the order's remaining quantity (the server may still accept it within its tolerance). */
export function exceedsRemaining(
  line: DeliveryLineValues,
  siblings: readonly DeliveryLineValues[],
) {
  if (!line.sourceLineId || !isDecimal(line.remaining)) return false
  const total = siblings
    .filter((l) => l.sourceLineId === line.sourceLineId && !isSkipped(l))
    .reduce((acc, l) => acc.plus(dec(l.quantity)), new Decimal(0))
  return total.greaterThan(dec(line.remaining))
}

/**
 * Replaces line `index` with one line per FEFO allocation (same order line, item and unit);
 * a shortage stays on a last line without a lot so it is visible.
 */
export function applyAllocations(
  lines: readonly DeliveryLineValues[],
  index: number,
  allocations: readonly LotAllocation[],
  shortage: string,
): DeliveryLineValues[] {
  const line = lines[index]
  if (!line) return [...lines]
  // The first part keeps the row's identity; the others are new rows.
  const split = allocations.map((a, i) => ({
    ...line,
    rowKey: i === 0 ? line.rowKey : nextRowKey(),
    lotNo: a.lot_no,
    quantity: a.quantity,
  }))
  if (dec(shortage).greaterThan(0))
    split.push({
      ...line,
      rowKey: split.length === 0 ? line.rowKey : nextRowKey(),
      lotNo: '',
      quantity: shortage,
    })
  if (split.length === 0) return [...lines]
  return [...lines.slice(0, index), ...split, ...lines.slice(index + 1)]
}

/** Quantity per lot number already on other lines of the same item (FEFO must not reuse it). */
export function takenByOthers(
  lines: readonly DeliveryLineValues[],
  index: number,
): Record<string, string> {
  const target = lines[index]
  const out: Record<string, Decimal> = {}
  lines.forEach((l, i) => {
    if (i === index || l.itemId !== target?.itemId || !l.lotNo || isSkipped(l)) return
    out[l.lotNo] = (out[l.lotNo] ?? new Decimal(0)).plus(dec(l.quantity))
  })
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.toString()]))
}
