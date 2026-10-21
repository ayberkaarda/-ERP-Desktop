import { REF_PERMISSIONS } from './permissions'

export const REFERENCE_ROUTES = [
  { key: 'currencies', path: '/reference/currencies', permission: REF_PERMISSIONS.currencies.view },
  {
    key: 'exchangeRates',
    path: '/reference/exchange-rates',
    permission: REF_PERMISSIONS.exchangeRates.view,
  },
  { key: 'taxCodes', path: '/reference/tax-codes', permission: REF_PERMISSIONS.taxCodes.view },
  {
    key: 'paymentTerms',
    path: '/reference/payment-terms',
    permission: REF_PERMISSIONS.paymentTerms.view,
  },
  {
    key: 'warehouses',
    path: '/reference/warehouses',
    permission: REF_PERMISSIONS.warehouses.view,
  },
  {
    key: 'costCenters',
    path: '/reference/cost-centers',
    permission: REF_PERMISSIONS.costCenters.view,
  },
  { key: 'projects', path: '/reference/projects', permission: REF_PERMISSIONS.projects.view },
  { key: 'settings', path: '/reference/settings', permission: REF_PERMISSIONS.settings.view },
] as const
