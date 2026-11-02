import { describe, expect, it, vi } from 'vitest'

import { createDesktopHttp } from './http'
import { createOfflineMetaStore } from './offlineMeta'
import { offlineRefusalOf } from '../../sync'
import { createFakeBridge } from '../../test/fakeBridge'
import type { ApiResponse } from '../../bridge/api'

// The shell's local offline refusal as `name_refused` (src-tauri
// commands/api.rs) builds it: `errors.details` names the refused request with
// an upper-case method and the API-relative path, without the query.
const QUOTE = '0193b1e5-0c11-7a22-9b33-4c5d6e7f8a20'

function refusal(status: number, code: string, details?: Record<string, unknown>): ApiResponse {
  const errors = { message: 'refused', code, ...(details ? { details } : {}) }
  return { status, headers: [['content-type', 'application/json']], body: { kind: 'json', value: { errors } }, source: 'local' }
}

function http(answer: ApiResponse) {
  const bridge = createFakeBridge({ commands: { api_request: () => answer } })
  return createDesktopHttp({
    invoke: bridge.invoke,
    deps: { getCompanyId: () => 'c1', getLocale: () => 'tr', getSessionGeneration: () => 1, onAuthFailure: () => undefined },
    network: { failed: vi.fn(), answered: vi.fn() },
    offlineMeta: createOfflineMetaStore(),
  })
}

describe('shell local refusal contract', () => {
  it.each([
    [503, 'OFFLINE_UNAVAILABLE', 'offline'],
    [422, 'SYNC_OFFLINE_WRITE_NOT_ALLOWED', 'manifest'],
  ] as const)('%s %s names the refused action', async (status, code, kind) => {
    const details = { method: 'POST', path: `/sales-quotes/${QUOTE}/send` }
    const error = await http(refusal(status, code, details))
      .post(`/sales-quotes/${QUOTE}/send`)
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ status, code, details })
    expect(offlineRefusalOf(error)).toEqual({ kind, action: 'finalizeSalesQuote' })
  })

  it('without details the refusal has no action', async () => {
    const error = await http(refusal(503, 'OFFLINE_UNAVAILABLE'))
      .post(`/sales-quotes/${QUOTE}/send`)
      .catch((e: unknown) => e)
    expect(offlineRefusalOf(error)).toEqual({ kind: 'offline', action: null })
  })
})
