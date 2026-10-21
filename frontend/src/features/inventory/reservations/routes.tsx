import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { INV_OPEN } from '../documents/permissions'

// Read (stock viewers) or manage opens the list; releasing needs inventory.reservations.manage.
export const reservationsRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={INV_OPEN.reservations} />,
    children: [
      {
        path: 'inventory/reservations',
        lazy: async () => ({
          Component: (await import('./pages/ReservationListPage')).ReservationListPage,
        }),
      },
    ],
  },
]
