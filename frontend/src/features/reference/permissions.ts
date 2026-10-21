/** Permission names of the Reference module (<resource>.<action>). */
export const REF_PERMISSIONS = {
  currencies: { view: 'currencies.view', manage: 'currencies.manage' },
  exchangeRates: { view: 'exchange_rates.view', manage: 'exchange_rates.manage' },
  taxCodes: { view: 'tax_codes.view', manage: 'tax_codes.manage' },
  paymentTerms: { view: 'payment_terms.view', manage: 'payment_terms.manage' },
  warehouses: { view: 'warehouses.view', manage: 'warehouses.manage' },
  costCenters: { view: 'cost_centers.view', manage: 'cost_centers.manage' },
  projects: { view: 'projects.view', manage: 'projects.manage' },
  settings: { view: 'settings.view', manage: 'settings.update' },
} as const
