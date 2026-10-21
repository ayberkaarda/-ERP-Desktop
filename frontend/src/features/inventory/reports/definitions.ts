// Inventory report definitions: API path, parameter form and columns. The stock reports live at
// GET /inventory-reports/<name> (inventory.reports.view) with plain query parameters
// (warehouse_id, category_id, item_id, q, page, per_page ≤ 500 plus the report's own) and answer
// `{data: rows of the page, meta: {as_of | date_from/date_to, group_by, basis, totals, pagination}}`
// with every number a decimal string. Each has an `/export?format=csv|xlsx` twin. Reorder
// suggestions (GET /reports/reorder-suggestions, inventory.stock.view) return a plain row list.
import type { PermissionRequirement } from '@/lib/permissions'
import type tr from '@/lib/i18n/locales/inventory-docs/tr.json'
import { toIsoDate } from '@/lib/datetime'
import { INV_OPEN } from '../documents/permissions'

export type ReportId = keyof (typeof tr)['report']
export type ParamLabel = keyof (typeof tr)['param']
export type ColLabel = keyof (typeof tr)['col']

export type ParamKind =
  'date' | 'warehouse' | 'category' | 'item' | 'number' | 'select' | 'checkbox' | 'text'

export interface ParamDef {
  key: string
  kind: ParamKind
  label: ParamLabel
  required?: boolean
  /** select: values with their label keys. */
  options?: { value: string; label: ParamLabel }[]
  /** Initial value of a fresh form (dates are computed when the page opens). */
  initial?: () => string
  min?: number
  max?: number
}

export type ColKind =
  | 'text'
  | 'code'
  | 'qty'
  | 'money'
  | 'cost'
  | 'percent'
  | 'decimal'
  | 'integer'
  | 'date'
  | 'class'
  | 'movement'
  | 'document'
  | 'unit'
  | 'days'

export type GroupBy = 'item_warehouse' | 'item' | 'warehouse' | 'category'

export interface ColDef {
  /** Field of the row. */
  key: string
  label: ColLabel
  kind: ColKind
  /** Shown in the totals row from meta.totals[key]. */
  total?: boolean
  /** Only for these groupings (identity columns of grouped reports). */
  groups?: GroupBy[]
}

export type Row = Record<string, unknown>

export interface ReportDef {
  id: ReportId
  slug: string
  path: string
  permission: PermissionRequirement
  params: ParamDef[]
  columns: ColDef[]
  /** Grouping when the report has no group_by parameter or it is empty. */
  groupDefault?: GroupBy
  /** Kartex: devir row before and closing row after the movements. */
  ledger?: boolean
  /** The API pages the rows (meta.pagination). */
  paged: boolean
  /** Has an /export twin. */
  exportable: boolean
}

const today = () => toIsoDate(new Date())
const yearStart = () => `${today().slice(0, 4)}-01-01`

