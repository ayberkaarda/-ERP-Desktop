import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { createInvDocsDb, invDocsHandlers, type InvDocsDb } from '@/test/handlers/inventoryDocs'
import { server } from '@/test/msw/server'
import { countsRoutes } from '../counts/routes'
import { inventoryReportsRoutes } from '../reports/routes'
import { reservationsRoutes } from '../reservations/routes'
import { documentsRoutes } from './routes'

export const ALL_INV_DOCS_PERMISSIONS = [
  'inventory.documents.view',
  'inventory.documents.create',
  'inventory.documents.post',
  'inventory.documents.reverse',
  'inventory.stock.view',
  'inventory.reservations.manage',
  'inventory.reports.view',
  'items.view',
]

/** Signed-in user with the given permissions and a fresh in-memory inventory API. */
export function setupInvDocs(
  options: { permissions?: string[]; db?: Partial<InvDocsDb> } = {},
): InvDocsDb {
  const fea = setupFea({
    permissions: { [COMPANY_A]: options.permissions ?? ALL_INV_DOCS_PERMISSIONS },
  })
  signIn(fea)
  const db = createInvDocsDb(options.db)
  server.use(...invDocsHandlers(db))
  return db
}

/** Renders the real route tables of this lane (guards + lazy pages) at `path`. */
export function renderInvDocs(path: string) {
  return renderRoutes(
    [
      {
        path: '/',
        children: [
          ...documentsRoutes,
          ...countsRoutes,
          ...reservationsRoutes,
          ...inventoryReportsRoutes,
        ],
      },
    ],
    path,
  )
}
