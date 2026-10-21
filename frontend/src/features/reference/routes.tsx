import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'
import { REF_PERMISSIONS } from './permissions'

/** A lazily loaded page behind a permission guard (the shell already requires a session). */
function guarded(
  permission: string,
  load: () => Promise<ComponentType>,
): Pick<RouteObject, 'lazy'> {
  return {
    lazy: async () => {
      const Page = await load()
      return {
        Component: () => (
          <RequireAuth permission={permission}>
            <Page />
          </RequireAuth>
        ),
      }
    },
  }
}

/**
 * Child routes of the authenticated app shell; the chief spreads them into router.tsx.
 * Paths are absolute-looking segments below the shell route ("reference/...").
 */
export const referenceRoutes: RouteObject[] = [
  {
    path: 'reference',
    children: [
      {
        index: true,
        lazy: async () => {
          const { Navigate } = await import('react-router')
          return { Component: () => <Navigate to="currencies" replace /> }
        },
      },
      {
        path: 'currencies',
        ...guarded(
          REF_PERMISSIONS.currencies.view,
          async () => (await import('./pages/CurrenciesPage')).CurrenciesPage,
        ),
      },
      {
        path: 'exchange-rates',
        ...guarded(
          REF_PERMISSIONS.exchangeRates.view,
          async () => (await import('./pages/ExchangeRatesPage')).ExchangeRatesPage,
        ),
      },
      {
        path: 'tax-codes',
        ...guarded(
          REF_PERMISSIONS.taxCodes.view,
          async () => (await import('./pages/TaxCodesPage')).TaxCodesPage,
        ),
      },
      {
        path: 'payment-terms',
        ...guarded(
          REF_PERMISSIONS.paymentTerms.view,
          async () => (await import('./pages/PaymentTermsPage')).PaymentTermsPage,
        ),
      },
      {
        path: 'warehouses',
        ...guarded(
          REF_PERMISSIONS.warehouses.view,
          async () => (await import('./pages/WarehousesPage')).WarehousesPage,
        ),
      },
      {
        path: 'warehouses/:id',
        ...guarded(
          REF_PERMISSIONS.warehouses.view,
          async () => (await import('./pages/WarehouseDetailPage')).WarehouseDetailPage,
        ),
      },
      {
        path: 'cost-centers',
        ...guarded(
          REF_PERMISSIONS.costCenters.view,
          async () => (await import('./pages/CostCentersPage')).CostCentersPage,
        ),
      },
      {
        path: 'projects',
        ...guarded(
          REF_PERMISSIONS.projects.view,
          async () => (await import('./pages/ProjectsPage')).ProjectsPage,
        ),
      },
      {
        path: 'settings',
        ...guarded(
          REF_PERMISSIONS.settings.view,
          async () => (await import('./pages/ReferenceSettingsPage')).ReferenceSettingsPage,
        ),
      },
    ],
  },
]
