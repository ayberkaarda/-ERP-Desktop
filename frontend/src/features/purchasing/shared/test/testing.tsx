import { resetLabelCache } from '@/features/sales/shared/lib/labels'
import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { server } from '@/test/msw/server'
import { purchaseOrdersRoutes } from '../../orders/routes'
import { purchaseRequestsRoutes } from '../../requests/routes'
import { purchaseRfqsRoutes } from '../../rfqs/routes'
import { createPurchDb, purchHandlers, type PurchDb } from './handlers'

export const ALL_PURCH_PERMISSIONS = [
  'purchasing.requests.view',
  'purchasing.requests.create',
  'purchasing.requests.update',
  'purchasing.requests.delete',
  'purchasing.rfqs.view',
  'purchasing.rfqs.create',
  'purchasing.rfqs.update',
  'purchasing.rfqs.delete',
  'purchasing.rfqs.award',
  'purchasing.orders.view',
  'purchasing.orders.create',
  'purchasing.orders.update',
  'purchasing.orders.delete',
  'purchasing.orders.approve',
  'purchasing.receipts.create',
  'purchasing.invoices.create',
  'purchasing.invoices.view',
  'settings.view',
  'items.view',
  'parties.view',
]

/** Signed-in user with the given permissions and a fresh in-memory purchasing API. */
export function setupPurch(
  options: { permissions?: string[]; db?: Partial<PurchDb> } = {},
): PurchDb {
  const permissions = options.permissions ?? ALL_PURCH_PERMISSIONS
  const fea = setupFea({ permissions: { [COMPANY_A]: permissions } })
  signIn(fea)
  resetLabelCache()
  const db = createPurchDb({ permissions, ...options.db })
  server.use(...purchHandlers(db))
  return db
}

export const without = (...names: string[]) =>
  ALL_PURCH_PERMISSIONS.filter((p) => !names.includes(p))

/** Renders the real route tables of this lane (guards + lazy pages) at `path`. */
export function renderPurch(path: string) {
  return renderRoutes(
    [
      {
        path: '/',
        children: [...purchaseRequestsRoutes, ...purchaseRfqsRoutes, ...purchaseOrdersRoutes],
      },
    ],
    path,
  )
}
