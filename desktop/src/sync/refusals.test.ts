import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { offlineRefusalOf, watchOfflineRefusals } from './refusals'
import { ApiError } from '@/platform/types'

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
    expect(offlineRefusalOf(error)).toBe(kind)
  })

  it('reports a failed mutation once and stops after unsubscribing', async () => {
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const seen: string[] = []
    const stop = watchOfflineRefusals(qc, (kind) => seen.push(kind))

    const run = (error: unknown) =>
      qc
        .getMutationCache()
        .build(qc, { mutationFn: () => Promise.reject(error instanceof Error ? error : new Error('x')) })
        .execute(undefined)
        .catch(() => undefined)

    await run(new ApiError(503, 'OFFLINE_UNAVAILABLE', 'refused'))
    await run(new ApiError(422, 'VALIDATION_ERROR', 'bad'))
    await run(new ApiError(422, 'SYNC_OFFLINE_WRITE_NOT_ALLOWED', 'closed'))
    expect(seen).toEqual(['offline', 'manifest'])

    stop()
    await run(new ApiError(503, 'OFFLINE_UNAVAILABLE', 'refused'))
    expect(seen).toHaveLength(2)
  })
})
