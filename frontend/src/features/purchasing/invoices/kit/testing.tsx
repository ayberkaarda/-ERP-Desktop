import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { createPurchDocsDb, purchDocsHandlers, type PurchDocsDb } from '@/test/handlers/purchDocs'
import { server } from '@/test/msw/server'
import { purchaseReceiptsRoutes } from '../../receipts/routes'
import { purchaseReportsRoutes } from '../../reports/routes'
import { purchaseReturnsRoutes } from '../../returns/routes'
import { purchaseInvoicesRoutes } from '../routes'

export const ALL_PURCH2_PERMISSIONS = [
  'purchasing.receipts.view',
  'purchasing.receipts.create',
  'purchasing.receipts.update',
  'purchasing.receipts.delete',
  'purchasing.receipts.post',
  'purchasing.receipts.reverse',
  'purchasing.invoices.view',
  'purchasing.invoices.create',
  'purchasing.invoices.update',
  'purchasing.invoices.delete',
  'purchasing.invoices.book',
  'purchasing.invoices.reverse',
  'purchasing.returns.view',
  'purchasing.returns.create',
  'purchasing.returns.update',
  'purchasing.returns.delete',
  'purchasing.returns.approve',
  'purchasing.returns.ship',
  'purchasing.returns.debit',
  'purchasing.orders.view',
  'purchasing.reports.view',
  'accounting.entries.view',
  'inventory.documents.view',
]

/** Signed-in user with the given permissions and a fresh in-memory purchasing API. */
export function setupPurch(
  options: { permissions?: string[]; db?: Partial<PurchDocsDb> } = {},
): PurchDocsDb {
  const permissions = options.permissions ?? ALL_PURCH2_PERMISSIONS
  const fea = setupFea({ permissions: { [COMPANY_A]: permissions } })
  signIn(fea)
  const db = createPurchDocsDb({ permissions, ...options.db })
  server.use(...purchDocsHandlers(db))
  return db
}

/** Renders the purchasing route tables (guards + lazy pages) at `path`. */
export function renderPurch(path: string) {
  return renderRoutes(
    [
      {
        path: '/',
        children: [
          ...purchaseReceiptsRoutes,
          ...purchaseInvoicesRoutes,
          ...purchaseReturnsRoutes,
          ...purchaseReportsRoutes,
        ],
      },
    ],
    path,
  )
}
