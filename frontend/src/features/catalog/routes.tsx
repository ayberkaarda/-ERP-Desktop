import type { RouteObject } from 'react-router'
import { RequireAuth } from '@/app/guards'

/** Wraps lazy pages in a permission guard (forbidden state when the company lacks it). */
function guarded(permission: string | string[], children: RouteObject[]): RouteObject {
  return { element: <RequireAuth permission={permission} />, children }
}

// Mounted under the authenticated shell; paths are relative to "/".
export const catalogRoutes: RouteObject[] = [
  guarded('units.manage', [
    {
      path: 'catalog/units',
      lazy: async () => ({ Component: (await import('./pages/UnitsPage')).UnitsPage }),
    },
  ]),
  guarded('item_categories.manage', [
    {
      path: 'catalog/categories',
      lazy: async () => ({ Component: (await import('./pages/CategoriesPage')).CategoriesPage }),
    },
  ]),
  guarded('items.view', [
    {
      path: 'catalog/items',
      lazy: async () => ({ Component: (await import('./pages/ItemListPage')).ItemListPage }),
    },
    {
      path: 'catalog/items/:id',
      lazy: async () => ({ Component: (await import('./pages/ItemFormPage')).ItemFormPage }),
    },
  ]),
  guarded(
    ['items.view', 'items.create'],
    [
      {
        path: 'catalog/items/new',
        lazy: async () => ({ Component: (await import('./pages/ItemFormPage')).ItemFormPage }),
      },
    ],
  ),
  guarded('price_lists.view', [
    {
      path: 'catalog/price-lists',
      lazy: async () => ({
        Component: (await import('./pages/PriceListListPage')).PriceListListPage,
      }),
    },
    {
      path: 'catalog/price-lists/:id',
      lazy: async () => ({
        Component: (await import('./pages/PriceListFormPage')).PriceListFormPage,
      }),
    },
  ]),
  guarded(
    ['price_lists.view', 'price_lists.create'],
    [
      {
        path: 'catalog/price-lists/new',
        lazy: async () => ({
          Component: (await import('./pages/PriceListFormPage')).PriceListFormPage,
        }),
      },
    ],
  ),
  guarded('discount_rules.manage', [
    {
      path: 'catalog/discount-rules',
      lazy: async () => ({
        Component: (await import('./pages/DiscountRulesPage')).DiscountRulesPage,
      }),
    },
  ]),
  guarded('pricing.view', [
    {
      path: 'catalog/pricing',
      lazy: async () => ({
        Component: (await import('./pages/PricingPlaygroundPage')).PricingPlaygroundPage,
      }),
    },
  ]),
]
