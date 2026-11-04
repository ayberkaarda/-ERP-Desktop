import { describe, expect, it, vi } from 'vitest'

import { createDesktopHttp } from './http'
import PARTIAL_SEARCH from './localPartialSearch.json'
import { createOfflineMetaStore } from './offlineMeta'
import { createFakeBridge } from '../../test/fakeBridge'
import type { ApiResponse } from '../../bridge/api'
import { isPartialSearch } from '@/lib/sync/partialSearch'

// `meta.offline` of the shell's offline answer to an item search (`q` on a
// resource with `search.server_also`). The Rust test
// `the_webview_fixture_is_the_meta_of_a_partial_search` (router/local_read)
// checks this same file against the shell's output, so a change of the marker
// breaks one side or the other.

const PAGINATION = { current_page: 1, per_page: 20, total: 1, last_page: 1 }

function local(offline: unknown): ApiResponse {
  return {
    status: 200,
    headers: [['content-type', 'application/json']],
    body: { kind: 'json', value: { data: [{ id: 'i-1' }], meta: { pagination: PAGINATION, offline } } },
    source: 'local',
  }
}

function http(answer: ApiResponse) {
  const offlineMeta = createOfflineMetaStore()
  const bridge = createFakeBridge({ commands: { api_request: () => answer } })
  const client = createDesktopHttp({
    invoke: bridge.invoke,
    deps: { getCompanyId: () => 'c1', getLocale: () => 'tr', getSessionGeneration: () => 1, onAuthFailure: () => undefined },
    network: { failed: vi.fn(), answered: vi.fn() },
    offlineMeta,
  })
  return { client, offlineMeta }
}

describe('shell partial search contract', () => {
  it('is a partial search for the shared web lists and pickers', async () => {
    const { client, offlineMeta } = http(local(PARTIAL_SEARCH))
    const res = await client.get('/items', { params: { q: 'bolt', 'filter[is_active]': 'true' } })
    expect(isPartialSearch(res)).toBe(true)
    expect(offlineMeta.get('/items')).toEqual(PARTIAL_SEARCH)
  })

  it('is not one once the marker is gone', async () => {
    const rest = Object.fromEntries(Object.entries(PARTIAL_SEARCH).filter(([key]) => key !== 'search_partial'))
    const { client } = http(local(rest))
    expect(isPartialSearch(await client.get('/items'))).toBe(false)
  })

  it('names the copy, not the search, with `partial`', () => {
    expect(PARTIAL_SEARCH.partial).toBe(false)
    expect(PARTIAL_SEARCH.applied_filters).toContain('q')
  })
})