const WAREHOUSE: ParamDef = { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' }
const CATEGORY: ParamDef = { key: 'category_id', kind: 'category', label: 'category' }
const SEARCH: ParamDef = { key: 'q', kind: 'text', label: 'search' }
const AS_OF: ParamDef = { key: 'as_of', kind: 'date', label: 'asOf', initial: today }
const FROM: ParamDef = { key: 'date_from', kind: 'date', label: 'dateFrom', initial: yearStart }
const TO: ParamDef = { key: 'date_to', kind: 'date', label: 'dateTo', initial: today }
const INCLUDE_ZERO: ParamDef = { key: 'include_zero', kind: 'checkbox', label: 'includeZero' }

const GROUP_OPTIONS: Record<GroupBy, ParamLabel> = {
  item_warehouse: 'groupItemWarehouse',
  item: 'groupItem',
  warehouse: 'groupWarehouse',
  category: 'groupCategory',
}

function groupBy(values: GroupBy[]): ParamDef {
  return {
    key: 'group_by',
    kind: 'select',
    label: 'groupBy',
    initial: () => values[0] ?? 'item_warehouse',
    options: values.map((v) => ({ value: v, label: GROUP_OPTIONS[v] })),
  }
}

const PER_ITEM: GroupBy[] = ['item_warehouse', 'item']
const PER_WAREHOUSE: GroupBy[] = ['item_warehouse', 'warehouse']
const AGGREGATE: GroupBy[] = ['warehouse', 'category']

/** Identity columns of grouped rows: fields outside the grouping are null. */
const IDENTITY: ColDef[] = [
  { key: 'item_code', label: 'itemCode', kind: 'code', groups: PER_ITEM },
  { key: 'item_name', label: 'itemName', kind: 'text', groups: PER_ITEM },
  { key: 'base_unit_id', label: 'unit', kind: 'unit', groups: PER_ITEM },
  { key: 'warehouse_code', label: 'warehouse', kind: 'code', groups: PER_WAREHOUSE },
  { key: 'warehouse_name', label: 'warehouseName', kind: 'text', groups: ['warehouse'] },
  { key: 'category_code', label: 'category', kind: 'code', groups: ['category'] },
  { key: 'category_name', label: 'categoryName', kind: 'text', groups: ['category'] },
  { key: 'item_count', label: 'itemCount', kind: 'integer', groups: AGGREGATE },
]

const ITEM: ColDef[] = [
  { key: 'item_code', label: 'itemCode', kind: 'code' },
  { key: 'item_name', label: 'itemName', kind: 'text' },
]

export const REPORTS: ReportDef[] = [
  {
    id: 'stockStatus',
    slug: 'stock-status',
    path: '/inventory-reports/stock-status',
    permission: INV_OPEN.reports,
    paged: true,
    exportable: true,
    params: [
      AS_OF,
      WAREHOUSE,
      CATEGORY,
      SEARCH,
      groupBy(['item_warehouse', 'item', 'warehouse', 'category']),
      INCLUDE_ZERO,
    ],
    columns: [
      ...IDENTITY,
      { key: 'quantity', label: 'quantity', kind: 'qty', groups: PER_ITEM },
      { key: 'avg_cost', label: 'avgCost', kind: 'cost', groups: PER_ITEM },
      { key: 'value', label: 'value', kind: 'money', total: true },
    ],
  },
  {
    id: 'stockLedger',
    slug: 'stock-ledger',
    path: '/inventory-reports/stock-ledger',
    permission: INV_OPEN.reports,
    paged: true,
    exportable: true,
    ledger: true,
    params: [{ key: 'item_id', kind: 'item', label: 'item', required: true }, WAREHOUSE, FROM, TO],
    columns: [
      { key: 'occurred_at', label: 'date', kind: 'date' },
      { key: 'document_number', label: 'document', kind: 'document' },
      { key: 'movement_type', label: 'movementType', kind: 'movement' },
      { key: 'warehouse_code', label: 'warehouse', kind: 'code' },
      { key: 'lot_no', label: 'lot', kind: 'code' },
      { key: 'serial_no', label: 'serial', kind: 'code' },
      { key: 'quantity_in', label: 'in', kind: 'qty', total: true },
      { key: 'quantity_out', label: 'out', kind: 'qty', total: true },
      { key: 'unit_cost', label: 'unitCost', kind: 'cost' },
      { key: 'value_in', label: 'inValue', kind: 'money', total: true },
      { key: 'value_out', label: 'outValue', kind: 'money', total: true },
      { key: 'balance_quantity', label: 'balanceQuantity', kind: 'qty' },
      { key: 'balance_value', label: 'balanceValue', kind: 'money' },
      { key: 'balance_avg_cost', label: 'balanceAvgCost', kind: 'cost' },
    ],
  },
  {
    id: 'valuation',
    slug: 'valuation',
    path: '/inventory-reports/valuation',
    permission: INV_OPEN.reports,
    paged: true,
    exportable: true,
    params: [
      AS_OF,
      WAREHOUSE,
      CATEGORY,
      SEARCH,
      {
        key: 'method',
        kind: 'select',
        label: 'method',
        options: [
          { value: '', label: 'methodDefault' },
          { value: 'moving_average', label: 'methodMovingAverage' },
          { value: 'fifo', label: 'methodFifo' },
        ],
      },
      groupBy(['item_warehouse', 'item', 'warehouse', 'category']),
      INCLUDE_ZERO,
    ],
    columns: [
      ...IDENTITY,
      { key: 'quantity', label: 'quantity', kind: 'qty', groups: PER_ITEM },
      { key: 'avg_cost', label: 'avgCost', kind: 'cost', groups: PER_ITEM },
      { key: 'value', label: 'value', kind: 'money', total: true },
    ],
  },
  {
    id: 'ageing',
    slug: 'ageing',
    path: '/inventory-reports/ageing',
    permission: INV_OPEN.reports,
    paged: true,
    exportable: true,
    params: [AS_OF, WAREHOUSE, CATEGORY, SEARCH, groupBy(['item_warehouse', 'item'])],
    columns: [
      ...IDENTITY,
      { key: 'quantity', label: 'quantity', kind: 'qty' },
      { key: 'value_0_30', label: 'b0_30', kind: 'money', total: true },
      { key: 'value_31_60', label: 'b31_60', kind: 'money', total: true },
      { key: 'value_61_90', label: 'b61_90', kind: 'money', total: true },
      { key: 'value_over_90', label: 'b90', kind: 'money', total: true },
      { key: 'value', label: 'value', kind: 'money', total: true },
    ],
  },
  {
    id: 'expiringLots',
    slug: 'expiring-lots',
    path: '/inventory-reports/expiring-lots',
    permission: INV_OPEN.reports,
    paged: true,
    exportable: true,
    params: [
      { key: 'days', kind: 'number', label: 'days', initial: () => '30', min: 0, max: 3650 },
      WAREHOUSE,
      CATEGORY,
      SEARCH,
      { key: 'include_expired', kind: 'checkbox', label: 'includeExpired', initial: () => '1' },
    ],
    columns: [
      ...ITEM,
      { key: 'lot_no', label: 'lot', kind: 'code' },
      { key: 'expiry_date', label: 'expiryDate', kind: 'date' },
      { key: 'days_to_expiry', label: 'daysToExpiry', kind: 'days' },
      { key: 'warehouse_code', label: 'warehouse', kind: 'code' },
      { key: 'base_unit_id', label: 'unit', kind: 'unit' },
      { key: 'on_hand', label: 'onHand', kind: 'qty' },
      { key: 'reserved', label: 'reserved', kind: 'qty' },
      { key: 'available', label: 'available', kind: 'qty' },
      { key: 'value', label: 'value', kind: 'money', total: true },
    ],
  },
  {
    id: 'abc',
    slug: 'abc-analysis',
    path: '/inventory-reports/abc-analysis',
    permission: INV_OPEN.reports,
    paged: true,
    exportable: true,
    params: [
      FROM,
      TO,
      WAREHOUSE,
      CATEGORY,
      SEARCH,
      {
        key: 'basis',
        kind: 'select',
        label: 'basis',
        initial: () => 'consumption',
        options: [
          { value: 'consumption', label: 'basisConsumption' },
          { value: 'stock_value', label: 'basisStockValue' },
        ],
      },
      { key: 'a', kind: 'number', label: 'aThreshold', initial: () => '80', min: 1, max: 100 },
      { key: 'b', kind: 'number', label: 'bThreshold', initial: () => '95', min: 1, max: 100 },
    ],
    columns: [
      { key: 'rank', label: 'rank', kind: 'integer' },
      { key: 'class', label: 'class', kind: 'class' },
      ...ITEM,
      { key: 'base_unit_id', label: 'unit', kind: 'unit' },
      { key: 'quantity', label: 'quantity', kind: 'qty' },
      { key: 'value', label: 'value', kind: 'money', total: true },
      { key: 'share', label: 'share', kind: 'percent' },
      { key: 'cumulative_share', label: 'cumulative', kind: 'percent' },
    ],
  },
  {
    id: 'turnover',
    slug: 'turnover',
    path: '/inventory-reports/turnover',
    permission: INV_OPEN.reports,
    paged: true,
    exportable: true,
    groupDefault: 'item',
    params: [
      FROM,
      TO,
      WAREHOUSE,
      CATEGORY,
      SEARCH,
      groupBy(['item', 'item_warehouse', 'warehouse', 'category']),
    ],
    columns: [
      ...IDENTITY,
      { key: 'opening_value', label: 'openingValue', kind: 'money', total: true },
      { key: 'closing_value', label: 'closingValue', kind: 'money', total: true },
      { key: 'consumed_value', label: 'consumedValue', kind: 'money', total: true },
      // Half of two 4-decimal amounts: exact at 5 decimals, shown unrounded.
      { key: 'average_value', label: 'averageValue', kind: 'cost', total: true },
      { key: 'turnover', label: 'turnover', kind: 'decimal', total: true },
      { key: 'days_on_hand', label: 'daysOnHand', kind: 'decimal', total: true },
    ],
  },
  {
    id: 'movementSummary',
    slug: 'movement-summary',
    path: '/inventory-reports/movement-summary',
    permission: INV_OPEN.reports,
    paged: true,
    exportable: true,
    params: [
      FROM,
      TO,
      WAREHOUSE,
      CATEGORY,
      SEARCH,
      groupBy(['item_warehouse', 'item', 'warehouse', 'category']),
      INCLUDE_ZERO,
    ],
    columns: [
      ...IDENTITY,
      { key: 'opening_quantity', label: 'openingQuantity', kind: 'qty', groups: PER_ITEM },
      { key: 'opening_value', label: 'openingValue', kind: 'money', total: true },
      { key: 'in_quantity', label: 'in', kind: 'qty', groups: PER_ITEM },
      { key: 'in_value', label: 'inValue', kind: 'money', total: true },
      { key: 'out_quantity', label: 'out', kind: 'qty', groups: PER_ITEM },
      { key: 'out_value', label: 'outValue', kind: 'money', total: true },
      { key: 'closing_quantity', label: 'closingQuantity', kind: 'qty', groups: PER_ITEM },
      { key: 'closing_value', label: 'closingValue', kind: 'money', total: true },
    ],
  },
  {
    id: 'reorder',
    slug: 'reorder-suggestions',
    path: '/reports/reorder-suggestions',
    permission: INV_OPEN.reorder,
    paged: false,
    exportable: false,
    params: [SEARCH],
    columns: [
      ...ITEM,
      { key: 'base_unit_id', label: 'unit', kind: 'unit' },
      { key: 'on_hand', label: 'onHand', kind: 'qty' },
      { key: 'reserved', label: 'reserved', kind: 'qty' },
      { key: 'available', label: 'available', kind: 'qty' },
      { key: 'min_stock', label: 'minStock', kind: 'qty' },
      { key: 'reorder_point', label: 'reorderPoint', kind: 'qty' },
      { key: 'suggested_quantity', label: 'suggested', kind: 'qty' },
    ],
  },
]

export const REPORTS_BASE = '/inventory/reports'

export function reportBySlug(slug: string | undefined): ReportDef | undefined {
  return REPORTS.find((r) => r.slug === slug)
}

/** Columns of the report for the applied grouping. */
export function visibleColumns(def: ReportDef, group: string | undefined): ColDef[] {
  const current = (
    group !== undefined && group !== '' ? group : (def.groupDefault ?? 'item_warehouse')
  ) as GroupBy
  return def.columns.filter((c) => !c.groups || c.groups.includes(current))
}
