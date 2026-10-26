import type { RouteObject } from 'react-router'
import { PURCH_ACCESS } from '../shared/permissions'
import { guarded } from '../shared/routing'

const page = async () => ({
  Component: (await import('./pages/RequestPage')).RequestPage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const purchaseRequestsRoutes: RouteObject[] = [
  guarded(PURCH_ACCESS.requestList, [
    {
      path: 'purchasing/requests',
      lazy: async () => ({ Component: (await import('./pages/RequestListPage')).RequestListPage }),
    },
    { path: 'purchasing/requests/:id', lazy: page },
  ]),
  guarded(PURCH_ACCESS.requestNew, [{ path: 'purchasing/requests/new', lazy: page }]),
]
