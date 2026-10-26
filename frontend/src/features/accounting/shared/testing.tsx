import type { RouteObject } from 'react-router'
import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import {
  accountingHandlers,
  createAccountingDb,
  type AccountingDb,
} from '@/test/handlers/accounting1'
import { server } from '@/test/msw/server'
import { accountsRoutes } from '../accounts/routes'
import { determinationRoutes } from '../determination/routes'
import { fiscalRoutes } from '../fiscal/routes'
import { periodsRoutes } from '../periods/routes'
import { ACC_PERMISSIONS } from './permissions'

export const ALL_ACCOUNTING_PERMISSIONS = [
  ACC_PERMISSIONS.accounts.view,
  ACC_PERMISSIONS.accounts.manage,
  ACC_PERMISSIONS.periods.view,
  ACC_PERMISSIONS.periods.manage,
  ACC_PERMISSIONS.periods.close,
  ACC_PERMISSIONS.periods.reopen,
  ACC_PERMISSIONS.year.close,
  ACC_PERMISSIONS.determination.manage,
]

/** Signed-in user with the given permissions and a fresh in-memory accounting API. */
export function setupAccounting(
  options: { permissions?: string[]; db?: Partial<AccountingDb> } = {},
): AccountingDb {
  const fea = setupFea({
    permissions: { [COMPANY_A]: options.permissions ?? ALL_ACCOUNTING_PERMISSIONS },
  })
  signIn(fea)
  const db = createAccountingDb(options.db)
  server.use(...accountingHandlers(db))
  return db
}

const routes: RouteObject[] = [
  ...accountsRoutes,
  ...fiscalRoutes,
  ...periodsRoutes,
  ...determinationRoutes,
]

/** Renders the real route modules (guards + lazy pages) at `path`. */
export function renderAccounting(path: string) {
  try {
    window.localStorage.clear()
  } catch {
    // Storage may be blocked in the test environment.
  }
  return renderRoutes([{ path: '/', children: routes }], path)
}
