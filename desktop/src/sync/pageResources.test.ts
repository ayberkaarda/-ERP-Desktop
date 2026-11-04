import { matchPath, type RouteObject } from 'react-router'
import { describe, expect, it } from 'vitest'

import manifest from '../../../contracts/offline-manifest.json'
import { NO_PAGE, PAGE_RESOURCES, pageScope } from './pageResources'
import { routes } from '@/app/router'

/** Every full route path of the app (layout routes without a path add nothing). */
function routePaths(list: RouteObject[], parent = ''): string[] {
  return list.flatMap((route) => {
    const own = route.path ?? ''
    const full = own.startsWith('/') ? own : `${parent.replace(/\/$/, '')}/${own}`.replace(/\/+$/, '') || '/'
    const here = route.path !== undefined ? [full] : []
    return [...here, ...routePaths(route.children ?? [], route.path !== undefined ? full : parent)]
  })
}

interface ManifestResource {
  path: string
  children?: { path: string }[]
}

const API_PREFIX = manifest.api_prefix
/** Each list path of the offline manifest, `{param}` as a sample segment. */
const manifestPaths = (manifest.resources as ManifestResource[])
  .flatMap((r) => [r.path, ...(r.children ?? []).map((c) => c.path)])
  .map((path) => path.slice(API_PREFIX.length).replace(/\{[^}]+\}/g, 'x-1'))

describe('page resources table', () => {
  it('names routes the app has', () => {
    const known = new Set(routePaths(routes))
    expect(known.has('/parties/:partyId')).toBe(true)
    const missing = PAGE_RESOURCES.map(([route]) => route).filter((route) => !known.has(route))
    expect(missing).toEqual([])
  })

  it('lists each route once', () => {
    const seen = PAGE_RESOURCES.map(([route]) => route)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('every resource of the offline manifest is shown by some page', () => {
    const patterns = PAGE_RESOURCES.flatMap(([, api]) => api)
    const unshown = manifestPaths.filter(
      (path) => !patterns.some((pattern) => matchPath({ path: pattern, end: true }, path) !== null),
    )
    expect(manifestPaths.length).toBeGreaterThan(25)
    expect(unshown).toEqual([])
  })
})

describe('page scope', () => {
  it('a list page shows its list, not its rows or other lists', () => {
    const page = pageScope('/parties')
    expect(page.shows('/parties')).toBe(true)
    expect(page.shows('/parties/p-1')).toBe(false)
    expect(page.shows('/items')).toBe(false)
    expect(page.shows('/auth/me')).toBe(false)
  })

  it('a detail page shows its record under the route id only', () => {
    const page = pageScope('/sales/quotes/q-1')
    expect(page.shows('/sales-quotes/q-1')).toBe(true)
    expect(page.shows('/sales-quotes/q-2')).toBe(false)
    expect(page.shows('/sales-quotes')).toBe(false)
    expect(page.shows('/parties/p-1')).toBe(false)
  })

  it('an edit page shows the record it edits', () => {
    expect(pageScope('/parties/p-1/edit').shows('/parties/p-1')).toBe(true)
    expect(pageScope('/parties/p-1/edit').shows('/parties/p-2')).toBe(false)
  })

  it('a print page shows the document it prints', () => {
    expect(pageScope('/sales/invoices/i-1/print').shows('/sales-invoices/i-1')).toBe(true)
  })

  it('a param only the API pattern has matches any value', () => {
    const page = pageScope('/inventory/warehouses')
    expect(page.shows('/warehouses/w-1/locations')).toBe(true)
    expect(page.shows('/warehouses/w-1')).toBe(false)
  })

  it('a report page shows the report of its slug', () => {
    const page = pageScope('/treasury/reports/receivables-ageing')
    expect(page.shows('/treasury-reports/receivables-ageing')).toBe(true)
    expect(page.shows('/treasury-reports/payables-ageing')).toBe(false)
  })

  it('a route not in the table shows nothing', () => {
    expect(pageScope('/')).toBe(NO_PAGE)
    expect(pageScope('/sync/outbox')).toBe(NO_PAGE)
    expect(pageScope('/parties/p-1/somewhere')).toBe(NO_PAGE)
  })

  it('a route param with pattern characters is taken as text', () => {
    const page = pageScope('/parties/:partyId')
    expect(page.shows('/parties/p-1')).toBe(false)
  })
})
