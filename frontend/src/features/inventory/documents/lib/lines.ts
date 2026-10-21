import Decimal from 'decimal.js'
import { toIsoDate } from '@/lib/datetime'
import type { Item } from '@/features/catalog'
import type {
  Direction,
  EditableDocType,
  ItemRef,
  StockDocument,
  StockDocumentInput,
  StockDocumentLine,
  StockLineInput,
  UnitChoice,
} from '../types'
import {
  baseQuantity,
  dec,
  factorOf,
  isDecimal,
  isInteger,
  lineCost,
  MONEY_SCALE,
} from './quantity'

/** One editable line; the picked item and unit facts ride along for rules and previews. */
export interface LineValues {
  itemId: string
  item: ItemRef | null
  unitId: string
  unitCode: string
  /** 1 unit = factor base units (1 for the base unit). */
  factor: string
  quantity: string
  unitCost: string
  lotNo: string
  expiryDate: string
  /** Serial numbers as typed: one per line (commas and semicolons also separate). */
  serials: string
  locationId: string
  targetLocationId: string
  /** Adjustments: stock in or out (quantities stay positive). */
  direction: Direction
}

export interface DocValues {
  docType: EditableDocType
  documentDate: string
  warehouseId: string
  targetWarehouseId: string
  reason: string
  notes: string
  /** Issues and transfers: allow issuing from expired lots (permission-bearing). */
  allowExpired: boolean
  lines: LineValues[]
}

export function emptyLine(): LineValues {
  return {
    itemId: '',
    item: null,
    unitId: '',
    unitCode: '',
    factor: '1',
    quantity: '',
    unitCost: '',
    lotNo: '',
    expiryDate: '',
    serials: '',
    locationId: '',
    targetLocationId: '',
    direction: 'in',
  }
}

export function emptyDocument(
  docType: EditableDocType = 'receipt',
  warehouseId = '',
  today = toIsoDate(new Date()),
): DocValues {
  return {
    docType,
    documentDate: today,
    warehouseId,
    targetWarehouseId: '',
    reason: '',
    notes: '',
    allowExpired: false,
    lines: [emptyLine()],
  }
}

/** Rules that depend on the document type. */
export interface TypeRules {
  /** Unit cost column shown and sent (inbound valuation given by the user). */
  cost: boolean
  costRequired: boolean
  /** Target warehouse and target location (transfers). */
  target: boolean
  /** Each line says whether it moves stock in or out (adjustments). */
  direction: boolean
  /** Lot and expiry must be given for tracked items (stock comes in under that lot). */
  lotRequired: boolean
  /** Stock leaves the warehouse, so expired lots may be allowed explicitly. */
  issues: boolean
}

export function typeRules(type: EditableDocType): TypeRules {
  switch (type) {
    case 'receipt':
    case 'opening':
      return {
        cost: true,
        costRequired: true,
        target: false,
        direction: false,
        lotRequired: true,
        issues: false,
      }
    case 'adjustment':
      return {
        cost: true,
        costRequired: false,
        target: false,
        direction: true,
        lotRequired: true,
        issues: false,
      }
    case 'transfer':
      return {
        cost: false,
        costRequired: false,
        target: true,
        direction: false,
        lotRequired: false,
        issues: true,
      }
    case 'issue':
      return {
        cost: false,
        costRequired: false,
        target: false,
        direction: false,
        lotRequired: false,
        issues: true,
      }
  }
}

/** Serial numbers typed in a cell: trimmed, empty entries dropped, order kept. */
export function parseSerials(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

export function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out = new Set<string>()
  for (const v of values) {
    if (seen.has(v)) out.add(v)
    seen.add(v)
  }
  return [...out]
}

/** The picked catalog item as the line keeps it. */
export function toItemRef(item: Item): ItemRef {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    base_unit_id: item.base_unit_id,
    base_unit: item.base_unit ?? null,
    tracking: item.tracking,
    has_expiry: item.has_expiry,
    type: item.type,
  }
}

/** The item with its base unit labelled from its unit choices (search rows may not embed it). */
export function withBaseUnit(item: ItemRef, units: readonly UnitChoice[]): ItemRef {
  if (item.base_unit?.code) return item
  const base = units.find((u) => u.unit_id === item.base_unit_id)
  return base
    ? { ...item, base_unit: { id: base.unit_id, code: base.code, name: base.name } }
    : item
}

