// Sales report definitions: API path, parameter form, columns and chart. Reports live at
// GET /sales-reports/<name> (sales.reports.view) with plain query parameters and answer
// `{data: rows, meta: {totals?, pagination?, as_of | date_from/date_to, currency}}` with every
// number a decimal string. Each has an `/export?format=csv|xlsx` twin (same parameters).
import { toIsoDate } from '@/lib/datetime'
import type { PermissionRequirement } from '@/lib/permissions'
import { SALES_OPEN } from '../invoices/kit/permissions'

export const REPORT_IDS = [
  'salesByPeriod',
  'byCustomer',
  'byItem',
  'byCategory',
  'openOrders',
  'deliveryVsInvoice',
  'customerAgeing',
  'margin',
  'topCustomers',
  'returnRate',
  'quoteConversion',
] as const
export type ReportId = (typeof REPORT_IDS)[number]

export type ParamLabel =
  | 'dateFrom'
  | 'dateTo'
  | 'asOf'
  | 'customer'
  | 'item'
  | 'category'
  | 'period'
  | 'periodDay'
  | 'periodWeek'
  | 'periodMonth'
  | 'periodQuarter'
  | 'periodYear'
  | 'groupBy'
  | 'groupItem'
  | 'groupCustomer'
  | 'groupCategory'
  | 'limit'
  | 'currency'
  | 'localCurrency'
  | 'documentCurrency'

export type ParamKind = 'date' | 'party' | 'item' | 'category' | 'select' | 'number'

export interface ParamDef {
  key: string
  kind: ParamKind
  label: ParamLabel
  required?: boolean
  options?: { value: string; label: ParamLabel }[]
  initial?: () => string
  min?: number
  max?: number
}

export type ColLabel =
  | 'period'
  | 'code'
  | 'name'
  | 'customer'
  | 'item'
  | 'category'
  | 'unit'
  | 'invoiceCount'
  | 'quantity'
  | 'netAmount'
  | 'taxAmount'
  | 'total'
  | 'returns'
  | 'netSales'
  | 'grossSales'
  | 'share'
  | 'averagePrice'
  | 'order'
  | 'orderDate'
  | 'requestedDate'
  | 'ordered'
  | 'delivered'
  | 'open'
  | 'openAmount'
  | 'delivery'
  | 'deliveryDate'
  | 'invoiced'
  | 'uninvoiced'
  | 'uninvoicedAmount'
  | 'notDue'
  | 'd0_30'
  | 'd31_60'
  | 'd61_90'
  | 'd90Plus'
  | 'revenue'
  | 'cogs'
  | 'margin'
  | 'marginPercent'
  | 'rank'
  | 'sold'
  | 'returned'
  | 'returnRate'
  | 'returnedAmount'
  | 'quotes'
  | 'converted'
  | 'conversionRate'
  | 'quotedAmount'
  | 'convertedAmount'

export type ColKind =
  'text' | 'code' | 'qty' | 'money' | 'percent' | 'integer' | 'date' | 'document'

export interface ColDef {
  key: string
  label: ColLabel
  kind: ColKind
  /** Shown in the totals row from meta.totals[key] (else summed on the page). */
  total?: boolean
  /** document: route prefix of the linked document (id in `<key>_id` or `document_id`). */
  link?: 'order' | 'delivery' | 'invoice'
}

export type Row = Record<string, unknown>

/** column: one bar per row in order (periods); bar: top rows by value; stacked: buckets of totals. */
export interface ChartDef {
  kind: 'column' | 'bar' | 'stacked'
  /** Row field naming the bar. */
  label: string
  /** Value field(s); stacked uses several from meta.totals. */
  values: string[]
  /** Values are percentages (axis shows %). */
  percent?: boolean
  top?: number
}

export interface ReportDef {
  id: ReportId
  slug: string
  path: string
  permission: PermissionRequirement
  params: ParamDef[]
  columns: ColDef[]
  chart?: ChartDef
  /** The API pages the rows (meta.pagination). */
  paged: boolean
}

const today = () => toIsoDate(new Date())
const monthStart = () => `${today().slice(0, 8)}01`
const yearStart = () => `${today().slice(0, 4)}-01-01`

