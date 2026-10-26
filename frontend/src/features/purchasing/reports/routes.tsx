import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { PURCH_OPEN } from '../invoices/kit/permissions'
import { REPORTS } from './definitions'

const reportPage = async () => ({
  Component: (await import('./pages/PurchaseReportPage')).PurchaseReportPage,
})

// Mounted under the authenticated shell; paths are relative to "/". Each report has its own
// guard; the page reads `handle.report`.
export const purchaseReportsRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={PURCH_OPEN.reports} />,
    children: [
      {
        path: 'purchasing/reports',
        lazy: async () => ({
          Component: (await import('./pages/PurchaseReportsHubPage')).PurchaseReportsHubPage,
        }),
      },
    ],
  },
  ...REPORTS.map((r): RouteObject => ({
    element: <RequireAuth permission={r.permission} />,
    children: [
      { path: `purchasing/reports/${r.slug}`, handle: { report: r.slug }, lazy: reportPage },
    ],
  })),
]
