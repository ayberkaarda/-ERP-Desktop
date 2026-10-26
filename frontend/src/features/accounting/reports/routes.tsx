import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'

// Mounted under the authenticated shell; paths are relative to "/".
export const reportsRoutes: RouteObject[] = [
  {
    element: <RequireAuth permission="accounting.reports.view" />,
    children: [
      {
        path: 'accounting/reports/trial-balance',
        lazy: async () => ({
          Component: (await import('./pages/TrialBalancePage')).TrialBalancePage,
        }),
      },
      {
        path: 'accounting/reports/general-ledger',
        lazy: async () => ({
          Component: (await import('./pages/GeneralLedgerPage')).GeneralLedgerPage,
        }),
      },
      {
        path: 'accounting/reports/journal-book',
        lazy: async () => ({
          Component: (await import('./pages/JournalBookPage')).JournalBookPage,
        }),
      },
    ],
  },
]
