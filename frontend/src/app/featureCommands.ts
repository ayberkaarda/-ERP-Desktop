import { registerAccountsCommands } from '@/features/accounting/accounts/commands'
import { registerDeterminationCommands } from '@/features/accounting/determination/commands'
import { registerFiscalCommands } from '@/features/accounting/fiscal/commands'
import { registerJournalCommands } from '@/features/accounting/journal/commands'
import { registerPeriodsCommands } from '@/features/accounting/periods/commands'
import { registerReportsCommands } from '@/features/accounting/reports/commands'
import { registerCatalogCommands } from '@/features/catalog/commands'
import { registerCountsCommands } from '@/features/inventory/counts/commands'
import { registerDocumentsCommands } from '@/features/inventory/documents/commands'
import { registerLotsCommands } from '@/features/inventory/lots/commands'
import { registerMovementsCommands } from '@/features/inventory/movements/commands'
import { registerInventoryReportsCommands } from '@/features/inventory/reports/commands'
import { registerReservationsCommands } from '@/features/inventory/reservations/commands'
import { registerStockCommands } from '@/features/inventory/stock/commands'
import { registerWarehousesCommands } from '@/features/inventory/warehouses/commands'
import { registerPartyCommands } from '@/features/parties/commands'
import { registerReferenceCommands } from '@/features/reference/commands'
import { registerSalesDeliveriesCommands } from '@/features/sales/deliveries/commands'
import { registerSalesInvoicesCommands } from '@/features/sales/invoices/commands'
import { registerOrdersCommands } from '@/features/sales/orders/commands'
import { registerQuotesCommands } from '@/features/sales/quotes/commands'
import { registerSalesReportsCommands } from '@/features/sales/reports/commands'
import { registerSalesReturnsCommands } from '@/features/sales/returns/commands'

let unregister: (() => void) | null = null

/** Adds the feature modules' palette entries; safe to call more than once. */
export function registerFeatureCommands(): () => void {
  if (!unregister) {
    const parts = [
      registerPartyCommands(),
      registerCatalogCommands(),
      registerReferenceCommands(),
      registerAccountsCommands(),
      registerFiscalCommands(),
      registerPeriodsCommands(),
      registerDeterminationCommands(),
      registerJournalCommands(),
      registerReportsCommands(),
      registerWarehousesCommands(),
      registerStockCommands(),
      registerMovementsCommands(),
      registerLotsCommands(),
      registerDocumentsCommands(),
      registerCountsCommands(),
      registerReservationsCommands(),
      registerInventoryReportsCommands(),
      registerQuotesCommands(),
      registerOrdersCommands(),
      registerSalesDeliveriesCommands(),
      registerSalesInvoicesCommands(),
      registerSalesReturnsCommands(),
      registerSalesReportsCommands(),
    ]
    unregister = () => {
      parts.forEach((off) => off())
      unregister = null
    }
  }
  return unregister
}
