import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { INV_ACCESS } from '../stock/lib/permissions'

// Mounted under the authenticated shell; paths are relative to "/".
export const warehousesRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={INV_ACCESS.warehouses} />,
    children: [
      {
        path: 'inventory/warehouses',
        lazy: async () => ({
          Component: (await import('./pages/WarehousesPage')).WarehousesPage,
        }),
      },
    ],
  },
]
