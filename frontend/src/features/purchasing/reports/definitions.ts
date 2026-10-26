// Purchasing report definitions: API path, parameter form, columns and chart, aligned with the
// purchrep backend (App\Modules\Purchasing\Reports: PurchaseReportRequest groups/filters and each
// report's columns()). Reports live at GET /purchase-reports/<name> (purchasing.reports.view) and
// answer `{data: rows of the page, meta: {report, currency, filters, totals, by_currency?,
// pagination}}`; money at scale 4 (cents), quantities at scale 6, *_percent at scale 2 (null when
// the base is 0), supplier-performance rates as 0..1 fractions. Each report has an
// `/export?format=csv|xlsx` twin with the same parameters. group_by is accepted only where listed.
import { toIsoDate } from '@/lib/datetime'
import type { PermissionRequirement } from '@/lib/permissions'
import { PURCH_OPEN } from '../invoices/kit/permissions'

export const REPORT_IDS = [
  'purchasesByPeriod',
  'bySupplier',
  'byItem',
  'openOrders',
  'receiptVsInvoice',
  'supplierAgeing',
  'priceVariance',
  'supplierPerformance',
  'topSuppliers',
  'returnRate',
  'rfqSavings',
] as const
export type ReportId = (typeof REPORT_IDS)[number]

export type GroupValue =
  | 'line'
  | 'order'
  | 'receipt'
  | 'invoice'
  | 'supplier'
  | 'supplier_currency'
  | 'item'
  | 'category'
  | 'rfq'

export type ParamLabel =
  | 'dateFrom'
  | 'dateTo'
  | 'asOf'
  | 'supplier'
  | 'item'
  | 'category'
  | 'warehouse'
  | 'currency'
  | 'period'
  | 'periodDay'
  | 'periodWeek'
  | 'periodMonth'
  | 'groupBy'
  | 'limit'
  | `group.${GroupValue}`

export type ParamKind =
  'date' | 'party' | 'item' | 'category' | 'warehouse' | 'currency' | 'select' | 'number'

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

/** Column label keys (`col.<label>` in the purchasing-reports namespace). */
export type ColLabel =
  | 'period'
  | 'periodStart'
  | 'periodEnd'
  | 'partyCode'
  | 'partyName'
  | 'itemCode'
  | 'itemName'
  | 'category'
  | 'invoiceCount'
  | 'debitNoteCount'
  | 'reversalCount'
  | 'purchasesAmount'
  | 'returnsAmount'
  | 'netAmount'
  | 'taxAmount'
  | 'withholdingAmount'
  | 'totalAmount'
  | 'payableAmount'
  | 'share'
  | 'cumulativeShare'
  | 'rank'
  | 'purchasedQuantity'
  | 'returnedQuantity'
  | 'netQuantity'
  | 'averagePrice'
  | 'order'
  | 'receipt'
  | 'invoice'
  | 'document'
  | 'source'
  | 'supplierInvoiceNo'
  | 'date'
  | 'documentDate'
  | 'expectedDate'
  | 'daysLate'
  | 'daysOpen'
  | 'quantity'
  | 'receivedQuantity'
  | 'invoicedQuantity'
  | 'openQuantity'
  | 'openBaseQuantity'
  | 'uninvoicedQuantity'
  | 'inDraftQuantity'
  | 'uninvoicedBaseQuantity'
  | 'currency'
  | 'openValue'
  | 'openValueLocal'
  | 'receivedValue'
  | 'invoicedValue'
  | 'returnedValue'
  | 'uninvoicedValue'
  | 'lineCount'
  | 'orderCount'
  | 'receiptCount'
  | 'returnCount'
  | 'dueDate'
  | 'daysOverdue'
  | 'bucket'
  | 'payable'
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
  | 'orderUnitPrice'
  | 'invoiceUnitPrice'
  | 'priceDifference'
  | 'receiptValue'
  | 'documentValue'
  | 'varianceAmount'
  | 'unfavourableAmount'
  | 'favourableAmount'
  | 'orders'
  | 'receiptLines'
  | 'onTimeLines'
  | 'onTimeRate'
  | 'orderedQuantity'
  | 'receivedOnOrders'
  | 'fillRate'
  | 'avgLeadDays'
  | 'priceVarianceTotal'
  | 'returnRate'
  | 'overduePayable'
  | 'quantityRate'
  | 'valueRate'
  | 'rfq'
  | 'rfqCount'
  | 'supplierCount'
  | 'quoteCount'
  | 'awardedUnitPrice'
  | 'lowestUnitPrice'
  | 'highestUnitPrice'
  | 'averageUnitPrice'
  | 'awardedValue'
  | 'lowestValue'
  | 'highestValue'
  | 'averageValue'
  | 'estimatedValue'
  | 'savingsVsHighest'
  | 'savingsVsAverage'
  | 'savingsVsEstimate'
  | 'premiumVsLowest'

