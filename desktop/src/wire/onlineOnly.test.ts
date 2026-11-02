// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { API_PREFIX, ONLINE_ONLY } from './generated/onlineOnly'
import { ONLINE_ONLY_ACTIONS, isRouterUuid, onlineOnlyAction, onlineOnlyKey } from './onlineOnly'

interface ManifestEntry {
  action: string
  i18n_key: string
  category: string
  routes: string[]
}
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../contracts/offline-manifest.json', import.meta.url)), 'utf8'),
) as { api_prefix: string; online_only: ManifestEntry[] }

const V7 = '0193b1e5-0c11-7a22-9b33-4c5d6e7f8a20'
const V4 = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'

// Every manifest route as [method, template, action].
const ROUTES = manifest.online_only.flatMap((entry) =>
  entry.routes.map((route) => {
    const [method = '', template = ''] = route.split(' ')
    return [method, template, entry.action] as const
  }),
)

const fill = (template: string, value: string) =>
  template
    .split('/')
    .map((part) => (part.startsWith('{') && part.endsWith('}') ? value : part))
    .join('/')

describe('online-only table', () => {
  it('is online_only[] of the offline manifest, in order', () => {
    expect(ONLINE_ONLY).toEqual(manifest.online_only)
    expect(API_PREFIX).toBe(manifest.api_prefix)
    expect(ONLINE_ONLY_ACTIONS).toEqual(manifest.online_only.map((entry) => entry.action))
  })

  it('has 19 actions, each with its desktop.onlineOnly key', () => {
    expect(manifest.online_only).toHaveLength(19)
    for (const entry of ONLINE_ONLY) {
      expect(entry.i18n_key).toBe(`desktop.${onlineOnlyKey(entry.action)}`)
    }
  })

  it('lists every route once', () => {
    const seen = ROUTES.map(([method, template]) => `${method} ${template}`)
    expect(new Set(seen).size).toBe(seen.length)
  })
})

describe('onlineOnlyAction: same template rule as the shell router', () => {
  it.each(ROUTES)('%s %s -> %s', (method, template, action) => {
    for (const id of [V7, V4, V7.toUpperCase(), V7.replace(/-/g, ''), `{${V7}}`, `urn:uuid:${V7}`]) {
      const match = onlineOnlyAction(method, fill(template, id))
      expect(match).toEqual({
        action,
        category: manifest.online_only.find((e) => e.action === action)?.category,
        key: `onlineOnly.${action}`,
        route: `${method} ${template}`,
      })
      // The path the web features hand to platform.http, without /api/v1.
      expect(onlineOnlyAction(method, fill(template, id).slice(API_PREFIX.length))?.action).toBe(action)
    }
  })

  it.each(ROUTES.filter(([, template]) => template.includes('{')))(
    '%s %s needs a UUID in place of {param}',
    (method, template) => {
      for (const word of ['duplicates', '42', '', `${V7}x`, V7.slice(1), `{${V7}`, `urn:uid:${V7}`]) {
        expect(onlineOnlyAction(method, fill(template, word))).toBeNull()
      }
    },
  )

  it.each(ROUTES)('%s %s needs the same method and segment count', (method, template) => {
    const path = fill(template, V7)
    const other = method === 'GET' ? 'POST' : 'GET'
    expect(onlineOnlyAction(other, path)).toBeNull()
    expect(onlineOnlyAction(method, `${path}/extra`)).toBeNull()
    expect(onlineOnlyAction(method, path.split('/').slice(0, -1).join('/'))).toBeNull()
    expect(onlineOnlyAction(method, `${path}/`)).toBeNull()
    expect(onlineOnlyAction(method, path.toUpperCase().replace(V7.toUpperCase(), V7))).toBeNull()
  })

  it('ignores the query string and fragment, and the method case', () => {
    expect(onlineOnlyAction('post', `/api/v1/sales-quotes/${V7}/send?x=1#top`)?.action).toBe('finalizeSalesQuote')
    expect(onlineOnlyAction('GET', '/reports/trial-balance?from=2026-01-01')?.action).toBe('liveReports')
  })

  it('answers null outside the table', () => {
    expect(onlineOnlyAction('PATCH', `/api/v1/sales-quotes/${V7}`)).toBeNull()
    expect(onlineOnlyAction('POST', '/api/v1/sales-quotes')).toBeNull()
    expect(onlineOnlyAction('POST', 'sales-quotes')).toBeNull()
    expect(onlineOnlyAction('GET', '/api/v2/reports/trial-balance')).toBeNull()
    expect(onlineOnlyAction('POST', `https://erp.example.test/api/v1/sales-quotes/${V7}/send`)).toBeNull()
  })
})

describe('isRouterUuid (uuid::Uuid::try_parse shapes)', () => {
  it.each([V7, V4, V7.toUpperCase(), V7.replace(/-/g, ''), `{${V7}}`, `urn:uuid:${V7}`, `URN:UUID:${V7}`])(
    'accepts %s',
    (value) => expect(isRouterUuid(value)).toBe(true),
  )
  it.each([
    'duplicates',
    '',
    `${V7} `,
    V7.replace('-', ''),
    V7.replace(/a/, 'g'),
    `{${V7}`,
    `(${V7})`,
    `urn:uuid:${V7.replace(/-/g, '')}`,
    // A hyphen one place early: 36 characters, wrong shape.
    `${V7.slice(0, 7)}-${V7.slice(7, 8)}${V7.slice(9)}`,
  ])('refuses %s', (value) => expect(isRouterUuid(value)).toBe(false))
})
