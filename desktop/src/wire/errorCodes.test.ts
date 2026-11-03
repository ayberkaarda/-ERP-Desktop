// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, expectTypeOf, it } from 'vitest'

import type { DesktopKey } from '../i18n/types'
import trErrors from '../i18n/locales/tr/errors.json'
import trOnlineOnly from '../i18n/locales/tr/onlineOnly.json'
import { ADAPTER_ERROR_CODES, errorKey, type DesktopErrorCode, type ErrorKey, type TranslatedErrorCode } from './errorCodes'
import type { OnlineOnlyAction, OnlineOnlyKey } from './onlineOnly'
import { STALE_REQUEST, assertApiPath } from '@/platform/shared'
import { ApiError } from '@/platform/types'

const sources = import.meta.glob<string>(['../platform/**/*.ts', '!../platform/**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('adapter error codes', () => {
  it('REQUEST_STALE is the code of a stale answer', () => {
    expect(ADAPTER_ERROR_CODES).toContain(STALE_REQUEST)
  })

  it('INVALID_URL is the code of a refused path', () => {
    let code: string | undefined
    try {
      assertApiPath('https://erp.example.test/api/v1/parties')
    } catch (error) {
      code = error instanceof ApiError ? error.code : undefined
    }
    expect(code).toBe('INVALID_URL')
    expect(ADAPTER_ERROR_CODES).toContain(code)
  })

  it('STREAM_UNAVAILABLE is the code of the assistant without streamPost', () => {
    const api = readFileSync(
      fileURLToPath(new URL('../../../frontend/src/features/assistant/api.ts', import.meta.url)),
      'utf8',
    )
    expect(api).toMatch(/new ApiError\(\s*0,\s*'STREAM_UNAVAILABLE'/)
    expect(ADAPTER_ERROR_CODES).toContain('STREAM_UNAVAILABLE')
  })

  it('covers every code the desktop platform writes into an ApiError', () => {
    const written = Object.values(sources).flatMap((text) =>
      [...text.matchAll(/new ApiError\([^,]+,\s*'([A-Z_]+)'/g)].map((m) => m[1]),
    )
    expect(written.length).toBeGreaterThan(0)
    for (const code of written) expect(errorKey(code ?? ''), code).toBe(`errors.${code}`)
  })
})

describe('errorKey', () => {
  it('gives the text key of a known code', () => {
    expect(errorKey('DOCUMENT_LOCKED')).toBe('errors.DOCUMENT_LOCKED')
    expect(errorKey('STORE_KEY_INVALID')).toBe('errors.STORE_KEY_INVALID')
    expect(errorKey('REQUEST_STALE')).toBe('errors.REQUEST_STALE')
  })

  it('gives nothing for an unknown code', () => {
    expect(errorKey('SOMETHING_NEW')).toBeUndefined()
    expect(errorKey('toString')).toBeUndefined()
    expect(errorKey('')).toBeUndefined()
  })

  it('has a text for every code in tr', () => {
    expect(Object.keys(trErrors)).toHaveLength(59)
    expect(Object.keys(trOnlineOnly)).toHaveLength(19)
  })
})

describe('text keys (types)', () => {
  it('errors.json has a key for exactly the server, shell and adapter codes', () => {
    expectTypeOf<TranslatedErrorCode>().toEqualTypeOf<DesktopErrorCode>()
    expectTypeOf<ErrorKey>().toExtend<DesktopKey>()
  })

  it('onlineOnly.json has a key for exactly the manifest actions', () => {
    expectTypeOf<keyof typeof trOnlineOnly>().toEqualTypeOf<OnlineOnlyAction>()
    expectTypeOf<OnlineOnlyKey>().toExtend<DesktopKey>()
  })
})
