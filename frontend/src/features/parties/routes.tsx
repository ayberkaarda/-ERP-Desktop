import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'

/** Children of the app shell route; every page is its own lazy chunk. */
export const partyRoutes: RouteObject[] = [
  {
    path: 'parties',
    element: <RequireAuth permission="parties.view" />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('./pages/PartyListPage')).PartyListPage,
        }),
      },
      {
        path: 'new',
        element: <RequireAuth permission="parties.create" />,
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('./pages/PartyCreatePage')).PartyCreatePage,
            }),
          },
        ],
      },
      {
        path: ':partyId',
        lazy: async () => ({
          Component: (await import('./pages/PartyDetailPage')).PartyDetailPage,
        }),
      },
      {
        path: ':partyId/edit',
        element: <RequireAuth permission="parties.update" />,
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('./pages/PartyEditPage')).PartyEditPage,
            }),
          },
        ],
      },
    ],
  },
]
