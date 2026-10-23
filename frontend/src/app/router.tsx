import { treasuryRoutes } from '@/features/treasury/routes'
import { assistantRoutes } from '@/features/assistant/routes'
import { purchaseRequestsRoutes } from '@/features/purchasing/requests/routes'
import { purchaseRfqsRoutes } from '@/features/purchasing/rfqs/routes'
import { purchaseOrdersRoutes } from '@/features/purchasing/orders/routes'
import { purchaseReceiptsRoutes } from '@/features/purchasing/receipts/routes'
import { purchaseInvoicesRoutes } from '@/features/purchasing/invoices/routes'
import { purchaseReturnsRoutes } from '@/features/purchasing/returns/routes'
import { purchaseReportsRoutes } from '@/features/purchasing/reports/routes'
import { createBrowserRouter, type RouteObject } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { accountsRoutes } from '@/features/accounting/accounts/routes'
import { determinationRoutes } from '@/features/accounting/determination/routes'
import { fiscalRoutes } from '@/features/accounting/fiscal/routes'
import { journalRoutes } from '@/features/accounting/journal/routes'
import { periodsRoutes } from '@/features/accounting/periods/routes'
import { reportsRoutes } from '@/features/accounting/reports/routes'
import { bindAuthFailures } from '@/features/auth/session'
import { catalogRoutes } from '@/features/catalog/routes'
import { countsRoutes } from '@/features/inventory/counts/routes'
import { documentsRoutes } from '@/features/inventory/documents/routes'
import { lotsRoutes } from '@/features/inventory/lots/routes'
import { movementsRoutes } from '@/features/inventory/movements/routes'
import { inventoryReportsRoutes } from '@/features/inventory/reports/routes'
import { reservationsRoutes } from '@/features/inventory/reservations/routes'
import { stockRoutes } from '@/features/inventory/stock/routes'
import { warehousesRoutes } from '@/features/inventory/warehouses/routes'
import { partyRoutes } from '@/features/parties/routes'
import { referenceRoutes } from '@/features/reference/routes'
import { salesDeliveriesRoutes } from '@/features/sales/deliveries/routes'
import { salesInvoicesRoutes } from '@/features/sales/invoices/routes'
import { ordersRoutes } from '@/features/sales/orders/routes'
import { quotesRoutes } from '@/features/sales/quotes/routes'
import { salesReportsRoutes } from '@/features/sales/reports/routes'
import { salesReturnsRoutes } from '@/features/sales/returns/routes'
import { GuestOnly, RequireAuth } from './guards'
import { RouteError } from './RouteError'

// Dev-only routes (e.g. /showcase) live in an optional ./devRoutes.tsx exporting `devRoutes`;
// the glob keeps this file compiling whether or not it exists.
const devModules = import.meta.env.DEV
  ? import.meta.glob<{ devRoutes?: RouteObject[] }>('./devRoutes.tsx', { eager: true })
  : {}
const devRoutes = Object.values(devModules).flatMap((m) => m.devRoutes ?? [])

// Each page is its own chunk; modules add their routes here as they land.
export const routes: RouteObject[] = [
  {
    path: '/login',
    element: <GuestOnly />,
    errorElement: <RouteError />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('@/features/auth/pages/LoginPage')).LoginPage,
        }),
      },
    ],
  },
  {
    path: '/password/change',
    element: <RequireAuth allowPasswordChange />,
    errorElement: <RouteError />,
    children: [
      {
        index: true,
        lazy: async () => ({
          Component: (await import('@/features/auth/pages/ForcePasswordChangePage'))
            .ForcePasswordChangePage,
        }),
      },
    ],
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          {
            index: true,
            lazy: async () => ({
              Component: (await import('@/features/dashboard/pages/DashboardPage')).DashboardPage,
            }),
          },
          {
            path: 'system/health',
            lazy: async () => ({
              Component: (await import('@/features/system/pages/HealthPage')).HealthPage,
            }),
          },
          {
            path: 'profile/security',
            lazy: async () => ({
              Component: (await import('@/features/auth/pages/SecurityPage')).SecurityPage,
            }),
          },
          ...treasuryRoutes,
          ...assistantRoutes,
          ...partyRoutes,
          ...catalogRoutes,
          ...referenceRoutes,
          ...accountsRoutes,
          ...fiscalRoutes,
          ...periodsRoutes,
          ...determinationRoutes,
          ...journalRoutes,
          ...reportsRoutes,
          ...warehousesRoutes,
          ...stockRoutes,
          ...movementsRoutes,
          ...lotsRoutes,
          ...documentsRoutes,
          ...countsRoutes,
          ...reservationsRoutes,
          ...inventoryReportsRoutes,
          ...quotesRoutes,
          ...ordersRoutes,
          ...salesDeliveriesRoutes,
          ...salesInvoicesRoutes,
          ...salesReturnsRoutes,
          ...salesReportsRoutes,
          ...purchaseRequestsRoutes,
          ...purchaseRfqsRoutes,
          ...purchaseOrdersRoutes,
          ...purchaseReceiptsRoutes,
          ...purchaseInvoicesRoutes,
          ...purchaseReturnsRoutes,
          ...purchaseReportsRoutes,
          ...devRoutes,
          {
            path: '*',
            lazy: async () => ({
              Component: (await import('@/components/shared/NotFound')).NotFound,
            }),
          },
        ],
      },
    ],
  },
]

export function createRouter() {
  const router = createBrowserRouter(routes)
  bindAuthFailures(router)
  return router
}