const FROM: ParamDef = {
  key: 'date_from',
  kind: 'date',
  label: 'dateFrom',
  required: true,
  initial: yearStart,
}
const FROM_MONTH: ParamDef = { ...FROM, initial: monthStart }
const TO: ParamDef = {
  key: 'date_to',
  kind: 'date',
  label: 'dateTo',
  required: true,
  initial: today,
}
const AS_OF: ParamDef = {
  key: 'as_of',
  kind: 'date',
  label: 'asOf',
  required: true,
  initial: today,
}
const PARTY: ParamDef = { key: 'party_id', kind: 'party', label: 'customer' }
const ITEM: ParamDef = { key: 'item_id', kind: 'item', label: 'item' }
const CATEGORY: ParamDef = { key: 'category_id', kind: 'category', label: 'category' }
const PERIOD: ParamDef = {
  key: 'period',
  kind: 'select',
  label: 'period',
  initial: () => 'month',
  options: [
    { value: 'day', label: 'periodDay' },
    { value: 'week', label: 'periodWeek' },
    { value: 'month', label: 'periodMonth' },
    { value: 'quarter', label: 'periodQuarter' },
    { value: 'year', label: 'periodYear' },
  ],
}
const GROUP: ParamDef = {
  key: 'group_by',
  kind: 'select',
  label: 'groupBy',
  initial: () => 'item',
  options: [
    { value: 'item', label: 'groupItem' },
    { value: 'customer', label: 'groupCustomer' },
    { value: 'category', label: 'groupCategory' },
  ],
}

const CODE: ColDef = { key: 'code', label: 'code', kind: 'code' }
const NAME: ColDef = { key: 'name', label: 'name', kind: 'text' }
const NET: ColDef = { key: 'net_amount', label: 'netAmount', kind: 'money', total: true }
const SHARE: ColDef = { key: 'share', label: 'share', kind: 'percent' }
const OPEN = SALES_OPEN.reports

