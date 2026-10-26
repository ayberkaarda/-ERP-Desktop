// Dispatch notes (/sales-deliveries) and the order fields the delivery editor reads, as the Sales
// API sends them (DocumentResource/LineResource) and as the screens use them after labelling.
import type {
  ApiDetailExtras,
  ApiHeader,
  ApiLine,
  DocLink,
  LineLabels,
  SalesHeader,
} from '../invoices/kit/types'

export const DELIVERY_STATUSES = ['draft', 'posted', 'cancelled'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export type TrackingMode = 'none' | 'lot' | 'serial'

/** Invoicing progress of a posted delivery, from the invoices linked to its lines. */
export type InvoicedState = 'none' | 'partial' | 'full'

interface DeliveryFields {
  status: DeliveryStatus
  /** null for a direct delivery (company setting sales.allow_direct_delivery). */
  order_id: string | null
  /** Invoice that created this delivery automatically (deliver_on_invoice). */
  invoice_id: string | null
  stock_document_id: string | null
  /** COGS entry posted by StockService for the issue. */
  journal_entry_id: string | null
  cost_total: string
  posted_at: string | null
  posted_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  reversal_stock_document_id: string | null
}

/** A list row (GET /sales-deliveries). */
export type DeliverySummary = Omit<SalesHeader, 'status'> & DeliveryFields

export interface ApiDeliveryLine extends ApiLine {
  /** Order line this delivers (null on direct deliveries). */
  order_line_id: string | null
  lot_no: string | null
  serial_numbers: string[] | null
  /** From the StockPosted result once posted. */
  unit_cost: string | null
  cost_total: string | null
}

/** GET /sales-deliveries/{id} (all lines leave from the header warehouse). */
export type RawDelivery = Omit<ApiHeader, 'status'> &
  DeliveryFields &
  ApiDetailExtras & { lines: ApiDeliveryLine[] }

export interface DeliveryLine extends Omit<ApiDeliveryLine, 'serial_numbers'>, LineLabels {
  serial_numbers: string[]
  item_tracking?: TrackingMode
  item_has_expiry?: boolean
  /** Quantity of this line on active invoices (detail only). */
  invoiced_quantity?: string
}

export type DeliveryDetail = DeliverySummary & {
  lines: DeliveryLine[]
  links: DocLink[]
  /** Order number from the chain (detail only). */
  order_number?: string | null
  invoiced_state?: InvoicedState
}

export interface DeliveryLineInput {
  order_line_id: string | null
  item_id: string
  unit_id: string
  quantity: string
  lot_no: string | null
  serial_numbers: string[]
  description: string | null
}

/** POST /sales-deliveries (direct) and PATCH /sales-deliveries/{id} (with version). */
export interface DeliveryInput {
  party_id: string
  document_date: string
  warehouse_id: string
  notes: string | null
  lines: DeliveryLineInput[]
}

/** POST /sales-orders/{id}/deliveries: a draft for the given order lines (partial allowed). */
export interface DeliveryFromOrderInput {
  document_date: string
  warehouse_id: string
  notes: string | null
  lines: {
    order_line_id: string
    quantity: string
    lot_no: string | null
    serial_numbers: string[]
  }[]
}

/** POST /sales-deliveries/{id}/cancel: drafts are dropped, posted ones reverse their stock. */
export interface CancelInput {
  version: number
  reason: string
  date?: string
}

/** Order line as GET /sales-orders/{id} sends it. */
export interface ApiOrderLine extends ApiLine {
  delivered_quantity: string
  invoiced_quantity: string
  reservation_id: string | null
}

export interface RawOrder extends ApiHeader, ApiDetailExtras {
  status: string
  lines: ApiOrderLine[]
}

/** The order fields the delivery editor needs, lines labelled. */
export interface OrderSourceLine extends ApiOrderLine, LineLabels {
  item_tracking?: TrackingMode
}

export interface OrderSource {
  id: string
  number: string | null
  status: string
  party_id: string
  party_name: string | null
  warehouse_id: string | null
  currency_code: string
  lines: OrderSourceLine[]
}

/** A lot with stock in a warehouse (summed over its locations from GET /stock-balances). */
export interface LotStock {
  id: string
  lot_no: string
  expiry_date: string | null
  on_hand: string
  /** on_hand minus reservations. */
  available?: string | null
}
