import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { createSalesDocsDb, salesDocsHandlers, type SalesDocsDb } from '@/test/handlers/salesDocs'
import { server } from '@/test/msw/server'
import { salesDeliveriesRoutes } from '../../deliveries/routes'
import { salesReportsRoutes } from '../../reports/routes'
import { salesReturnsRoutes } from '../../returns/routes'
import { salesInvoicesRoutes } from '../routes'

export const ALL_SALES2_PERMISSIONS = [
  'sales.deliveries.view',
  'sales.deliveries.create',
  'sales.deliveries.update',
  'sales.deliveries.delete',
  'sales.deliveries.post',
  'sales.deliveries.reverse',
  'sales.invoices.view',
  'sales.invoices.create',
  'sales.invoices.update',
  'sales.invoices.delete',
  'sales.invoices.issue',
  'sales.invoices.reverse',
  'sales.returns.view',
  'sales.returns.create',
  'sales.returns.update',
  'sales.returns.delete',
  'sales.returns.approve',
  'sales.returns.receive',
  'sales.returns.credit',
  'sales.reports.view',
  'sales.price_override',
  'accounting.entries.view',
  'inventory.documents.view',
  'sales.orders.view',
]

/** Signed-in user with the given permissions and a fresh in-memory sales API. */
export function setupSales(
  options: { permissions?: string[]; db?: Partial<SalesDocsDb> } = {},
): SalesDocsDb {
  const permissions = options.permissions ?? ALL_SALES2_PERMISSIONS
  const fea = setupFea({ permissions: { [COMPANY_A]: permissions } })
  signIn(fea)
  const db = createSalesDocsDb({ permissions, ...options.db })
  server.use(...salesDocsHandlers(db))
  return db
}

/** Renders the real route tables of this lane (guards + lazy pages) at `path`. */
export function renderSales(path: string) {
  return renderRoutes(
    [
      {
        path: '/',
        children: [
          ...salesDeliveriesRoutes,
          ...salesInvoicesRoutes,
          ...salesReturnsRoutes,
          ...salesReportsRoutes,
        ],
      },
    ],
    path,
  )
}
