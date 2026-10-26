import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { createTreasuryDb, treasuryHandlers } from '@/test/handlers/treasury'
import { server } from '@/test/msw/server'
import { treasuryRoutes } from '../routes'
export const TREASURY_PERMISSIONS = [
  'treasury.accounts.view',
  'treasury.accounts.manage',
  ...['payments', 'transfers', 'plans', 'instruments'].flatMap((area) =>
    ['view', 'create', 'update', 'delete', 'post', 'reverse', 'fulfil', 'endorse', 'clear'].map(
      (action) => `treasury.${area}.${action}`,
    ),
  ),
  'treasury.banking.view',
  'treasury.banking.import',
  'treasury.banking.reconcile',
  'treasury.banking.reopen',
  'treasury.reports.view',
  'treasury.open_items.view',
  'sales.invoices.view',
  'purchasing.invoices.view',
  'parties.view',
]
export function setupTreasury(permissions = TREASURY_PERMISSIONS) {
  const auth = setupFea({ permissions: { [COMPANY_A]: permissions } })
  signIn(auth)
  const db = createTreasuryDb()
  server.use(...treasuryHandlers(db))
  return db
}
export const renderTreasury = (path: string) =>
  renderRoutes([{ path: '/', children: treasuryRoutes }], path)
