import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { anyOf } from '@/lib/permissions'
import { INV_PERMS } from '../documents/permissions'
import { REPORTS } from './definitions'

const reportPage = async () => ({
  Component: (await import('./pages/InventoryReportPage')).InventoryReportPage,
})

// Mounted under the authenticated shell; paths are relative to "/". Each report has its own
// guard (reorder suggestions also open for stock viewers); the page reads `handle.report`.
export const inventoryReportsRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission={anyOf(INV_PERMS.reportsView, INV_PERMS.stockView)} />,
    children: [
      {
        path: 'inventory/reports',
        lazy: async () => ({
          Component: (await import('./pages/ReportsHubPage')).ReportsHubPage,
        }),
      },
    ],
  },
  ...REPORTS.map((r): RouteObject => ({
    element: <RequireAuth permission={r.permission} />,
    children: [
      { path: `inventory/reports/${r.slug}`, handle: { report: r.slug }, lazy: reportPage },
    ],
  })),
]
