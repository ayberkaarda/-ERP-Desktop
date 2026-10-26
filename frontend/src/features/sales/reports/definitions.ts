// Sales report definitions: API path, parameter form, columns and chart. Reports live at
// GET /sales-reports/<name> (sales.reports.view) with plain query parameters, all optional (range
// reports default to Jan 1 of date_to's year .. today, as_of to today), and answer
// `{data: rows of the page, meta: {report, currency, filters, totals, by_currency?, pagination}}`
// with money at scale 4, quantities at scale 6, percentages at scale 2 (null when the base is 0) and
// counts as integers. Each has an `/export?format=csv|xlsx` twin with the same parameters. Reports
// with `group_by` change their columns with it; the others refuse the parameter (422).
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

export type GroupValue =
  | 'item'
  | 'customer'
  | 'category'
  | 'warehouse'
  | 'month'
  | 'none'
  | 'line'
  | 'order'
  | 'delivery'
  | 'invoice'
  | 'customer_currency'

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
  | 'groupBy'
  | 'limit'
  | `group.${GroupValue}`

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

/** Column label keys (`col.<label>` in the sales-reports namespace). */
export type ColLabel =
  | 'period'
  | 'partyCode'
  | 'partyName'
  | 'itemCode'
  | 'itemName'
  | 'category'
  | 'warehouse'
  | 'invoiceCount'
  | 'creditNoteCount'
  | 'salesAmount'
  | 'returnsAmount'
  | 'netAmount'
  | 'taxAmount'
  | 'totalAmount'
  | 'share'
  | 'cumulativeShare'
  | 'rank'
  | 'itemCount'
  | 'soldQuantity'
  | 'returnedQuantity'
  | 'netQuantity'
  | 'averagePrice'
  | 'invoicedQuantity'
  | 'deliveredQuantity'
  | 'revenue'
  | 'cogs'
  | 'grossMargin'
  | 'marginPercent'
  | 'quantityRate'
  | 'valueRate'
  | 'quoteCount'
  | 'openCount'
  | 'acceptedCount'
  | 'convertedCount'
  | 'rejectedCount'
  | 'expiredCount'
  | 'cancelledCount'
  | 'quotedValue'
  | 'convertedValue'
  | 'conversionRate'
  | 'valueConversionRate'
  | 'averageDays'
  | 'order'
  | 'documentDate'
  | 'requestedDate'
  | 'daysLate'
  | 'quantity'
  | 'openQuantity'
  | 'openBaseQuantity'
  | 'currency'
  | 'openValue'
  | 'openValueLocal'
  | 'lineCount'
  | 'orderCount'
  | 'delivery'
  | 'daysOpen'
  | 'uninvoicedQuantity'
  | 'inDraftQuantity'
  | 'uninvoicedBaseQuantity'
  | 'uninvoicedValue'
  | 'uninvoicedValueLocal'
  | 'uninvoicedCost'
  | 'deliveryCount'
  | 'invoice'
  | 'dueDate'
  | 'daysOverdue'
  | 'bucket'
  | 'total'
  | 'settledAmount'
  | 'balance'
  | 'balanceLocal'
  | 'notDue'
  | 'days0to30'
  | 'days31to60'
  | 'days61to90'
  | 'daysOver90'
  | 'overdue'
  | 'oldestDueDate'

export type ColKind =
  'text' | 'code' | 'qty' | 'money' | 'percent' | 'integer' | 'date' | 'document' | 'bucket'

export interface ColDef {
  key: string
  label: ColLabel
  kind: ColKind
  /** Shown in the totals row from meta.totals[key]. */
  total?: boolean
  /** document: route prefix of the linked document and the row field holding its id. */
  link?: 'order' | 'delivery' | 'invoice'
  idKey?: string
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

/** Columns and chart of a report, or of one of its group_by choices. */
export interface ReportView {
  columns: ColDef[]
  chart?: ChartDef
}

export interface ReportDef extends ReportView {
  id: ReportId
  slug: string
  path: string
  permission: PermissionRequirement
  params: ParamDef[]
  /** Per group_by value (the default view is the report's own columns/chart). */
  views?: Partial<Record<GroupValue, ReportView>>
}

const today = () => toIsoDate(new Date())
const yearStart = () => `${today().slice(0, 4)}-01-01`

const FROM: ParamDef = { key: 'date_from', kind: 'date', label: 'dateFrom', initial: yearStart }
const TO: ParamDef = { key: 'date_to', kind: 'date', label: 'dateTo', initial: today }
/** Optional date filter (open orders: order date, delivery-vs-invoice: delivery date). */
const FROM_OPT: ParamDef = { key: 'date_from', kind: 'date', label: 'dateFrom' }
const TO_OPT: ParamDef = { key: 'date_to', kind: 'date', label: 'dateTo' }
const AS_OF: ParamDef = { key: 'as_of', kind: 'date', label: 'asOf', initial: today }
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
  ],
}

