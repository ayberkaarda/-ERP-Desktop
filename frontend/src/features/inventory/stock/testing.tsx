import type { RouteObject } from 'react-router'
import { catalogHandlers, createCatalogDb } from '@/test/handlers/catalog'
import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import {
  createInventoryStockDb,
  inventoryStockHandlers,
  type InventoryStockDb,
} from '@/test/handlers/inventoryStock'
import { server } from '@/test/msw/server'
import { lotsRoutes } from '../lots/routes'
import { movementsRoutes } from '../movements/routes'
import { warehousesRoutes } from '../warehouses/routes'
import { INV_PERMISSIONS } from './lib/permissions'
import { stockRoutes } from './routes'

export const ALL_INVENTORY_STOCK_PERMISSIONS = [
  INV_PERMISSIONS.warehouses.view,
  INV_PERMISSIONS.warehouses.manage,
  INV_PERMISSIONS.stock.view,
  INV_PERMISSIONS.documents.view,
  INV_PERMISSIONS.entries.view,
  'items.view',
]

/** Signed-in user with the given permissions, a fresh in-memory inventory and catalog API. */
export function setupInventoryStock(
  options: { permissions?: string[]; db?: Partial<InventoryStockDb> } = {},
): InventoryStockDb {
  const fea = setupFea({
    permissions: { [COMPANY_A]: options.permissions ?? ALL_INVENTORY_STOCK_PERMISSIONS },
  })
  signIn(fea)
  server.use(...catalogHandlers(createCatalogDb()))
  const db = createInventoryStockDb(options.db)
  server.use(...inventoryStockHandlers(db))
  return db
}

const routes: RouteObject[] = [
  ...warehousesRoutes,
  ...stockRoutes,
  ...movementsRoutes,
  ...lotsRoutes,
]

/** Renders the real route modules (guards + lazy pages) at `path`. */
export function renderInventoryStock(path: string) {
  try {
    window.localStorage.clear()
  } catch {
    // Storage may be blocked in the test environment.
  }
  return renderRoutes([{ path: '/', children: routes }], path)
}
