import { COMPANY_A } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { createPartiesDb, partiesHandlers, type PartiesDb } from '@/test/handlers/parties'
import { server } from '@/test/msw/server'
import { partyRoutes } from './routes'

export const ALL_PARTY_PERMISSIONS = [
  'parties.view',
  'parties.create',
  'parties.update',
  'parties.delete',
  'parties.export',
]

/** Signed-in user in company A with the given permissions and a fresh fake Parties API. */
export function setupParties(
  seed: Partial<PartiesDb> = {},
  permissions: string[] = ALL_PARTY_PERMISSIONS,
): PartiesDb {
  const fea = setupFea({ permissions: { [COMPANY_A]: permissions } })
  signIn(fea)
  const db = createPartiesDb(seed)
  server.use(...partiesHandlers(db))
  return db
}

export function renderParties(path: string) {
  return renderRoutes(partyRoutes, path)
}

/** Narrows a query result in tests, failing loudly when it is missing. */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Expected element is missing')
  return value
}
