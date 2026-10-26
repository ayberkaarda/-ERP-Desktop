import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { Layout } from './Layout'
export const edocumentsRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission="edocuments.view" />,
    children: [
      {
        element: <Layout />,
        children: [
          {
            path: 'edocuments/outbox',
            lazy: async () => {
              const { ListPage } = await import('./ListPage')
              return { Component: () => <ListPage direction="outgoing" /> }
            },
          },
          {
            path: 'edocuments/inbox',
            lazy: async () => {
              const { ListPage } = await import('./ListPage')
              return { Component: () => <ListPage direction="incoming" /> }
            },
          },
          {
            path: 'edocuments/taxpayers',
            lazy: async () => ({ Component: (await import('./TaxpayersPage')).TaxpayersPage }),
          },
          {
            path: 'edocuments/documents/:id',
            lazy: async () => ({ Component: (await import('./DocumentPage')).DocumentPage }),
          },
          {
            path: 'edocuments/documents/:id/print',
            lazy: async () => ({ Component: (await import('./SnapshotSheet')).PrintPage }),
          },
          {
            element: <RequireAuth permission="edocuments.create" />,
            children: [
              {
                path: 'edocuments/outbox/new',
                lazy: async () => ({ Component: (await import('./CreatePage')).CreatePage }),
              },
            ],
          },
        ],
      },
    ],
  },
]