/**
 * ratio: a 0..1 fraction shown as a percentage (x100 with Decimal); source: price-variance
 * source (invoice | debit_note | return); bucket: ageing bucket key.
 */
export type ColKind =
  | 'text'
  | 'code'
  | 'qty'
  | 'money'
  | 'percent'
  | 'ratio'
  | 'integer'
  | 'decimal'
  | 'date'
  | 'document'
  | 'source'
  | 'bucket'

/** Link targets of document columns ('source' resolves from the row's `source`). */
export type LinkKind = 'order' | 'receipt' | 'invoice' | 'return' | 'source'

export interface ColDef {
  key: string
  label: ColLabel
  kind: ColKind
  /** Shown in the totals row from meta.totals[key]. */
  total?: boolean
  link?: LinkKind
  idKey?: string
}

export type Row = Record<string, unknown>

/** column: one bar per row in order; bar: top rows by value; stacked: ageing buckets of totals. */
export interface ChartDef {
  kind: 'column' | 'bar' | 'stacked'
  label: string
  values: string[]
  percent?: boolean
  /** Values are 0..1 fractions: plotted x100 as percentages. */
  ratio?: boolean
  top?: number
}

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
  views?: Partial<Record<GroupValue, ReportView>>
}

const today = () => toIsoDate(new Date())
const yearStart = () => `${today().slice(0, 4)}-01-01`

const FROM: ParamDef = { key: 'date_from', kind: 'date', label: 'dateFrom', initial: yearStart }
const TO: ParamDef = { key: 'date_to', kind: 'date', label: 'dateTo', initial: today }
const FROM_OPT: ParamDef = { key: 'date_from', kind: 'date', label: 'dateFrom' }
const TO_OPT: ParamDef = { key: 'date_to', kind: 'date', label: 'dateTo' }
const AS_OF: ParamDef = { key: 'as_of', kind: 'date', label: 'asOf', initial: today }
const SUPPLIER: ParamDef = { key: 'party_id', kind: 'party', label: 'supplier' }
const ITEM: ParamDef = { key: 'item_id', kind: 'item', label: 'item' }
const CATEGORY: ParamDef = { key: 'category_id', kind: 'category', label: 'category' }
const WAREHOUSE: ParamDef = { key: 'warehouse_id', kind: 'warehouse', label: 'warehouse' }
const CURRENCY: ParamDef = { key: 'currency_code', kind: 'currency', label: 'currency' }
/** Filters every report except ageing and performance applies. */
const SCOPE: ParamDef[] = [SUPPLIER, ITEM, CATEGORY, WAREHOUSE, CURRENCY]
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
const qtyCol = (key: string, label: ColLabel, total = false): ColDef => ({
  key,
  label,
  kind: 'qty',
  total,
})
const pct = (key: string, label: ColLabel, total = false): ColDef => ({
  key,
  label,
  kind: 'percent',
  total,
})
const ratio = (key: string, label: ColLabel): ColDef => ({ key, label, kind: 'ratio' })
const date = (key: string, label: ColLabel): ColDef => ({ key, label, kind: 'date' })