function group(values: GroupValue[]): ParamDef {
  return {
    key: 'group_by',
    kind: 'select',
    label: 'groupBy',
    initial: () => values[0] ?? '',
    options: values.map((v) => ({ value: v, label: `group.${v}` as const })),
  }
}

const money = (key: string, label: ColLabel, total = true): ColDef => ({
  key,
  label,
  kind: 'money',
  total,
})
const count = (key: string, label: ColLabel, total = true): ColDef => ({
  key,
  label,
  kind: 'integer',
  total,
})
const qtyCol = (key: string, label: ColLabel): ColDef => ({ key, label, kind: 'qty' })
const pct = (key: string, label: ColLabel, total = false): ColDef => ({
  key,
  label,
  kind: 'percent',
  total,
})
const date = (key: string, label: ColLabel): ColDef => ({ key, label, kind: 'date' })

const PERIOD_COL: ColDef = { key: 'period', label: 'period', kind: 'text' }
const PARTY_COLS: ColDef[] = [
  { key: 'party_code', label: 'partyCode', kind: 'code' },
  { key: 'party_name', label: 'partyName', kind: 'text' },
]
const PARTY_NAME: ColDef = { key: 'party_name', label: 'partyName', kind: 'text' }
const ITEM_COLS: ColDef[] = [
  { key: 'item_code', label: 'itemCode', kind: 'code' },
  { key: 'item_name', label: 'itemName', kind: 'text' },
]
/** category_id resolved to "CODE · Name" on the page (`category_label`). */
const CATEGORY_COL: ColDef = { key: 'category_label', label: 'category', kind: 'text' }
const WAREHOUSE_COL: ColDef = { key: 'warehouse_label', label: 'warehouse', kind: 'text' }
const CURRENCY_COL: ColDef = { key: 'currency_code', label: 'currency', kind: 'code' }
const ORDER_COL: ColDef = {
  key: 'order_number',
  label: 'order',
  kind: 'document',
  link: 'order',
  idKey: 'order_id',
}
const DELIVERY_COL: ColDef = {
  key: 'delivery_number',
  label: 'delivery',
  kind: 'document',
  link: 'delivery',
  idKey: 'delivery_id',
}

const AMOUNTS: ColDef[] = [
  count('invoice_count', 'invoiceCount'),
  count('credit_note_count', 'creditNoteCount'),
  money('sales_amount', 'salesAmount'),
  money('returns_amount', 'returnsAmount'),
  money('net_amount', 'netAmount'),
  money('tax_amount', 'taxAmount'),
  money('total_amount', 'totalAmount'),
]
const SHARE = pct('share_percent', 'share')

const MARGIN: ColDef[] = [
  money('revenue', 'revenue'),
  money('cogs', 'cogs'),
  money('gross_margin', 'grossMargin'),
  pct('margin_percent', 'marginPercent', true),
]
const marginChart = (label: string): ChartDef => ({
  kind: 'bar',
  label,
  values: ['gross_margin'],
  top: 10,
})

const RETURNS: ColDef[] = [
  count('invoice_count', 'invoiceCount', false),
  count('credit_note_count', 'creditNoteCount', false),
  money('sales_amount', 'salesAmount'),
  money('returns_amount', 'returnsAmount'),
  pct('value_rate_percent', 'valueRate', true),
]
const returnChart = (label: string): ChartDef => ({
  kind: 'bar',
  label,
  values: ['value_rate_percent'],
  percent: true,
  top: 10,
})