const text = (v: string | null | undefined) => v ?? ''

export function itemOfLine(l: StockDocumentLine): ItemRef {
  return {
    id: l.item_id,
    code: l.item_code ?? '',
    name: l.item_name ?? '',
    base_unit_id: l.base_unit_id ?? l.unit_id,
    base_unit: l.base_unit_code
      ? { id: l.base_unit_id ?? '', code: l.base_unit_code, name: l.base_unit_code }
      : null,
    tracking:
      l.item_tracking ?? (l.serial_numbers.length > 0 ? 'serial' : l.lot_no ? 'lot' : 'none'),
    has_expiry: l.item_has_expiry ?? Boolean(l.expiry_date),
  }
}

export function toDocValues(doc: StockDocument): DocValues {
  const type = doc.doc_type === 'count' ? 'adjustment' : doc.doc_type
  return {
    docType: type,
    documentDate: doc.document_date,
    warehouseId: doc.warehouse_id,
    targetWarehouseId: text(doc.target_warehouse_id),
    reason: text(doc.reason),
    notes: text(doc.notes),
    allowExpired: doc.allow_expired ?? false,
    lines: doc.lines.map((l) => ({
      itemId: l.item_id,
      item: itemOfLine(l),
      unitId: l.unit_id,
      unitCode: text(l.unit_code),
      factor: factorOf(l.quantity, l.base_quantity),
      quantity: l.quantity,
      unitCost: text(l.unit_cost),
      lotNo: text(l.lot_no),
      expiryDate: text(l.expiry_date),
      serials: l.serial_numbers.join('\n'),
      locationId: text(l.location_id),
      targetLocationId: text(l.target_location_id),
      direction: l.direction ?? 'in',
    })),
  }
}

export function isBlankLine(l: LineValues): boolean {
  return (
    l.itemId === '' &&
    l.quantity === '' &&
    l.unitCost === '' &&
    l.lotNo.trim() === '' &&
    l.serials.trim() === ''
  )
}

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())

/** Lot numbers apply to lot-tracked items and to items with an expiry date. */
export const usesLot = (item: ItemRef | null | undefined) =>
  item?.tracking === 'lot' || item?.has_expiry === true

/** The line takes stock in (receipts, openings, adjustments in). */
export const isInbound = (l: LineValues, rules: TypeRules) =>
  rules.lotRequired && !(rules.direction && l.direction === 'out')

export function toLineInput(l: LineValues, rules: TypeRules): StockLineInput {
  const tracking = l.item?.tracking ?? 'none'
  const outbound = rules.direction && l.direction === 'out'
  return {
    item_id: l.itemId,
    unit_id: l.unitId,
    quantity: l.quantity,
    // Outbound adjustments leave at the current cost.
    unit_cost: rules.cost && !outbound ? orNull(l.unitCost) : null,
    lot_no: usesLot(l.item) ? orNull(l.lotNo) : null,
    expiry_date: l.item?.has_expiry ? orNull(l.expiryDate) : null,
    serial_numbers: tracking === 'serial' ? parseSerials(l.serials) : [],
    location_id: orNull(l.locationId),
    target_location_id: rules.target ? orNull(l.targetLocationId) : null,
    ...(rules.direction ? { direction: l.direction } : {}),
    notes: null,
  }
}

export function toDocInput(v: DocValues): StockDocumentInput {
  const rules = typeRules(v.docType)
  return {
    doc_type: v.docType,
    document_date: v.documentDate,
    warehouse_id: v.warehouseId,
    target_warehouse_id: rules.target ? orNull(v.targetWarehouseId) : null,
    reason: orNull(v.reason),
    notes: orNull(v.notes),
    ...(rules.issues ? { allow_expired: v.allowExpired } : {}),
    lines: v.lines.filter((l) => !isBlankLine(l)).map((l) => toLineInput(l, rules)),
  }
}

/** Already translated texts of the line rules. */
export interface LineMessages {
  item: string
  unit: string
  quantity: string
  quantityPositive: string
  unitCost: string
  lot: string
  expiry: string
  serialCount: (count: number, quantity: string) => string
  serialInteger: string
  serialDuplicate: (serial: string) => string
}