const PERIOD_COLS: ColDef[] = [
  { key: 'period', label: 'period', kind: 'text' },
  date('period_start', 'periodStart'),
  date('period_end', 'periodEnd'),
]
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
const CURRENCY_COL: ColDef = { key: 'currency_code', label: 'currency', kind: 'code' }
const ORDER_COL: ColDef = {
  key: 'order_number',
  label: 'order',
  kind: 'document',
  link: 'order',
  idKey: 'order_id',
}
const RECEIPT_COL: ColDef = {
  key: 'receipt_number',
  label: 'receipt',
  kind: 'document',
  link: 'receipt',
  idKey: 'receipt_id',
}

const AMOUNTS: ColDef[] = [
  count('invoice_count', 'invoiceCount'),
  count('debit_note_count', 'debitNoteCount'),
  count('reversal_count', 'reversalCount'),
  money('purchases_amount', 'purchasesAmount'),
  money('returns_amount', 'returnsAmount'),
  money('net_amount', 'netAmount'),
  money('tax_amount', 'taxAmount'),
  money('total_amount', 'totalAmount'),
  money('withholding_amount', 'withholdingAmount'),
  money('payable_amount', 'payableAmount'),
]
const SHARE = pct('share_percent', 'share')

/** Ageing buckets; their label keys are the same as the Sales report chart legend. */
export const AGEING_BUCKETS = [
  'not_due',
  'days_0_30',
  'days_31_60',
  'days_61_90',
  'days_over_90',
] as const
const BUCKETS = (total: boolean): ColDef[] => [
  money('not_due', 'notDue', total),
  money('days_0_30', 'days0to30', total),
  money('days_31_60', 'days31to60', total),
  money('days_61_90', 'days61to90', total),
  money('days_over_90', 'daysOver90', total),
]
const AGEING_CHART: ChartDef = {
  kind: 'stacked',
  label: 'party_name',
  values: [...AGEING_BUCKETS],
}

const OPEN_MONEY = (total: boolean): ColDef[] => [
  money('open_value', 'openValue', false),
  money('open_value_local', 'openValueLocal', total),
]
const GRNI_MONEY: ColDef[] = [
  money('received_value', 'receivedValue'),
  money('invoiced_value', 'invoicedValue'),
  money('returned_value', 'returnedValue'),
  money('uninvoiced_value', 'uninvoicedValue'),
]
const VARIANCE_MONEY: ColDef[] = [
  money('receipt_value', 'receiptValue'),
  money('document_value', 'documentValue'),
  money('variance_amount', 'varianceAmount'),
  money('unfavourable_amount', 'unfavourableAmount'),
  money('favourable_amount', 'favourableAmount'),
]
const varianceChart = (label: string): ChartDef => ({
  kind: 'bar',
  label,
  values: ['variance_amount'],
  top: 10,
})

const RETURN_FIGURES: ColDef[] = [
  count('receipt_count', 'receiptCount', false),
  count('return_count', 'returnCount', false),
  qtyCol('received_quantity', 'receivedQuantity', true),
  qtyCol('returned_quantity', 'returnedQuantity', true),
  pct('quantity_rate_percent', 'quantityRate', true),
  money('received_value', 'receivedValue'),
  money('returned_value', 'returnedValue'),
  pct('value_rate_percent', 'valueRate', true),
]
const returnChart = (label: string): ChartDef => ({
  kind: 'bar',
  label,
  values: ['quantity_rate_percent'],
  percent: true,
  top: 10,
})

/** RFQ savings are per RFQ currency (meta.by_currency); no company-currency totals. */
const SAVINGS: ColDef[] = [
  money('awarded_value', 'awardedValue', false),
  money('lowest_value', 'lowestValue', false),
  money('highest_value', 'highestValue', false),
  money('average_value', 'averageValue', false),
  money('estimated_value', 'estimatedValue', false),
  money('savings_vs_highest', 'savingsVsHighest', false),
  money('savings_vs_average', 'savingsVsAverage', false),
  money('savings_vs_estimate', 'savingsVsEstimate', false),
  money('premium_vs_lowest', 'premiumVsLowest', false),
]
const RFQ_COL: ColDef = { key: 'rfq_number', label: 'rfq', kind: 'code' }

const OPEN = PURCH_OPEN.reports
const base = '/purchase-reports'