const QUOTES: ColDef[] = [
  count('quote_count', 'quoteCount'),
  count('open_count', 'openCount'),
  count('accepted_count', 'acceptedCount'),
  count('converted_count', 'convertedCount'),
  count('rejected_count', 'rejectedCount'),
  count('expired_count', 'expiredCount'),
  count('cancelled_count', 'cancelledCount'),
  money('quoted_value', 'quotedValue'),
  money('converted_value', 'convertedValue'),
  pct('conversion_rate_percent', 'conversionRate', true),
  pct('value_conversion_rate_percent', 'valueConversionRate', true),
  count('average_days_to_convert', 'averageDays'),
]

const BUCKETS: ColDef[] = [
  money('not_due', 'notDue'),
  money('days_0_30', 'days0to30'),
  money('days_31_60', 'days31to60'),
  money('days_61_90', 'days61to90'),
  money('days_over_90', 'daysOver90'),
  money('overdue', 'overdue'),
]
const AGEING_CHART: ChartDef = {
  kind: 'stacked',
  label: 'party_name',
  values: ['not_due', 'days_0_30', 'days_31_60', 'days_61_90', 'days_over_90'],
}

const OPEN = SALES_OPEN.reports

export const REPORTS: ReportDef[] = [
  {
    id: 'salesByPeriod',
    slug: 'sales-by-period',
    path: '/sales-reports/sales-by-period',
    permission: OPEN,
    params: [FROM, TO, PERIOD, PARTY, ITEM, CATEGORY],
    columns: [PERIOD_COL, ...AMOUNTS],
    chart: { kind: 'column', label: 'period', values: ['net_amount'] },
  },
  {
    id: 'byCustomer',
    slug: 'by-customer',
    path: '/sales-reports/by-customer',
    permission: OPEN,
    params: [FROM, TO, PARTY, ITEM, CATEGORY],
    columns: [...PARTY_COLS, ...AMOUNTS, SHARE],
    chart: { kind: 'bar', label: 'party_name', values: ['net_amount'], top: 10 },
  },
  {
    id: 'byItem',
    slug: 'by-item',
    path: '/sales-reports/by-item',
    permission: OPEN,
    params: [FROM, TO, PARTY, ITEM, CATEGORY],
    columns: [
      ...ITEM_COLS,
      CATEGORY_COL,
      qtyCol('sold_quantity', 'soldQuantity'),
      qtyCol('returned_quantity', 'returnedQuantity'),
      qtyCol('net_quantity', 'netQuantity'),
      money('average_price', 'averagePrice', false),
      money('sales_amount', 'salesAmount'),
      money('returns_amount', 'returnsAmount'),
      money('net_amount', 'netAmount'),
      SHARE,
    ],
    chart: { kind: 'bar', label: 'item_name', values: ['net_amount'], top: 10 },
  },
  {
    id: 'byCategory',
    slug: 'by-category',
    path: '/sales-reports/by-category',
    permission: OPEN,
    params: [FROM, TO, PARTY, CATEGORY],
    columns: [CATEGORY_COL, count('item_count', 'itemCount', false), ...AMOUNTS, SHARE],
    chart: { kind: 'bar', label: 'category_label', values: ['net_amount'], top: 10 },
  },
  {
    id: 'openOrders',
    slug: 'open-orders',
    path: '/sales-reports/open-orders',
    permission: OPEN,
    params: [group(['line', 'order', 'customer', 'item']), FROM_OPT, TO_OPT, PARTY, ITEM, CATEGORY],
    columns: [
      ORDER_COL,
      date('document_date', 'documentDate'),
      date('requested_delivery_date', 'requestedDate'),
      count('days_late', 'daysLate', false),
      PARTY_NAME,
      ...ITEM_COLS,
      qtyCol('quantity', 'quantity'),
      qtyCol('delivered_quantity', 'deliveredQuantity'),
      qtyCol('invoiced_quantity', 'invoicedQuantity'),
      qtyCol('open_quantity', 'openQuantity'),
      CURRENCY_COL,
      money('open_value', 'openValue', false),
      money('open_value_local', 'openValueLocal'),
    ],
    views: {
      order: {
        columns: [
          ORDER_COL,
          date('document_date', 'documentDate'),
          date('requested_delivery_date', 'requestedDate'),
          count('days_late', 'daysLate', false),
          PARTY_NAME,
          CURRENCY_COL,
          count('line_count', 'lineCount'),
          money('open_value', 'openValue', false),
          money('open_value_local', 'openValueLocal'),
        ],
      },
      customer: {
        columns: [
          ...PARTY_COLS,
          count('order_count', 'orderCount'),
          count('line_count', 'lineCount'),
          money('open_value_local', 'openValueLocal'),
        ],
        chart: { kind: 'bar', label: 'party_name', values: ['open_value_local'], top: 10 },
      },
      item: {
        columns: [
          ...ITEM_COLS,
          count('order_count', 'orderCount', false),
          qtyCol('open_base_quantity', 'openBaseQuantity'),
          money('open_value_local', 'openValueLocal'),
        ],
        chart: { kind: 'bar', label: 'item_name', values: ['open_value_local'], top: 10 },
      },
    },
  },
  {
    id: 'deliveryVsInvoice',
    slug: 'delivery-vs-invoice',
    path: '/sales-reports/delivery-vs-invoice',
    permission: OPEN,
    params: [group(['line', 'delivery', 'customer', 'item']), AS_OF, FROM_OPT, TO_OPT, PARTY, ITEM],
    columns: [
      DELIVERY_COL,
      date('document_date', 'documentDate'),
      count('days_open', 'daysOpen', false),
      ORDER_COL,
      PARTY_NAME,
      ...ITEM_COLS,
      qtyCol('quantity', 'quantity'),
      qtyCol('invoiced_quantity', 'invoicedQuantity'),
      qtyCol('uninvoiced_quantity', 'uninvoicedQuantity'),
      qtyCol('in_draft_quantity', 'inDraftQuantity'),
      CURRENCY_COL,
      money('uninvoiced_value', 'uninvoicedValue', false),
      money('uninvoiced_value_local', 'uninvoicedValueLocal'),
      money('uninvoiced_cost', 'uninvoicedCost'),
    ],
    views: {
      delivery: {
        columns: [
          DELIVERY_COL,
          date('document_date', 'documentDate'),
          count('days_open', 'daysOpen', false),
          ORDER_COL,
          PARTY_NAME,
          CURRENCY_COL,
          count('line_count', 'lineCount'),
          money('uninvoiced_value', 'uninvoicedValue', false),
          money('uninvoiced_value_local', 'uninvoicedValueLocal'),
          money('uninvoiced_cost', 'uninvoicedCost'),
        ],
      },
      customer: {
        columns: [
          ...PARTY_COLS,
          count('delivery_count', 'deliveryCount'),
          count('line_count', 'lineCount'),
          money('uninvoiced_value_local', 'uninvoicedValueLocal'),
          money('uninvoiced_cost', 'uninvoicedCost'),
        ],
        chart: { kind: 'bar', label: 'party_name', values: ['uninvoiced_value_local'], top: 10 },
      },
      item: {
        columns: [
          ...ITEM_COLS,
          count('delivery_count', 'deliveryCount', false),
          qtyCol('uninvoiced_base_quantity', 'uninvoicedBaseQuantity'),
          money('uninvoiced_value_local', 'uninvoicedValueLocal'),
          money('uninvoiced_cost', 'uninvoicedCost'),
        ],
        chart: { kind: 'bar', label: 'item_name', values: ['uninvoiced_value_local'], top: 10 },
      },
    },
  },
  {
    id: 'customerAgeing',
    slug: 'customer-ageing',
    path: '/sales-reports/customer-ageing',
    permission: OPEN,
    params: [group(['customer', 'customer_currency', 'invoice']), AS_OF, PARTY],
    columns: [
      ...PARTY_COLS,
      count('invoice_count', 'invoiceCount'),
      money('balance_local', 'balanceLocal'),
      ...BUCKETS,
      date('oldest_due_date', 'oldestDueDate'),
    ],
    chart: AGEING_CHART,
    views: {
      // Buckets in the invoice currency: the (company currency) totals do not apply to them.
      customer_currency: {
        columns: [
          ...PARTY_COLS,
          CURRENCY_COL,
          count('invoice_count', 'invoiceCount'),
          money('balance', 'balance', false),
          ...BUCKETS.map((c) => ({ ...c, total: false })),
          money('balance_local', 'balanceLocal'),
          date('oldest_due_date', 'oldestDueDate'),
        ],
        chart: AGEING_CHART,
      },
      invoice: {
        columns: [
          {
            key: 'number',
            label: 'invoice',
            kind: 'document',
            link: 'invoice',
            idKey: 'invoice_id',
          },
          date('document_date', 'documentDate'),
          date('due_date', 'dueDate'),
          count('days_overdue', 'daysOverdue', false),
          { key: 'bucket', label: 'bucket', kind: 'bucket' },
          PARTY_NAME,
          CURRENCY_COL,
          money('total', 'total', false),
          money('settled_amount', 'settledAmount', false),
          money('balance', 'balance', false),
          money('balance_local', 'balanceLocal'),
        ],
        chart: AGEING_CHART,
      },
    },
  },
  {
    id: 'margin',
    slug: 'margin',
    path: '/sales-reports/margin',
    permission: OPEN,
    params: [
      FROM,
      TO,
      group(['item', 'customer', 'category', 'warehouse', 'month']),
      PARTY,
      ITEM,
      CATEGORY,
    ],
    columns: [
      ...ITEM_COLS,
      CATEGORY_COL,
      qtyCol('invoiced_quantity', 'invoicedQuantity'),
      qtyCol('delivered_quantity', 'deliveredQuantity'),
      ...MARGIN,
    ],
    chart: marginChart('item_name'),
    views: {
      customer: { columns: [...PARTY_COLS, ...MARGIN], chart: marginChart('party_name') },
      category: { columns: [CATEGORY_COL, ...MARGIN], chart: marginChart('category_label') },
      warehouse: { columns: [WAREHOUSE_COL, ...MARGIN], chart: marginChart('warehouse_label') },
      month: {
        columns: [PERIOD_COL, ...MARGIN],
        chart: { kind: 'column', label: 'period', values: ['gross_margin'] },
      },
    },
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
      ITEM,
      CATEGORY,
    ],
    columns: [
      count('rank', 'rank', false),
      ...PARTY_COLS,
      count('invoice_count', 'invoiceCount'),
      money('sales_amount', 'salesAmount'),
      money('returns_amount', 'returnsAmount'),
      money('net_amount', 'netAmount'),
      SHARE,
      pct('cumulative_share_percent', 'cumulativeShare'),
    ],
    chart: { kind: 'bar', label: 'party_name', values: ['net_amount'], top: 10 },
  },
  {
    id: 'returnRate',
    slug: 'return-rate',
    path: '/sales-reports/return-rate',
    permission: OPEN,
    params: [FROM, TO, group(['item', 'customer', 'category']), PARTY, ITEM, CATEGORY],
    columns: [
      ...ITEM_COLS,
      CATEGORY_COL,
      qtyCol('sold_quantity', 'soldQuantity'),
      qtyCol('returned_quantity', 'returnedQuantity'),
      pct('quantity_rate_percent', 'quantityRate'),
      ...RETURNS,
    ],
    chart: returnChart('item_name'),
    views: {
      customer: { columns: [...PARTY_COLS, ...RETURNS], chart: returnChart('party_name') },
      category: { columns: [CATEGORY_COL, ...RETURNS], chart: returnChart('category_label') },
    },
  },
  {
    id: 'quoteConversion',
    slug: 'quote-conversion',
    path: '/sales-reports/quote-conversion',
    permission: OPEN,
    params: [FROM, TO, group(['none', 'customer', 'month']), PARTY, ITEM],
    columns: QUOTES,
    views: {
      customer: {
        columns: [...PARTY_COLS, ...QUOTES],
        chart: {
          kind: 'bar',
          label: 'party_name',
          values: ['conversion_rate_percent'],
          percent: true,
          top: 10,
        },
      },
      month: {
        columns: [PERIOD_COL, ...QUOTES],
        chart: {
          kind: 'column',
          label: 'period',
          values: ['conversion_rate_percent'],
          percent: true,
        },
      },
    },
  },
]

export const reportBySlug = (slug: string | undefined) => REPORTS.find((r) => r.slug === slug)

/** Columns and chart for the applied group_by (the report's own view when it has none). */
export function viewFor(def: ReportDef, groupBy: string | undefined): ReportView {
  const view = groupBy ? def.views?.[groupBy as GroupValue] : undefined
  return view ?? { columns: def.columns, chart: def.chart }
}
