import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { catalogHandlers, createCatalogDb, type CatalogDb } from '@/test/handlers/catalog'
import { server } from '@/test/msw/server'
import { catalogRoutes } from './routes'

export const ALL_CATALOG_PERMISSIONS = [
  'items.view',
  'items.create',
  'items.update',
  'items.delete',
  'units.manage',
  'item_categories.manage',
  'price_lists.view',
  'price_lists.create',
  'price_lists.update',
  'price_lists.delete',
  'discount_rules.manage',
  'pricing.view',
]

/** Signed-in user with the given catalog permissions and a fresh in-memory catalog API. */
export function setupCatalog(
  options: { permissions?: string[]; db?: Partial<CatalogDb> } = {},
): CatalogDb {
  const fea = setupFea({
    permissions: { [COMPANY_A]: options.permissions ?? ALL_CATALOG_PERMISSIONS },
  })
  signIn(fea)
  const db = createCatalogDb(options.db)
  server.use(...catalogHandlers(db))
  return db
}

/** Renders the real catalog route table (guards + lazy pages) at `path`. */
export function renderCatalog(path: string) {
  return renderRoutes([{ path: '/', children: catalogRoutes }], path)
}
