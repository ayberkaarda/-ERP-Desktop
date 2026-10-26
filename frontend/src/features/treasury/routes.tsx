import type { RouteObject } from 'react-router'
import { Outlet } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { permission, type Area } from './shared/types'

const areas: Area[] = ['accounts', 'payments', 'transfers', 'instruments', 'banking', 'plans']
const treasuryChildren: RouteObject[] = [
  ...areas.flatMap((area): RouteObject[] => [
    {
      element: <RequireAuth permission={permission(area, 'view')} />,
      children: [
        {
          path: `treasury/${area}`,
          lazy: async () => {
            const { ListPage } = await import('./shared/ListPage')
            return { Component: () => <ListPage area={area} /> }
          },
        },
        {
          path: `treasury/${area}/:id`,
          lazy: async () => {
            const { RecordPage } = await import('./shared/RecordPage')
            return { Component: () => <RecordPage area={area} /> }
          },
        },
      ],
    },
    {
      element: (
        <RequireAuth
          permission={
            area === 'accounts'
              ? 'treasury.accounts.manage'
              : permission(area, area === 'banking' ? 'import' : 'create')
          }
        />
      ),
      children: [
        {
          path: `treasury/${area}/new`,
          lazy: async () => {
            const { RecordPage } = await import('./shared/RecordPage')
            return { Component: () => <RecordPage area={area} /> }
          },
        },
      ],
    },
  ]),
  {
    element: <RequireAuth permission="treasury.reports.view" />,
    children: [
      {
        path: 'treasury/reports',
        lazy: async () => ({ Component: (await import('./reports/ReportsPage')).ReportsHub }),
      },
      {
        path: 'treasury/reports/:slug',
        lazy: async () => ({ Component: (await import('./reports/ReportsPage')).ReportsPage }),
      },
    ],
  },
]

export const treasuryRoutes: RouteObject[] = [
  {
    element: (
      <div className="space-y-6 p-6">
        <Outlet />
      </div>
    ),
    children: treasuryChildren,
  },
]
