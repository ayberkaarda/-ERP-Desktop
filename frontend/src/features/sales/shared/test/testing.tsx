import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { server } from '@/test/msw/server'
import { ordersRoutes } from '../../orders/routes'
import { quotesRoutes } from '../../quotes/routes'
import { createSalesDb, salesHandlers, type SalesDb } from './handlers'

export const ALL_SALES_PERMISSIONS = [
  'sales.quotes.view',
  'sales.quotes.create',
  'sales.quotes.update',
  'sales.quotes.delete',
  'sales.orders.view',
  'sales.orders.create',
  'sales.orders.update',
  'sales.orders.delete',
  'sales.deliveries.create',
  'sales.invoices.create',
  'sales.price_override',
  'sales.credit_override',
  'inventory.stock.view',
  'items.view',
  'parties.view',
]

/** Signed-in user with the given permissions and a fresh in-memory sales API. */
export function setupSales(
  options: { permissions?: string[]; db?: Partial<SalesDb> } = {},
): SalesDb {
  const permissions = options.permissions ?? ALL_SALES_PERMISSIONS
  const fea = setupFea({ permissions: { [COMPANY_A]: permissions } })
  signIn(fea)
  const db = createSalesDb({ permissions, ...options.db })
  server.use(...salesHandlers(db))
  return db
}

/** Renders the real route tables of this lane (guards + lazy pages) at `path`. */
export function renderSales(path: string) {
  return renderRoutes([{ path: '/', children: [...quotesRoutes, ...ordersRoutes] }], path)
}
