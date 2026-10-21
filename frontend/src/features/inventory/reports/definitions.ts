// Inventory report definitions: API path, parameter form, columns and how rows are read from
// the response. Shapes follow PHASE4 "Reports (invrep)": GET /inventory-reports/<name> returns
// { data: { rows: [...], totals?: {...} } } with numbers as strings; the stock ledger (kartex)
// adds opening and closing balances. Exports live at `<path>/export?format=csv|xlsx`.
import type { PermissionRequirement } from '@/lib/permissions'
import type tr from '@/lib/i18n/locales/inventory-docs/tr.json'
import { addDays, toIsoDate } from '@/lib/datetime'
import { INV_OPEN } from '../documents/permissions'

export type ReportId = keyof (typeof tr)['report']
export type ParamLabel = keyof (typeof tr)['param']
export type ColLabel = keyof (typeof tr)['col']

export type ParamKind =
  'date' | 'warehouse' | 'category' | 'item' | 'number' | 'select' | 'checkbox'

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
  | 'date'
  | 'class'
  | 'movement'
  | 'document'

export interface ColDef {
  /** Field of the row; dotted for nested values ("buckets.d0_30.quantity"). */
  key: string
  label: ColLabel
  kind: ColKind
  /** Summed into the totals row when the API sends no totals for it. */
  total?: boolean
}

export type Row = Record<string, unknown>

export interface ReportData {
  rows?: Row[]
  totals?: Row | null
  opening?: Row | null
  closing?: Row | null
  [key: string]: unknown
}

export interface ReportDef {
  id: ReportId
  slug: string
  path: string
  permission: PermissionRequirement
  params: ParamDef[]
  columns: ColDef[]
  /** Kartex: devir row before and closing row after the movements. */
  ledger?: boolean
}

