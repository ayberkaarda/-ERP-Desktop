import { describe, expect, it, vi } from 'vitest'

import { createDesktopHttp } from './http'
import SHELL_REFUSALS from './localRefusal.json'
import { createOfflineMetaStore } from './offlineMeta'
import { offlineRefusalOf } from '../../sync'
import { createFakeBridge } from '../../test/fakeBridge'
import type { ApiResponse } from '../../bridge/api'
import { ApiError } from '@/platform/types'

// The shell's local offline refusals of `POST /sales-quotes/{id}/send`, as
// `name_refused` (src-tauri commands/api.rs) builds them. The Rust test
// `the_webview_fixture_is_what_the_shell_sends` checks this same file against
// the shell's output, so a change of the envelope breaks one side or the other.
const QUOTE = '0193b1e5-0c11-7a22-9b33-4c5d6e7f8a20'

function local(status: number, value: unknown): ApiResponse {
  return { status, headers: [['content-type', 'application/json']], body: { kind: 'json', value }, source: 'local' }
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

const KIND: Record<number, string> = { 503: 'offline', 422: 'manifest' }

describe('shell local refusal contract', () => {
  it('holds both refusals of the shell', () => {
    expect(SHELL_REFUSALS.map((r) => r.status).sort()).toEqual([422, 503])
  })

  it.each(SHELL_REFUSALS.map((r) => [r.status, r] as const))('%s names the refused action', async (status, refusal) => {
    const error = await http(local(status, refusal.body))
      .post(`/sales-quotes/${QUOTE}/send`)
      .catch((e: unknown) => e)
    expect(error).toMatchObject({ status, code: refusal.body.errors.code })
    expect(offlineRefusalOf(error)).toEqual({ kind: KIND[status], action: 'finalizeSalesQuote' })
  })

  it('without details the refusal has no action', async () => {
    const offline = SHELL_REFUSALS.find((r) => r.status === 503)
    const { message, code } = offline?.body.errors ?? { message: '', code: '' }
    const error = await http(local(503, { errors: { message, code } }))
      .post(`/sales-quotes/${QUOTE}/send`)
      .catch((e: unknown) => e)
    expect(offlineRefusalOf(error)).toEqual({ kind: 'offline', action: null })
  })

  it('another method on an online-only path is not that action', () => {
    const error = new ApiError(503, 'OFFLINE_UNAVAILABLE', 'refused', {}, {
      method: 'GET',
      path: `/sales-quotes/${QUOTE}/send`,
    })
    expect(offlineRefusalOf(error)).toEqual({ kind: 'offline', action: null })
  })

  it('details without a method name no action and do not throw', () => {
    const error = new ApiError(422, 'SYNC_OFFLINE_WRITE_NOT_ALLOWED', 'refused', {}, {
      path: `/sales-quotes/${QUOTE}/send`,
    })
    expect(offlineRefusalOf(error)).toEqual({ kind: 'manifest', action: null })
  })
})
