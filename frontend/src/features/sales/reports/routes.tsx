import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { SALES_OPEN } from '../invoices/kit/permissions'
import { REPORTS } from './definitions'

const reportPage = async () => ({
  Component: (await import('./pages/SalesReportPage')).SalesReportPage,
})

// Mounted under the authenticated shell; paths are relative to "/". Each report has its own
// guard; the page reads `handle.report`.
export const salesReportsRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={SALES_OPEN.reports} />,
    children: [
      {
        path: 'sales/reports',
        lazy: async () => ({
          Component: (await import('./pages/SalesReportsHubPage')).SalesReportsHubPage,
        }),
      },
    ],
  },
  ...REPORTS.map((r): RouteObject => ({
    element: <RequireAuth permission={r.permission} />,
    children: [{ path: `sales/reports/${r.slug}`, handle: { report: r.slug }, lazy: reportPage }],
  })),
]