export const REPORTS: ReportDef[] = [
  {
    id: 'purchasesByPeriod',
    slug: 'purchases-by-period',
    path: `${base}/purchases-by-period`,
    permission: OPEN,
    params: [FROM, TO, PERIOD, ...SCOPE],
    columns: [...PERIOD_COLS, ...AMOUNTS],
    chart: { kind: 'column', label: 'period', values: ['net_amount'] },
  },
  {
    id: 'bySupplier',
    slug: 'by-supplier',
    path: `${base}/by-supplier`,
    permission: OPEN,
    params: [FROM, TO, ...SCOPE],
    columns: [...PARTY_COLS, ...AMOUNTS, SHARE],
    chart: { kind: 'bar', label: 'party_name', values: ['net_amount'], top: 10 },
  },
  {
    id: 'byItem',
    slug: 'by-item',
    path: `${base}/by-item`,
    permission: OPEN,
    params: [FROM, TO, ...SCOPE],
    columns: [
      ...ITEM_COLS,
      CATEGORY_COL,
      qtyCol('purchased_quantity', 'purchasedQuantity'),
      qtyCol('returned_quantity', 'returnedQuantity'),
      qtyCol('net_quantity', 'netQuantity'),
      money('average_price', 'averagePrice', false),
      ...AMOUNTS.filter((c) => c.kind === 'money'),
      SHARE,
    ],
    chart: { kind: 'bar', label: 'item_name', values: ['net_amount'], top: 10 },
  },
  {
    id: 'openOrders',
    slug: 'open-orders',
    path: `${base}/open-orders`,
    permission: OPEN,
    params: [group(['line', 'order', 'supplier', 'item']), FROM_OPT, TO_OPT, ...SCOPE],
    columns: [
      ORDER_COL,
      date('document_date', 'documentDate'),
      date('expected_date', 'expectedDate'),
      count('days_late', 'daysLate', false),
      PARTY_NAME,
      ...ITEM_COLS,
      qtyCol('quantity', 'quantity'),
      qtyCol('received_quantity', 'receivedQuantity'),
      qtyCol('invoiced_quantity', 'invoicedQuantity'),
      qtyCol('open_quantity', 'openQuantity'),
      qtyCol('open_base_quantity', 'openBaseQuantity'),
      CURRENCY_COL,
      ...OPEN_MONEY(true),
    ],
    views: {
      order: {
        columns: [
          ORDER_COL,
          date('document_date', 'documentDate'),
          date('expected_date', 'expectedDate'),
          count('days_late', 'daysLate', false),
          PARTY_NAME,
          CURRENCY_COL,
          count('line_count', 'lineCount'),
          ...OPEN_MONEY(true),
        ],
      },
      supplier: {
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
          count('line_count', 'lineCount'),
          qtyCol('open_base_quantity', 'openBaseQuantity'),
          money('open_value_local', 'openValueLocal'),
        ],
        chart: { kind: 'bar', label: 'item_name', values: ['open_value_local'], top: 10 },
      },
    },
  },
  {
    id: 'receiptVsInvoice',
    slug: 'receipt-vs-invoice',
    path: `${base}/receipt-vs-invoice`,
    permission: OPEN,
    params: [group(['line', 'receipt', 'supplier', 'item']), AS_OF, FROM_OPT, TO_OPT, ...SCOPE],
    columns: [
      RECEIPT_COL,
      date('document_date', 'documentDate'),
      count('days_open', 'daysOpen', false),
      ORDER_COL,
      PARTY_NAME,
      ...ITEM_COLS,
      CURRENCY_COL,
      qtyCol('received_quantity', 'receivedQuantity'),
      qtyCol('invoiced_quantity', 'invoicedQuantity'),
      qtyCol('returned_quantity', 'returnedQuantity'),
      qtyCol('uninvoiced_quantity', 'uninvoicedQuantity'),
      qtyCol('in_draft_quantity', 'inDraftQuantity'),
      qtyCol('uninvoiced_base_quantity', 'uninvoicedBaseQuantity'),
      ...GRNI_MONEY,
    ],
    views: {
      receipt: {
        columns: [
          RECEIPT_COL,
          date('document_date', 'documentDate'),
          count('days_open', 'daysOpen', false),
          ORDER_COL,
          PARTY_NAME,
          CURRENCY_COL,
          count('line_count', 'lineCount'),
          ...GRNI_MONEY,
        ],
      },
      supplier: {
        columns: [
          ...PARTY_COLS,
          count('receipt_count', 'receiptCount'),
          count('line_count', 'lineCount'),
          ...GRNI_MONEY,
        ],
        chart: { kind: 'bar', label: 'party_name', values: ['uninvoiced_value'], top: 10 },
      },
      item: {
        columns: [
          ...ITEM_COLS,
          count('receipt_count', 'receiptCount', false),
          count('line_count', 'lineCount'),
          qtyCol('uninvoiced_base_quantity', 'uninvoicedBaseQuantity'),
          ...GRNI_MONEY,
        ],
        chart: { kind: 'bar', label: 'item_name', values: ['uninvoiced_value'], top: 10 },
      },
    },
  },
  {
    id: 'supplierAgeing',
    slug: 'supplier-ageing',
    path: `${base}/supplier-ageing`,
    permission: OPEN,
    params: [group(['supplier', 'supplier_currency', 'invoice']), AS_OF, SUPPLIER, CURRENCY],
    columns: [
      ...PARTY_COLS,
      count('invoice_count', 'invoiceCount'),
      money('balance_local', 'balanceLocal'),
      ...BUCKETS(true),
      money('overdue', 'overdue'),
      date('oldest_due_date', 'oldestDueDate'),
    ],
    chart: AGEING_CHART,
    views: {
      // Buckets in the invoice currency: the company-currency totals do not apply to them.
      supplier_currency: {
        columns: [
          ...PARTY_COLS,
          CURRENCY_COL,
          count('invoice_count', 'invoiceCount'),
          money('balance', 'balance', false),
          ...BUCKETS(false),
          money('overdue', 'overdue', false),
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
          { key: 'supplier_invoice_no', label: 'supplierInvoiceNo', kind: 'code' },
          date('document_date', 'documentDate'),
          date('due_date', 'dueDate'),
          count('days_overdue', 'daysOverdue', false),
          { key: 'bucket', label: 'bucket', kind: 'bucket' },
          PARTY_NAME,
          CURRENCY_COL,
          money('payable', 'payable', false),
          money('settled_amount', 'settledAmount', false),
          money('balance', 'balance', false),
          money('balance_local', 'balanceLocal'),
        ],
        chart: AGEING_CHART,
      },
    },
  },
  {
    id: 'priceVariance',
    slug: 'price-variance',
    path: `${base}/price-variance`,
    permission: OPEN,
    params: [FROM, TO, group(['line', 'supplier', 'item']), ...SCOPE],
    columns: [
      date('date', 'date'),
      { key: 'source', label: 'source', kind: 'source' },
      { key: 'number', label: 'document', kind: 'document', link: 'source', idKey: 'document_id' },
      { key: 'supplier_invoice_no', label: 'supplierInvoiceNo', kind: 'code' },
      PARTY_NAME,
      ...ITEM_COLS,
      ORDER_COL,
      CURRENCY_COL,
      qtyCol('quantity', 'quantity'),
      { key: 'order_unit_price', label: 'orderUnitPrice', kind: 'money' },
      { key: 'invoice_unit_price', label: 'invoiceUnitPrice', kind: 'money' },
      pct('price_difference_percent', 'priceDifference'),
      money('receipt_value', 'receiptValue'),
      money('document_value', 'documentValue'),
      money('variance_amount', 'varianceAmount'),
    ],
    views: {
      supplier: {
        columns: [...PARTY_COLS, count('line_count', 'lineCount'), ...VARIANCE_MONEY],
        chart: varianceChart('party_name'),
      },
      item: {
        columns: [...ITEM_COLS, count('line_count', 'lineCount'), ...VARIANCE_MONEY],
        chart: varianceChart('item_name'),
      },
    },
  },
  {
    id: 'supplierPerformance',
    slug: 'supplier-performance',
    path: `${base}/supplier-performance`,
    permission: OPEN,
    params: [FROM, TO, SUPPLIER],
    columns: [
      ...PARTY_COLS,
      count('orders', 'orders', false),
      count('receipt_lines', 'receiptLines', false),
      count('on_time_lines', 'onTimeLines', false),
      ratio('on_time_rate', 'onTimeRate'),
      qtyCol('ordered_quantity', 'orderedQuantity'),
      qtyCol('received_on_orders', 'receivedOnOrders'),
      ratio('fill_rate', 'fillRate'),
      { key: 'avg_lead_days', label: 'avgLeadDays', kind: 'decimal' },
      money('price_variance_total', 'priceVarianceTotal', false),
      qtyCol('received_quantity', 'receivedQuantity'),
      qtyCol('returned_quantity', 'returnedQuantity'),
      ratio('return_rate', 'returnRate'),
      money('overdue_payable', 'overduePayable', false),
    ],
    chart: {
      kind: 'bar',
      label: 'party_name',
      values: ['on_time_rate'],
      percent: true,
      ratio: true,
      top: 10,
    },
  },
  {
    id: 'topSuppliers',
    slug: 'top-suppliers',
    path: `${base}/top-suppliers`,
    permission: OPEN,
    params: [
      FROM,
      TO,
      { key: 'limit', kind: 'number', label: 'limit', initial: () => '10', min: 1, max: 100 },
      ...SCOPE,
    ],
    columns: [
      count('rank', 'rank', false),
      ...PARTY_COLS,
      count('invoice_count', 'invoiceCount'),
      money('purchases_amount', 'purchasesAmount'),
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
    path: `${base}/return-rate`,
    permission: OPEN,
    params: [FROM, TO, group(['supplier', 'item', 'category']), ...SCOPE],
    columns: [...PARTY_COLS, ...RETURN_FIGURES],
    chart: returnChart('party_name'),
    views: {
      item: {
        columns: [...ITEM_COLS, CATEGORY_COL, ...RETURN_FIGURES],
        chart: returnChart('item_name'),
      },
      category: {
        columns: [CATEGORY_COL, ...RETURN_FIGURES],
        chart: returnChart('category_label'),
      },
    },
  },
  {
    id: 'rfqSavings',
    slug: 'rfq-savings',
    path: `${base}/rfq-savings`,
    permission: OPEN,
    params: [FROM, TO, group(['rfq', 'line', 'supplier']), ...SCOPE],
    columns: [
      RFQ_COL,
      date('document_date', 'documentDate'),
      CURRENCY_COL,
      count('line_count', 'lineCount', false),
      count('supplier_count', 'supplierCount', false),
      ...SAVINGS,
    ],
    chart: { kind: 'bar', label: 'rfq_number', values: ['savings_vs_highest'], top: 10 },
    views: {
      line: {
        columns: [
          RFQ_COL,
          date('document_date', 'documentDate'),
          ...ITEM_COLS,
          PARTY_NAME,
          CURRENCY_COL,
          qtyCol('quantity', 'quantity'),
          count('quote_count', 'quoteCount', false),
          { key: 'awarded_unit_price', label: 'awardedUnitPrice', kind: 'money' },
          { key: 'lowest_unit_price', label: 'lowestUnitPrice', kind: 'money' },
          { key: 'highest_unit_price', label: 'highestUnitPrice', kind: 'money' },
          { key: 'average_unit_price', label: 'averageUnitPrice', kind: 'money' },
          ...SAVINGS,
        ],
      },
      supplier: {
        columns: [
          ...PARTY_COLS,
          CURRENCY_COL,
          count('rfq_count', 'rfqCount', false),
          count('line_count', 'lineCount', false),
          ...SAVINGS,
        ],
        chart: { kind: 'bar', label: 'party_name', values: ['savings_vs_highest'], top: 10 },
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

/** group_by values a report accepts (empty: the report refuses the parameter). */
export function groupsOf(def: ReportDef): string[] {
  return def.params.find((p) => p.key === 'group_by')?.options?.map((o) => o.value) ?? []
}