export const REPORTS: ReportDef[] = [
  {
    id: 'salesByPeriod',
    slug: 'sales-by-period',
    path: '/sales-reports/sales-by-period',
    permission: OPEN,
    params: [FROM, TO, PERIOD, PARTY, ITEM, CATEGORY],
    columns: [
      { key: 'period', label: 'period', kind: 'text' },
      { key: 'invoice_count', label: 'invoiceCount', kind: 'integer', total: true },
      { key: 'gross_amount', label: 'grossSales', kind: 'money', total: true },
      { key: 'returns_amount', label: 'returns', kind: 'money', total: true },
      { key: 'net_amount', label: 'netSales', kind: 'money', total: true },
      { key: 'tax_amount', label: 'taxAmount', kind: 'money', total: true },
      { key: 'total', label: 'total', kind: 'money', total: true },
    ],
    chart: { kind: 'column', label: 'period', values: ['net_amount'] },
    paged: false,
  },
  {
    id: 'byCustomer',
    slug: 'by-customer',
    path: '/sales-reports/by-customer',
    permission: OPEN,
    params: [FROM, TO, ITEM, CATEGORY],
    columns: [
      CODE,
      NAME,
      { key: 'invoice_count', label: 'invoiceCount', kind: 'integer', total: true },
      NET,
      { key: 'tax_amount', label: 'taxAmount', kind: 'money', total: true },
      { key: 'total', label: 'total', kind: 'money', total: true },
      SHARE,
    ],
    chart: { kind: 'bar', label: 'name', values: ['net_amount'], top: 10 },
    paged: true,
  },
  {
    id: 'byItem',
    slug: 'by-item',
    path: '/sales-reports/by-item',
    permission: OPEN,
    params: [FROM, TO, PARTY, CATEGORY],
    columns: [
      CODE,
      NAME,
      { key: 'unit_code', label: 'unit', kind: 'code' },
      { key: 'quantity', label: 'quantity', kind: 'qty' },
      { key: 'average_price', label: 'averagePrice', kind: 'money' },
      NET,
      SHARE,
    ],
    chart: { kind: 'bar', label: 'name', values: ['net_amount'], top: 10 },
    paged: true,
  },
  {
    id: 'byCategory',
    slug: 'by-category',
    path: '/sales-reports/by-category',
    permission: OPEN,
    params: [FROM, TO, PARTY],
    columns: [CODE, NAME, { key: 'quantity', label: 'quantity', kind: 'qty' }, NET, SHARE],
    chart: { kind: 'bar', label: 'name', values: ['net_amount'], top: 10 },
    paged: false,
  },
  {
    id: 'openOrders',
    slug: 'open-orders',
    path: '/sales-reports/open-orders',
    permission: OPEN,
    params: [AS_OF, PARTY, ITEM],
    columns: [
      { key: 'order_number', label: 'order', kind: 'document', link: 'order' },
      { key: 'order_date', label: 'orderDate', kind: 'date' },
      { key: 'requested_delivery_date', label: 'requestedDate', kind: 'date' },
      { key: 'party_name', label: 'customer', kind: 'text' },
      { key: 'item_code', label: 'code', kind: 'code' },
      { key: 'item_name', label: 'item', kind: 'text' },
      { key: 'ordered_quantity', label: 'ordered', kind: 'qty' },
      { key: 'delivered_quantity', label: 'delivered', kind: 'qty' },
      { key: 'open_quantity', label: 'open', kind: 'qty' },
      { key: 'open_amount', label: 'openAmount', kind: 'money', total: true },
    ],
    paged: true,
  },
  {
    id: 'deliveryVsInvoice',
    slug: 'delivery-vs-invoice',
    path: '/sales-reports/delivery-vs-invoice',
    permission: OPEN,
    params: [FROM_MONTH, TO, PARTY],
    columns: [
      { key: 'delivery_number', label: 'delivery', kind: 'document', link: 'delivery' },
      { key: 'delivery_date', label: 'deliveryDate', kind: 'date' },
      { key: 'party_name', label: 'customer', kind: 'text' },
      { key: 'item_code', label: 'code', kind: 'code' },
      { key: 'item_name', label: 'item', kind: 'text' },
      { key: 'delivered_quantity', label: 'delivered', kind: 'qty' },
      { key: 'invoiced_quantity', label: 'invoiced', kind: 'qty' },
      { key: 'uninvoiced_quantity', label: 'uninvoiced', kind: 'qty' },
      { key: 'uninvoiced_amount', label: 'uninvoicedAmount', kind: 'money', total: true },
    ],
    paged: true,
  },
  {
    id: 'customerAgeing',
    slug: 'customer-ageing',
    path: '/sales-reports/customer-ageing',
    permission: OPEN,
    params: [AS_OF, PARTY],
    columns: [
      CODE,
      NAME,
      { key: 'not_due', label: 'notDue', kind: 'money', total: true },
      { key: 'd0_30', label: 'd0_30', kind: 'money', total: true },
      { key: 'd31_60', label: 'd31_60', kind: 'money', total: true },
      { key: 'd61_90', label: 'd61_90', kind: 'money', total: true },
      { key: 'd90_plus', label: 'd90Plus', kind: 'money', total: true },
      { key: 'total', label: 'total', kind: 'money', total: true },
    ],
    chart: {
      kind: 'stacked',
      label: 'name',
      values: ['not_due', 'd0_30', 'd31_60', 'd61_90', 'd90_plus'],
    },
    paged: true,
  },
  {
    id: 'margin',
    slug: 'margin',
    path: '/sales-reports/margin',
    permission: OPEN,
    params: [FROM, TO, GROUP, PARTY, CATEGORY],
    columns: [
      CODE,
      NAME,
      { key: 'quantity', label: 'quantity', kind: 'qty' },
      { key: 'revenue', label: 'revenue', kind: 'money', total: true },
      { key: 'cogs', label: 'cogs', kind: 'money', total: true },
      { key: 'margin', label: 'margin', kind: 'money', total: true },
      { key: 'margin_percent', label: 'marginPercent', kind: 'percent', total: true },
    ],
    chart: { kind: 'bar', label: 'name', values: ['margin'], top: 10 },
    paged: true,
  },
  {
    id: 'topCustomers',
    slug: 'top-customers',
    path: '/sales-reports/top-customers',
    permission: OPEN,
    params: [
      FROM,
      TO,
      { key: 'limit', kind: 'number', label: 'limit', initial: () => '10', min: 1, max: 100 },
    ],
    columns: [
      { key: 'rank', label: 'rank', kind: 'integer' },
      CODE,
      NAME,
      { key: 'invoice_count', label: 'invoiceCount', kind: 'integer' },
      NET,
      SHARE,
    ],
    chart: { kind: 'bar', label: 'name', values: ['net_amount'], top: 10 },
    paged: false,
  },
  {
    id: 'returnRate',
    slug: 'return-rate',
    path: '/sales-reports/return-rate',
    permission: OPEN,
    params: [FROM, TO, { ...GROUP, options: GROUP.options?.slice(0, 2) }, PARTY],
    columns: [
      CODE,
      NAME,
      { key: 'sold_quantity', label: 'sold', kind: 'qty' },
      { key: 'returned_quantity', label: 'returned', kind: 'qty' },
      { key: 'return_rate', label: 'returnRate', kind: 'percent', total: true },
      { key: 'returned_amount', label: 'returnedAmount', kind: 'money', total: true },
    ],
    chart: { kind: 'bar', label: 'name', values: ['return_rate'], percent: true, top: 10 },
    paged: true,
  },
  {
    id: 'quoteConversion',
    slug: 'quote-conversion',
    path: '/sales-reports/quote-conversion',
    permission: OPEN,
    params: [FROM, TO, PERIOD, PARTY],
    columns: [
      { key: 'period', label: 'period', kind: 'text' },
      { key: 'quote_count', label: 'quotes', kind: 'integer', total: true },
      { key: 'converted_count', label: 'converted', kind: 'integer', total: true },
      { key: 'conversion_rate', label: 'conversionRate', kind: 'percent', total: true },
      { key: 'quoted_amount', label: 'quotedAmount', kind: 'money', total: true },
      { key: 'converted_amount', label: 'convertedAmount', kind: 'money', total: true },
    ],
    chart: { kind: 'column', label: 'period', values: ['conversion_rate'], percent: true },
    paged: false,
  },
]

export const reportBySlug = (slug: string | undefined) => REPORTS.find((r) => r.slug === slug)
