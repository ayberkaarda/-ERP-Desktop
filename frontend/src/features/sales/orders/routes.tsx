import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { SALES_ACCESS } from '../shared/permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const orderPage = async () => ({
  Component: (await import('./pages/OrderPage')).OrderPage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const ordersRoutes: RouteObject[] = [
  guarded(SALES_ACCESS.orderList, [
    {
      path: 'sales/orders',
      lazy: async () => ({ Component: (await import('./pages/OrderListPage')).OrderListPage }),
    },
    { path: 'sales/orders/:id', lazy: orderPage },
  ]),
  guarded(SALES_ACCESS.orderNew, [{ path: 'sales/orders/new', lazy: orderPage }]),
]
