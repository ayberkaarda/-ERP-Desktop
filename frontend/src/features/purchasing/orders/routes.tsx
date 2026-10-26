import type { RouteObject } from 'react-router'
import { guarded } from '../shared/routing'
import { PURCH_ACCESS } from '../shared/permissions'

const orderPage = async () => ({
  Component: (await import('./pages/OrderPage')).OrderPage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const purchaseOrdersRoutes: RouteObject[] = [
  guarded(PURCH_ACCESS.orderList, [
    {
      path: 'purchasing/orders',
      lazy: async () => ({ Component: (await import('./pages/OrderListPage')).OrderListPage }),
    },
    { path: 'purchasing/orders/:id', lazy: orderPage },
  ]),
  guarded(PURCH_ACCESS.orderNew, [{ path: 'purchasing/orders/new', lazy: orderPage }]),
]