const today = () => toIsoDate(new Date())
const yearStart = () => `${today().slice(0, 4)}-01-01`
const minus = (days: number) => () => addDays(today(), -days)

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
    params: [
      { key: 'as_of', kind: 'date', label: 'asOf', required: true, initial: today },
      { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' },
      { key: 'category_id', kind: 'category', label: 'category' },
      { key: 'include_zero', kind: 'checkbox', label: 'includeZero' },
    ],
    columns: [
      ...ITEM,
      { key: 'unit_code', label: 'unit', kind: 'text' },
      { key: 'warehouse_code', label: 'warehouse', kind: 'text' },
      { key: 'on_hand', label: 'onHand', kind: 'qty' },
      { key: 'reserved', label: 'reserved', kind: 'qty' },
      { key: 'available', label: 'available', kind: 'qty' },
      { key: 'avg_cost', label: 'avgCost', kind: 'cost' },
      { key: 'value', label: 'value', kind: 'money', total: true },
    ],
  },
  {
    id: 'stockLedger',
    slug: 'stock-ledger',
    path: '/inventory-reports/stock-ledger',
    permission: INV_OPEN.reports,
    ledger: true,
    params: [
      { key: 'item_id', kind: 'item', label: 'item', required: true },
      { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' },
      { key: 'date_from', kind: 'date', label: 'dateFrom', required: true, initial: yearStart },
      { key: 'date_to', kind: 'date', label: 'dateTo', required: true, initial: today },
    ],
    columns: [
      { key: 'occurred_at', label: 'date', kind: 'date' },
      { key: 'document_number', label: 'document', kind: 'document' },
      { key: 'movement_type', label: 'movementType', kind: 'movement' },
      { key: 'warehouse_code', label: 'warehouse', kind: 'text' },
      { key: 'lot_no', label: 'lot', kind: 'code' },
      { key: 'in_quantity', label: 'in', kind: 'qty', total: true },
      { key: 'out_quantity', label: 'out', kind: 'qty', total: true },
      { key: 'unit_cost', label: 'unitCost', kind: 'cost' },
      { key: 'in_value', label: 'inValue', kind: 'money', total: true },
      { key: 'out_value', label: 'outValue', kind: 'money', total: true },
      { key: 'balance_quantity', label: 'balanceQuantity', kind: 'qty' },
      { key: 'balance_value', label: 'balanceValue', kind: 'money' },
    ],
  },
  {
    id: 'valuation',
    slug: 'valuation',
    path: '/inventory-reports/valuation',
    permission: INV_OPEN.reports,
    params: [
      { key: 'as_of', kind: 'date', label: 'asOf', required: true, initial: today },
      { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' },
      { key: 'category_id', kind: 'category', label: 'category' },
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
    ],
    columns: [
      ...ITEM,
      { key: 'unit_code', label: 'unit', kind: 'text' },
      { key: 'warehouse_code', label: 'warehouse', kind: 'text' },
      { key: 'quantity', label: 'quantity', kind: 'qty' },
      { key: 'avg_cost', label: 'avgCost', kind: 'cost' },
      { key: 'value', label: 'value', kind: 'money', total: true },
    ],
  },
  {
    id: 'ageing',
    slug: 'ageing',
    path: '/inventory-reports/ageing',
    permission: INV_OPEN.reports,
    params: [
      { key: 'as_of', kind: 'date', label: 'asOf', required: true, initial: today },
      { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' },
      { key: 'category_id', kind: 'category', label: 'category' },
    ],
    columns: [
      ...ITEM,
      { key: 'unit_code', label: 'unit', kind: 'text' },
      { key: 'buckets.d0_30.value', label: 'b0_30', kind: 'money', total: true },
      { key: 'buckets.d31_60.value', label: 'b31_60', kind: 'money', total: true },
      { key: 'buckets.d61_90.value', label: 'b61_90', kind: 'money', total: true },
      { key: 'buckets.d90_plus.value', label: 'b90', kind: 'money', total: true },
      { key: 'quantity', label: 'quantity', kind: 'qty' },
      { key: 'value', label: 'value', kind: 'money', total: true },
    ],
  },
  {
    id: 'expiringLots',
    slug: 'expiring-lots',
    path: '/inventory-reports/expiring-lots',
    permission: INV_OPEN.reports,
    params: [
      {
        key: 'days',
        kind: 'number',
        label: 'days',
        required: true,
        initial: () => '30',
        min: 1,
        max: 3650,
      },
      { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' },
      { key: 'include_expired', kind: 'checkbox', label: 'includeExpired' },
    ],
    columns: [
      ...ITEM,
      { key: 'lot_no', label: 'lot', kind: 'code' },
      { key: 'expiry_date', label: 'expiryDate', kind: 'date' },
      { key: 'days_left', label: 'daysLeft', kind: 'decimal' },
      { key: 'warehouse_code', label: 'warehouse', kind: 'text' },
      { key: 'quantity', label: 'quantity', kind: 'qty' },
      { key: 'value', label: 'value', kind: 'money', total: true },
    ],
  },
  {
    id: 'abc',
    slug: 'abc-analysis',
    path: '/inventory-reports/abc-analysis',
    permission: INV_OPEN.reports,
    params: [
      { key: 'date_from', kind: 'date', label: 'dateFrom', required: true, initial: minus(365) },
      { key: 'date_to', kind: 'date', label: 'dateTo', required: true, initial: today },
      { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' },
      {
        key: 'basis',
        kind: 'select',
        label: 'basis',
        initial: () => 'value',
        options: [
          { value: 'value', label: 'basisValue' },
          { value: 'quantity', label: 'basisQuantity' },
        ],
      },
      {
        key: 'a_threshold',
        kind: 'number',
        label: 'aThreshold',
        initial: () => '80',
        min: 1,
        max: 99,
      },
      {
        key: 'b_threshold',
        kind: 'number',
        label: 'bThreshold',
        initial: () => '95',
        min: 1,
        max: 99,
      },
    ],
    columns: [
      ...ITEM,
      { key: 'quantity', label: 'quantity', kind: 'qty' },
      { key: 'value', label: 'value', kind: 'money', total: true },
      { key: 'share', label: 'share', kind: 'percent' },
      { key: 'cumulative_share', label: 'cumulative', kind: 'percent' },
      { key: 'class', label: 'class', kind: 'class' },
    ],
  },
  {
    id: 'turnover',
    slug: 'turnover',
    path: '/inventory-reports/turnover',
    permission: INV_OPEN.reports,
    params: [
      { key: 'date_from', kind: 'date', label: 'dateFrom', required: true, initial: yearStart },
      { key: 'date_to', kind: 'date', label: 'dateTo', required: true, initial: today },
      { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' },
      { key: 'category_id', kind: 'category', label: 'category' },
    ],
    columns: [
      ...ITEM,
      { key: 'opening_value', label: 'openingValue', kind: 'money', total: true },
      { key: 'closing_value', label: 'closingValue', kind: 'money', total: true },
      { key: 'average_inventory', label: 'averageInventory', kind: 'money', total: true },
      { key: 'cogs', label: 'cogs', kind: 'money', total: true },
      { key: 'turnover_ratio', label: 'turnover', kind: 'decimal' },
      { key: 'days_on_hand', label: 'daysOnHand', kind: 'decimal' },
    ],
  },
  {
    id: 'reorder',
    slug: 'reorder-suggestions',
    path: '/reports/reorder-suggestions',
    permission: INV_OPEN.reorder,
    params: [
      { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' },
      { key: 'category_id', kind: 'category', label: 'category' },
    ],
    columns: [
      ...ITEM,
      { key: 'unit_code', label: 'unit', kind: 'text' },
      { key: 'warehouse_code', label: 'warehouse', kind: 'text' },
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
