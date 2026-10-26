import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import type { PermissionRequirement } from '@/lib/permissions'
import { SALES_OPEN } from '../invoices/kit/permissions'

function guarded(permission: PermissionRequirement, children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

const deliveryPage = async () => ({
  Component: (await import('./pages/DeliveryPage')).DeliveryPage,
})

// Mounted under the authenticated shell; paths are relative to "/".
export const salesDeliveriesRoutes: RouteObject[] = [
  guarded(SALES_OPEN.deliveries, [
    {
      path: 'sales/deliveries',
      lazy: async () => ({
        Component: (await import('./pages/DeliveryListPage')).DeliveryListPage,
      }),
    },
    { path: 'sales/deliveries/:id', lazy: deliveryPage },
    {
      path: 'sales/deliveries/:id/print',
      lazy: async () => ({
        Component: (await import('./pages/DeliveryPrintPage')).DeliveryPrintPage,
      }),
    },
  ]),
  // ?order=<id> starts from an order; without it a direct delivery (company setting).
  guarded(SALES_OPEN.newDelivery, [{ path: 'sales/deliveries/new', lazy: deliveryPage }]),
]
