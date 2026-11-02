import { QueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'

import { addDesktopResources } from '../i18n'
import { offlineRefusalOf, refusalMessage, watchOfflineRefusals, type OfflineRefusalEvent } from './refusals'
import { createDesktopText } from './text'
import { ApiError } from '@/platform/types'

const QUOTE = '0193b1e5-0c11-7a22-9b33-4c5d6e7f8a20'
const routed = (method: string, path: string) =>
  new ApiError(503, 'OFFLINE_UNAVAILABLE', 'only online', {}, { method, path })

describe('offline refusals', () => {
  it.each([
    [new ApiError(503, 'OFFLINE_UNAVAILABLE', 'x'), 'offline'],
    [new ApiError(422, 'SYNC_OFFLINE_WRITE_NOT_ALLOWED', 'x'), 'manifest'],
    [new ApiError(422, 'VALIDATION_ERROR', 'x'), null],
    [new ApiError(503, 'SERVER_ERROR', 'x'), null],
    [new ApiError(500, 'OFFLINE_UNAVAILABLE', 'x'), null],
    [new Error('OFFLINE_UNAVAILABLE'), null],
    [{ status: 503, code: 'OFFLINE_UNAVAILABLE' }, null],
  ])('%s is %s', (error, kind) => {
    expect(offlineRefusalOf(error)?.kind ?? null).toBe(kind)
  })

  it('names the online-only action of a refused route', () => {
    expect(offlineRefusalOf(routed('POST', `/sales-quotes/${QUOTE}/send`))).toEqual({
      kind: 'offline',
      action: 'finalizeSalesQuote',
    })
    expect(offlineRefusalOf(routed('POST', `/api/v1/sales-quotes/${QUOTE}/send`))?.action).toBe('finalizeSalesQuote')
  })

  it('has no action without a route, or for a route outside the table', () => {
    expect(offlineRefusalOf(new ApiError(503, 'OFFLINE_UNAVAILABLE', 'x'))?.action).toBeNull()
    expect(offlineRefusalOf(routed('GET', `/sales-quotes/${QUOTE}`))?.action).toBeNull()
    expect(offlineRefusalOf(routed('POST', '/sales-quotes/not-a-uuid/send'))?.action).toBeNull()
  })

  it('reports a failed mutation once and stops after unsubscribing', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const seen: OfflineRefusalEvent[] = []
    const stop = watchOfflineRefusals(qc, (event) => seen.push(event))

    const run = (error: Error) =>
      qc
        .getMutationCache()
        .build(qc, { mutationFn: () => Promise.reject(error) })
        .execute(undefined)
        .catch(() => undefined)

    await run(new ApiError(503, 'OFFLINE_UNAVAILABLE', 'refused'))
    await run(new ApiError(422, 'VALIDATION_ERROR', 'bad'))
    await run(new ApiError(422, 'SYNC_OFFLINE_WRITE_NOT_ALLOWED', 'closed'))
    expect(seen.map((e) => e.kind)).toEqual(['offline', 'manifest'])

    stop()
    await run(new ApiError(503, 'OFFLINE_UNAVAILABLE', 'refused'))
    expect(seen).toHaveLength(2)
  })
})

describe('refusal message', () => {
  async function text() {
    const i18n = i18next.createInstance()
    await i18n.init({ lng: 'tr', fallbackLng: 'tr', resources: {} })
    addDesktopResources(i18n)
    return createDesktopText(i18n)
  }

  it('a refused action gets its own online-only text', async () => {
    expect(refusalMessage(await text(), { kind: 'offline', action: 'closePeriod' })).toBe(
      'Dönem ve mali yıl kapanışı çevrimiçi yapılır.',
    )
  })

  it('without an action the text is general', async () => {
    expect(refusalMessage(await text(), { kind: 'offline', action: null })).toBe(
      'Bu işlem çevrimdışıyken yapılamaz; bağlantı gelince yeniden deneyin.',
    )
  })

  it('a manifest mismatch always says so', async () => {
    expect(refusalMessage(await text(), { kind: 'manifest', action: 'closePeriod' })).toBe(
      'Çevrimdışı yazma kapalı: uygulamayı güncelleyin.',
    )
  })
})

describe('refusal reporting with retries', () => {
  it('a mutation that retries before it fails is reported once', async () => {
    const qc = new QueryClient()
    const seen: OfflineRefusalEvent[] = []
    watchOfflineRefusals(qc, (event) => seen.push(event))
    await qc
      .getMutationCache()
      .build(qc, {
        mutationFn: () => Promise.reject(new ApiError(503, 'OFFLINE_UNAVAILABLE', 'x')),
        retry: 2,
        retryDelay: 0,
      })
      .execute(undefined)
      .catch(() => undefined)
    expect(seen).toHaveLength(1)
  })
})
