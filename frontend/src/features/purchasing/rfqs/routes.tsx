import type { RouteObject } from 'react-router'
import { PURCH_ACCESS } from '../shared/permissions'
import { guarded } from '../shared/routing'

const page = async () => ({
  Component: (await import('./pages/RfqPage')).RfqPage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const purchaseRfqsRoutes: RouteObject[] = [
  guarded(PURCH_ACCESS.rfqList, [
    {
      path: 'purchasing/rfqs',
      lazy: async () => ({ Component: (await import('./pages/RfqListPage')).RfqListPage }),
    },
    { path: 'purchasing/rfqs/:id', lazy: page },
  ]),
  guarded(PURCH_ACCESS.rfqNew, [{ path: 'purchasing/rfqs/new', lazy: page }]),
]
