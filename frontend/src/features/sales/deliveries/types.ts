// Dispatch notes (/sales-deliveries) and the order fields the delivery editor reads. Shapes
// mirror PHASE5 and are listed in .orchestra/fe-sales2.md for the integration lane.
import type { ApiAuditRow, DocLink, DocWarning, SalesHeader } from '../invoices/kit/types'

export const DELIVERY_STATUSES = ['draft', 'posted', 'cancelled'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export type TrackingMode = 'none' | 'lot' | 'serial'

/** Invoicing progress of a posted delivery (lines invoiced against delivery_line_id). */
export type InvoicedState = 'none' | 'partial' | 'full'

export interface DeliverySummary extends SalesHeader {
  status: DeliveryStatus
  /** null for a direct delivery (company setting sales.allow_direct_delivery). */
  order_id: string | null
  order_number?: string | null
  warehouse_id: string
  stock_document_id: string | null
  /** COGS entry posted by StockService for the issue. */
  journal_entry_id: string | null
  posted_at?: string | null
  cancelled_at?: string | null
  cancel_reason?: string | null
  invoiced_state?: InvoicedState
  line_count?: number
}

export interface DeliveryLine {
  id: string
  line_no: number
  item_id: string
  item_code?: string | null
  item_name?: string | null
  item_tracking?: TrackingMode
  item_has_expiry?: boolean
  description: string | null
  quantity: string
  unit_id: string
  unit_code?: string | null
  base_quantity: string
  /** Overrides the header warehouse. */
  warehouse_id: string | null
  lot_no: string | null
  expiry_date?: string | null
  serial_numbers: string[]
  /** Order line this delivers (null on direct deliveries). */
  source_line_id: string | null
  /** From the StockPosted result once posted. */
  unit_cost?: string | null
  invoiced_quantity?: string
}

export interface ApiDelivery extends DeliverySummary {
  lines: DeliveryLine[]
  links?: DocLink[]
  warnings?: DocWarning[]
  audit?: ApiAuditRow[]
}

export interface DeliveryLineInput {
  source_line_id: string | null
  item_id: string
  unit_id: string
  quantity: string
  warehouse_id: string | null
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
    warehouse_id: string | null
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

/** The order fields the delivery editor needs (GET /sales-orders/{id}, fe-sales1's resource). */
export interface OrderSourceLine {
  id: string
  line_no: number
  item_id: string
  item_code?: string | null
  item_name?: string | null
  item_tracking?: TrackingMode
  item_type?: 'stock' | 'service'
  description: string | null
  quantity: string
  delivered_quantity: string
  invoiced_quantity?: string
  unit_id: string
  unit_code?: string | null
  warehouse_id: string | null
}

export interface OrderSource {
  id: string
  number: string | null
  status: string
  party_id: string
  party_name?: string | null
  party_snapshot?: { name: string } | null
  warehouse_id: string | null
  currency_code: string
  lines: OrderSourceLine[]
}

/** A lot with stock in a warehouse (GET /stock-lots?filter[item_id]&filter[warehouse_id]). */
export interface LotStock {
  id: string
  lot_no: string
  expiry_date: string | null
  on_hand: string
  /** on_hand minus reservations of other documents when the API reports it. */
  available?: string | null
}
