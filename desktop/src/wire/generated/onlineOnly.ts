// Do not edit: written by scripts/gen-wire-ts.mjs from contracts/.
// After a contract change run `npm run -w desktop wire:gen` and commit.

/** `online_only[]` of contracts/offline-manifest.json, in manifest order. */
export const ONLINE_ONLY = [
  {
    "action": "finalizeSalesQuote",
    "i18n_key": "desktop.onlineOnly.finalizeSalesQuote",
    "category": "finalize",
    "routes": [
      "POST /api/v1/sales-quotes/{id}/send",
      "POST /api/v1/sales-quotes/{id}/accept",
      "POST /api/v1/sales-quotes/{id}/reject",
      "POST /api/v1/sales-quotes/{id}/cancel",
      "POST /api/v1/sales-quotes/{id}/revise",
      "POST /api/v1/sales-quotes/{id}/convert"
    ]
  },
  {
    "action": "confirmSalesOrder",
    "i18n_key": "desktop.onlineOnly.confirmSalesOrder",
    "category": "approve",
    "routes": [
      "POST /api/v1/sales-orders/{id}/confirm",
      "POST /api/v1/sales-orders/{id}/revise",
      "POST /api/v1/sales-orders/{id}/cancel",
      "POST /api/v1/sales-orders/{id}/close",
      "POST /api/v1/sales-orders/{id}/deliveries",
      "POST /api/v1/sales-orders/{id}/invoices"
    ]
  },
  {
    "action": "postSalesDelivery",
    "i18n_key": "desktop.onlineOnly.postSalesDelivery",
    "category": "stock",
    "routes": [
      "POST /api/v1/sales-deliveries",
      "POST /api/v1/sales-deliveries/{id}/post",
      "POST /api/v1/sales-deliveries/{id}/cancel",
      "POST /api/v1/sales-deliveries/{id}/invoice"
    ]
  },
  {
    "action": "issueSalesInvoice",
    "i18n_key": "desktop.onlineOnly.issueSalesInvoice",
    "category": "finalize",
    "routes": [
      "POST /api/v1/sales-invoices",
      "POST /api/v1/sales-invoices/{id}/issue",
      "POST /api/v1/sales-invoices/{id}/reverse",
      "POST /api/v1/sales-invoices/{id}/cancel",
      "POST /api/v1/sales-invoices/{id}/returns"
    ]
  },
  {
    "action": "processSalesReturn",
    "i18n_key": "desktop.onlineOnly.processSalesReturn",
    "category": "stock",
    "routes": [
      "POST /api/v1/sales-returns/{id}/approve",
      "POST /api/v1/sales-returns/{id}/receive",
      "POST /api/v1/sales-returns/{id}/credit",
      "POST /api/v1/sales-returns/{id}/cancel"
    ]
  },
  {
    "action": "submitPurchaseRequest",
    "i18n_key": "desktop.onlineOnly.submitPurchaseRequest",
    "category": "approve",
    "routes": [
      "POST /api/v1/purchase-requests/{id}/submit",
      "POST /api/v1/purchase-requests/{id}/cancel",
      "POST /api/v1/purchase-requests/{id}/rfq",
      "POST /api/v1/purchase-requests/{id}/orders"
    ]
  },
  {
    "action": "processPurchaseRfq",
    "i18n_key": "desktop.onlineOnly.processPurchaseRfq",
    "category": "approve",
    "routes": [
      "POST /api/v1/purchase-rfqs",
      "POST /api/v1/purchase-rfqs/{id}/send",
      "POST /api/v1/purchase-rfqs/{id}/cancel",
      "POST /api/v1/purchase-rfqs/{id}/quotes",
      "POST /api/v1/purchase-rfqs/{id}/award"
    ]
  },
  {
    "action": "approvePurchaseOrder",
    "i18n_key": "desktop.onlineOnly.approvePurchaseOrder",
    "category": "approve",
    "routes": [
      "POST /api/v1/purchase-orders",
      "POST /api/v1/purchase-orders/{id}/submit",
      "POST /api/v1/purchase-orders/{id}/revise",
      "POST /api/v1/purchase-orders/{id}/send",
      "POST /api/v1/purchase-orders/{id}/cancel",
      "POST /api/v1/purchase-orders/{id}/close",
      "POST /api/v1/purchase-orders/{id}/receipts",
      "POST /api/v1/purchase-orders/{id}/invoices"
    ]
  },
  {
    "action": "postPurchaseReceipt",
    "i18n_key": "desktop.onlineOnly.postPurchaseReceipt",
    "category": "stock",
    "routes": [
      "POST /api/v1/purchase-receipts",
      "POST /api/v1/purchase-receipts/{id}/post",
      "POST /api/v1/purchase-receipts/{id}/cancel",
      "POST /api/v1/purchase-receipts/{id}/invoice",
      "POST /api/v1/purchase-receipts/{id}/returns"
    ]
  },
  {
    "action": "bookPurchaseInvoice",
    "i18n_key": "desktop.onlineOnly.bookPurchaseInvoice",
    "category": "finalize",
    "routes": [
      "POST /api/v1/purchase-invoices",
      "POST /api/v1/purchase-invoices/{id}/book",
      "POST /api/v1/purchase-invoices/{id}/reverse",
      "POST /api/v1/purchase-invoices/{id}/cancel",
      "POST /api/v1/purchase-invoices/{id}/returns"
    ]
  },
  {
    "action": "processPurchaseReturn",
    "i18n_key": "desktop.onlineOnly.processPurchaseReturn",
    "category": "stock",
    "routes": [
      "POST /api/v1/purchase-returns/{id}/approve",
      "POST /api/v1/purchase-returns/{id}/ship",
      "POST /api/v1/purchase-returns/{id}/debit",
      "POST /api/v1/purchase-returns/{id}/cancel"
    ]
  },
  {
    "action": "postStockDocument",
    "i18n_key": "desktop.onlineOnly.postStockDocument",
    "category": "stock",
    "routes": [
      "POST /api/v1/stock-documents/{id}/import",
      "POST /api/v1/stock-documents/{id}/post",
      "POST /api/v1/stock-documents/{id}/reverse",
      "POST /api/v1/stock-reservations",
      "POST /api/v1/stock-reservations/{id}/release"
    ]
  },
  {
    "action": "decideApproval",
    "i18n_key": "desktop.onlineOnly.decideApproval",
    "category": "approve",
    "routes": [
      "POST /api/v1/approvals/{id}/decisions"
    ]
  },
  {
    "action": "treasuryPayment",
    "i18n_key": "desktop.onlineOnly.treasuryPayment",
    "category": "payment",
    "routes": [
      "POST /api/v1/treasury-payments/{id}/submit",
      "POST /api/v1/treasury-payments/{id}/post",
      "POST /api/v1/treasury-payments/{id}/reverse",
      "POST /api/v1/treasury-payments/{id}/cancel",
      "POST /api/v1/treasury-transfers",
      "POST /api/v1/treasury-transfers/{id}/post",
      "POST /api/v1/treasury-transfers/{id}/reverse",
      "POST /api/v1/treasury-transfers/{id}/cancel",
      "POST /api/v1/treasury-payment-plans/{id}/fulfil"
    ]
  },
  {
    "action": "sendEDocument",
    "i18n_key": "desktop.onlineOnly.sendEDocument",
    "category": "edocument",
    "routes": [
      "POST /api/v1/e-documents/documents",
      "POST /api/v1/e-documents/documents/{id}/validate",
      "POST /api/v1/e-documents/documents/{id}/send",
      "POST /api/v1/e-documents/documents/{id}/retry",
      "POST /api/v1/e-documents/documents/{id}/poll",
      "POST /api/v1/e-documents/documents/{id}/respond",
      "POST /api/v1/e-documents/documents/{id}/cancel"
    ]
  },
  {
    "action": "postJournalEntry",
    "i18n_key": "desktop.onlineOnly.postJournalEntry",
    "category": "finalize",
    "routes": [
      "POST /api/v1/journal-entries/{id}/post",
      "POST /api/v1/journal-entries/{id}/reverse"
    ]
  },
  {
    "action": "closePeriod",
    "i18n_key": "desktop.onlineOnly.closePeriod",
    "category": "period-close",
    "routes": [
      "POST /api/v1/accounting-periods/{id}/soft-close",
      "POST /api/v1/accounting-periods/{id}/close",
      "POST /api/v1/accounting-periods/{id}/reopen",
      "POST /api/v1/fiscal-years/{id}/close",
      "POST /api/v1/fiscal-years/{id}/reopen"
    ]
  },
  {
    "action": "serverCalculation",
    "i18n_key": "desktop.onlineOnly.serverCalculation",
    "category": "server-calculation",
    "routes": [
      "POST /api/v1/sales-documents/preview-totals",
      "POST /api/v1/purchase-documents/preview-totals",
      "GET /api/v1/treasury-payments/{id}/preview",
      "GET /api/v1/pricing/resolve",
      "GET /api/v1/customers/{id}/exposure",
      "GET /api/v1/suppliers/{id}/exposure"
    ]
  },
  {
    "action": "liveReports",
    "i18n_key": "desktop.onlineOnly.liveReports",
    "category": "live-report",
    "routes": [
      "GET /api/v1/reports/trial-balance",
      "GET /api/v1/reports/general-ledger",
      "GET /api/v1/inventory-reports/stock-status",
      "GET /api/v1/inventory-reports/valuation",
      "GET /api/v1/sales-reports/sales-by-period",
      "GET /api/v1/purchase-reports/purchases-by-period",
      "GET /api/v1/treasury-reports/cash-flow"
    ]
  }
] as const

/** `api_prefix` of contracts/offline-manifest.json. */
export const API_PREFIX = "/api/v1"
