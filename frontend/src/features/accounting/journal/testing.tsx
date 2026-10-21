import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import {
  accounting2Handlers,
  createAccounting2Db,
  type Accounting2Db,
} from '@/test/handlers/accounting2'
import { server } from '@/test/msw/server'
import { reportsRoutes } from '../reports/routes'
import { journalRoutes } from './routes'

export const ALL_ACCOUNTING2_PERMISSIONS = [
  'accounting.entries.view',
  'accounting.entries.create',
  'accounting.entries.post',
  'accounting.entries.reverse',
  'accounting.reports.view',
]

/** Signed-in user with the given permissions and a fresh in-memory journal/reports API. */
export function setupAccounting2(
  options: { permissions?: string[]; db?: Partial<Accounting2Db> } = {},
): Accounting2Db {
  const fea = setupFea({
    permissions: { [COMPANY_A]: options.permissions ?? ALL_ACCOUNTING2_PERMISSIONS },
  })
  signIn(fea)
  const db = createAccounting2Db(options.db)
  server.use(...accounting2Handlers(db))
  return db
}

/** Renders the real journal + report route tables (guards + lazy pages) at `path`. */
export function renderAccounting2(path: string) {
  return renderRoutes([{ path: '/', children: [...journalRoutes, ...reportsRoutes] }], path)
}
