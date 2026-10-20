import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { Providers } from '@/app/providers'
import { usePaletteStore } from '@/features/command-palette/store'
import { applyMe, bindAuthFailures } from '@/features/auth/session'
import { createQueryClient } from '@/lib/queryClient'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { server } from '@/test/msw/server'
import { createFeaDb, feaHandlers, type FeaDb } from './fea'

/** Fresh stores and a fresh fake backend for each test. */
export function setupFea(overrides: Partial<FeaDb> = {}): FeaDb {
  useAuthStore.setState({ status: 'unknown', user: null, permissions: {} })
  useCompanyStore.setState({ companies: [], activeCompanyId: null })
  usePaletteStore.setState({ open: false })
  const db = createFeaDb(overrides)
  server.use(...feaHandlers(db))
  return db
}

/** Puts the stores in the signed-in state /auth/me would produce. */
export function signIn(db: FeaDb) {
  db.authenticated = true
  applyMe({ user: db.user, companies: db.companies, permissions: db.permissions })
}

/** Renders a route tree in a memory router with the real providers and auth-failure wiring. */
export function renderRoutes(routes: RouteObject[], initialPath = '/') {
  const router = createMemoryRouter([...routes, { path: '*', element: <p>navigated</p> }], {
    initialEntries: [initialPath],
  })
  const unbind = bindAuthFailures(router)
  const queryClient = createQueryClient()
  const utils = render(
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { router, queryClient, unbind, ...utils }
}