export type LineField = keyof LineValues

/** Problems of one non-blank line; `otherSerials` are the serials of the same item elsewhere. */
export function lineProblems(
  l: LineValues,
  rules: TypeRules,
  m: LineMessages,
  otherSerials: ReadonlySet<string> = new Set(),
): [LineField, string][] {
  if (isBlankLine(l)) return []
  const out: [LineField, string][] = []
  if (!l.itemId) out.push(['itemId', m.item])
  if (!l.unitId && l.itemId) out.push(['unitId', m.unit])
  const q = l.quantity.trim()
  if (!isDecimal(q)) out.push(['quantity', m.quantity])
  else if (dec(q).lte(0)) out.push(['quantity', m.quantityPositive])
  const inbound = isInbound(l, rules)
  if (rules.costRequired || (rules.cost && inbound && l.unitCost !== '')) {
    if (!isDecimal(l.unitCost) || dec(l.unitCost).isNegative()) out.push(['unitCost', m.unitCost])
  }
  const item = l.item
  if (usesLot(item) && inbound && l.lotNo.trim() === '') out.push(['lotNo', m.lot])
  if (item?.has_expiry && inbound && l.expiryDate === '') out.push(['expiryDate', m.expiry])
  if (item?.tracking === 'serial' && isDecimal(q)) {
    const serials = parseSerials(l.serials)
    const base = baseQuantity(q, l.factor)
    if (base === null || !isInteger(base)) out.push(['quantity', m.serialInteger])
    else if (serials.length !== Number(new Decimal(base).toFixed(0)))
      out.push(['serials', m.serialCount(serials.length, new Decimal(base).toFixed(0))])
    else {
      const dup = duplicates(serials)[0] ?? serials.find((s) => otherSerials.has(s))
      if (dup !== undefined) out.push(['serials', m.serialDuplicate(dup)])
    }
  }
  return out
}

/** Serials of each line's item on the other lines (duplicates across lines are refused). */
export function serialsElsewhere(lines: readonly LineValues[], index: number): Set<string> {
  const target = lines[index]
  const out = new Set<string>()
  if (!target?.itemId) return out
  lines.forEach((l, i) => {
    if (i !== index && l.itemId === target.itemId)
      parseSerials(l.serials).forEach((s) => out.add(s))
  })
  return out
}

export interface DocTotals {
  lines: number
  /** Base quantity per base unit code (quantities of different units are never added). */
  quantities: { unit: string; quantity: string }[]
  /** Sum of rounded line costs; null when no line carries a cost. */
  cost: string | null
}

export function docTotals(lines: readonly LineValues[], rules: TypeRules): DocTotals {
  const filled = lines.filter((l) => !isBlankLine(l))
  const byUnit = new Map<string, Decimal>()
  let cost: Decimal | null = null
  for (const l of filled) {
    const base = baseQuantity(l.quantity, l.factor)
    if (base !== null && l.item) {
      const unit = l.item.base_unit?.code ?? ''
      byUnit.set(unit, (byUnit.get(unit) ?? new Decimal(0)).plus(base))
    }
    if (rules.cost && isInbound(l, rules)) {
      const c = lineCost(l.quantity, l.unitCost)
      if (c) cost = (cost ?? new Decimal(0)).plus(c)
    }
  }
  return {
    lines: filled.length,
    quantities: [...byUnit.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([unit, q]) => ({ unit, quantity: q.toString() })),
    cost: cost ? cost.toFixed(MONEY_SCALE) : null,
  }
}

/** Server field names ("lines.3.unit_cost") to form paths, accounting for dropped blank lines. */
export function serverFieldMapper(values: DocValues) {
  const kept = values.lines.flatMap((l, i) => (isBlankLine(l) ? [] : [i]))
  const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  const rename: Record<string, string> = { serialNumbers: 'serials' }
  return (field: string): string | null => {
    const parts = field.split('.')
    if (parts[0] === 'lines' && parts.length >= 2) {
      const index = kept[Number(parts[1])]
      if (index === undefined) return parts.length === 2 ? null : 'lines'
      const name = camel(parts[2] ?? '')
      return name ? `lines.${index}.${rename[name] ?? name}` : `lines.${index}`
    }
    return parts.map(camel).join('.')
  }
}
