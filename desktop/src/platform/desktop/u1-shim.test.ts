// TEMPORARY with u1-shim.ts: the U1 `shared.test.ts` cases for the copied helpers,
// unchanged. Deleted together with the shim after the upstream sync (the web
// suite then covers `@/platform/shared`).
import { describe, expect, it } from 'vitest'

import {
  ApiError,
  apiErrorFromEnvelope,
  assertApiPath,
  classifyAuthFailure,
  createIdempotencyKey,
  filenameFromDisposition,
  isPlatformCancelled,
  isStaleRequest,
  PlatformCancelledError,
  readFields,
  STALE_REQUEST,
  withIdempotency,
} from './u1-shim'
import { ApiError as FrontendApiError } from '../../../../frontend/src/platform/types'

describe('u1 shim', () => {
  it('re-exports the frontend ApiError class itself', () => {
    expect(ApiError).toBe(FrontendApiError)
  })

  it('tells a user cancel apart from errors', () => {
    const cancel = new PlatformCancelledError()
    expect(cancel).toBeInstanceOf(Error)
    expect(cancel.name).toBe('PlatformCancelledError')
    expect(isPlatformCancelled(cancel)).toBe(true)
    expect(isPlatformCancelled(new ApiError(0, 'X', 'x'))).toBe(false)
    expect(isPlatformCancelled({ name: 'PlatformCancelledError' })).toBe(false)
  })

  it('creates distinct idempotency keys unless one is reused', () => {
    const a = withIdempotency()
    const b = withIdempotency()
    expect(a.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
    expect(createIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/)
    expect(withIdempotency({ params: { x: 1 } }, 'same')).toEqual({
      params: { x: 1 },
      idempotencyKey: 'same',
    })
  })

  it('recognises stale requests by code only', () => {
    expect(isStaleRequest(new ApiError(0, STALE_REQUEST, 'x'))).toBe(true)
    expect(isStaleRequest(new ApiError(0, 'OTHER', 'x'))).toBe(false)
    expect(isStaleRequest(new Error(STALE_REQUEST))).toBe(false)
    expect(STALE_REQUEST).toBe('REQUEST_STALE')
  })

  it.each(['https://evil.test/steal', '//evil.test/steal', '\\\\evil.test', 'javascript:alert(1)'])(
    'assertApiPath refuses %s',
    (url) => {
      expect(() => { assertApiPath(url) }).toThrow(
        expect.objectContaining({ code: 'INVALID_URL', status: 0 }),
      )
    },
  )

  it('assertApiPath accepts API-relative paths', () => {
    expect(() => { assertApiPath('/sales/orders?x=1') }).not.toThrow()
    expect(() => { assertApiPath('auth/me') }).not.toThrow()
  })

  it.each([
    [401, 'ANY', 'unauthenticated'],
    [403, 'USER_DEACTIVATED', 'deactivated'],
    [403, 'PASSWORD_CHANGE_REQUIRED', 'passwordChangeRequired'],
    [403, 'FORBIDDEN', null],
    [500, 'SERVER_ERROR', null],
  ] as const)('classifyAuthFailure(%i, %s) -> %s', (status, code, expected) => {
    expect(classifyAuthFailure(status, code)).toBe(expected)
  })

  it.each([
    ['attachment; filename="a.csv"', 'a.csv'],
    ['attachment; filename="x.xlsx"; filename*=UTF-8\'\'mizan%20%C3%A7.xlsx', 'mizan ç.xlsx'],
    ['attachment; filename="../../etc/passwd"', 'passwd'],
    ['attachment; filename="..\\..\\boot.ini"', 'boot.ini'],
    ['attachment; filename=".hidden"', 'hidden'],
    ['attachment; filename="a\u0000b<c>.csv"', 'a_b_c_.csv'],
    ["attachment; filename*=UTF-8''%E0%A4%A", null],
    ['attachment', null],
    ['attachment; filename=""', null],
  ])('parses Content-Disposition %j safely', (header, expected) => {
    expect(filenameFromDisposition(header)).toBe(expected)
  })

  it('reads field messages and drops values that are not strings', () => {
    expect(readFields({ name: ['Zorunlu', 3], code: 'Tek', bad: 3 })).toEqual({
      name: ['Zorunlu'],
      code: ['Tek'],
    })
    expect(readFields(null)).toEqual({})
    expect(readFields(['x'])).toEqual({})
  })

  it('maps the error envelope with fields and details', () => {
    const details = { mode: 'block', exceeded: true }
    const error = apiErrorFromEnvelope(422, {
      errors: {
        message: 'Geçersiz',
        code: 'VALIDATION_FAILED',
        fields: { name: ['Zorunlu'] },
        details,
      },
    })
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 422, code: 'VALIDATION_FAILED', message: 'Geçersiz' })
    expect(error?.fields).toEqual({ name: ['Zorunlu'] })
    expect(error?.details).toEqual(details)
  })

  it('defaults a missing code and a non-object details', () => {
    const error = apiErrorFromEnvelope(500, { errors: { message: 'X', code: 42, details: [1] } })
    expect(error).toMatchObject({ status: 500, code: 'HTTP_ERROR', message: 'X' })
    expect(error?.details).toEqual({})
  })

  it.each([
    [{ errors: null }],
    [{ errors: 'boom' }],
    [{ errors: { code: 'X' } }],
    ['<html>'],
    [null],
  ])('returns null for a body that is not an envelope: %j', (body) => {
    expect(apiErrorFromEnvelope(500, body)).toBeNull()
  })
})
