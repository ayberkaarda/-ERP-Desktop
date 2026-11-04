// Which API answers make up the page on screen, for the freshness strip.
//
// Each app route that shows records the local copy can answer names the API
// paths of those records (react-router patterns, relative to `/api/v1`). A
// param of the API pattern that the route also has must carry the same value:
// on `/parties/:partyId` only `/parties/<that id>` counts, not another party
// a picker looked up. Lookups (a party or item picker, the names of a line)
// are left out on purpose: the strip tells how fresh the page's own records
// are. A route not listed shows none (dashboard, settings, sync screens).
//
// `pageResources.test.ts` keeps the table honest: every pattern is a route of
// the app, and every resource of the offline manifest is shown by some page.

import { matchPath, type Params } from 'react-router'

/** Route pattern of the app, then the API path patterns of what it shows. */
export const PAGE_RESOURCES: readonly (readonly [route: string, api: readonly string[]])[] = [
  ['/parties', ['/parties']],
  ['/parties/:partyId', ['/parties/:partyId']],
  ['/parties/:partyId/edit', ['/parties/:partyId']],

  ['/catalog/items', ['/items']],
  ['/catalog/items/:id', ['/items/:id', '/items/:id/variants', '/items/:id/barcodes']],
  ['/catalog/categories', ['/item-categories']],
  ['/catalog/units', ['/units', '/unit-conversions']],
  ['/catalog/price-lists', ['/price-lists']],
  ['/catalog/price-lists/:id', ['/price-lists/:id', '/price-lists/:id/lines']],

  ['/reference/currencies', ['/currencies']],
  ['/reference/exchange-rates', ['/exchange-rates']],
  ['/reference/tax-codes', ['/tax-codes']],
  ['/reference/payment-terms', ['/payment-terms']],
  ['/reference/warehouses', ['/warehouses']],
  ['/reference/warehouses/:id', ['/warehouses/:id', '/warehouses/:id/locations']],
  ['/reference/cost-centers', ['/cost-centers']],
  ['/reference/projects', ['/projects']],

  ['/inventory/stock', ['/stock-balances']],
  // Warehouses come from the server (stock-warehouses); their locations are local.
  ['/inventory/warehouses', ['/warehouses/:warehouse/locations']],
  ['/inventory/documents', ['/stock-documents']],
  ['/inventory/documents/:id', ['/stock-documents/:id']],

  ['/sales/quotes', ['/sales-quotes']],
  ['/sales/quotes/:id', ['/sales-quotes/:id']],
  ['/sales/orders', ['/sales-orders']],
  ['/sales/orders/:id', ['/sales-orders/:id']],
  ['/sales/deliveries', ['/sales-deliveries']],
  ['/sales/deliveries/:id', ['/sales-deliveries/:id']],
  ['/sales/deliveries/:id/print', ['/sales-deliveries/:id']],
  ['/sales/invoices', ['/sales-invoices']],
  ['/sales/invoices/:id', ['/sales-invoices/:id']],
  ['/sales/invoices/:id/print', ['/sales-invoices/:id']],
  ['/sales/returns', ['/sales-returns']],
  ['/sales/returns/:id', ['/sales-returns/:id']],
  ['/sales/returns/:id/print', ['/sales-returns/:id']],

  ['/purchasing/requests', ['/purchase-requests']],
  ['/purchasing/requests/:id', ['/purchase-requests/:id']],
  ['/purchasing/rfqs', ['/purchase-rfqs']],
  ['/purchasing/rfqs/:id', ['/purchase-rfqs/:id']],
  ['/purchasing/orders', ['/purchase-orders']],
  ['/purchasing/orders/:id', ['/purchase-orders/:id']],
  ['/purchasing/receipts', ['/purchase-receipts']],
  ['/purchasing/receipts/:id', ['/purchase-receipts/:id']],
  ['/purchasing/receipts/:id/print', ['/purchase-receipts/:id']],
  ['/purchasing/invoices', ['/purchase-invoices']],
  ['/purchasing/invoices/:id', ['/purchase-invoices/:id']],
  ['/purchasing/invoices/:id/print', ['/purchase-invoices/:id']],
  ['/purchasing/returns', ['/purchase-returns']],
  ['/purchasing/returns/:id', ['/purchase-returns/:id']],
  ['/purchasing/returns/:id/print', ['/purchase-returns/:id']],

  ['/treasury/reports/:slug', ['/treasury-reports/:slug']],
]

/** The API answers of one page. */
export interface PageScope {
  /** Whether the answer of `apiPath` (no query, as the offline meta keys it) is on the page. */
  shows(apiPath: string): boolean
}

/** A page that shows no local answer. */
export const NO_PAGE: PageScope = { shows: () => false }

function sameShared(api: Params, route: Params): boolean {
  return Object.entries(api).every(([name, value]) => !(name in route) || route[name] === value)
}

/** What the page at `pathname` shows; a route not in the table shows nothing. */
export function pageScope(pathname: string): PageScope {
  for (const [route, api] of PAGE_RESOURCES) {
    const page = matchPath({ path: route, end: true }, pathname)
    if (!page) continue
    return {
      shows: (apiPath) =>
        api.some((pattern) => {
          const answer = matchPath({ path: pattern, end: true }, apiPath)
          return answer !== null && sameShared(answer.params, page.params)
        }),
    }
  }
  return NO_PAGE
}
