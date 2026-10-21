/**
 * Permission names of the Reference module, as declared in backend Modules/Reference/permissions.php
 * (<resource>.view|create|update|delete; exchange rates use one `manage`; locations reuse the
 * warehouse permissions: view to read, update to write).
 */
const crud = (resource: string) =>
  ({
    view: `${resource}.view`,
    create: `${resource}.create`,
    update: `${resource}.update`,
    delete: `${resource}.delete`,
  }) as const

export const REF_PERMISSIONS = {
  currencies: { view: 'currencies.view', update: 'currencies.update' },
  exchangeRates: { view: 'exchange_rates.view', manage: 'exchange_rates.manage' },
  taxCodes: crud('tax_codes'),
  paymentTerms: crud('payment_terms'),
  warehouses: crud('warehouses'),
  costCenters: crud('cost_centers'),
  projects: crud('projects'),
  settings: { view: 'settings.view', update: 'settings.update' },
} as const
