import { ApiError } from './types'
import * as shared from './shared'
import * as webHttp from './web/http'
import * as platformIndex from './index'
import {
  apiErrorFromEnvelope,
  assertApiPath,
  classifyAuthFailure,
  createIdempotencyKey,
  filenameFromDisposition,
  isStaleRequest,
  readFields,
  STALE_REQUEST,
  withIdempotency,
} from './shared'

const MOVED = [
  'createIdempotencyKey',
  'withIdempotency',
  'STALE_REQUEST',
  'isStaleRequest',
  'assertApiPath',
  'classifyAuthFailure',
  'filenameFromDisposition',
] as const

describe('platform shared helpers', () => {
  it.each(MOVED)('web/http re-exports %s from shared unchanged', (name) => {
    expect(webHttp[name]).toBe(shared[name])
  })

  it.each([
    'createIdempotencyKey',
    'withIdempotency',
    'STALE_REQUEST',
    'isStaleRequest',
    'assertApiPath',
    'classifyAuthFailure',
    'filenameFromDisposition',
    'readFields',
    'apiErrorFromEnvelope',
  ] as const)('@/platform exports %s from shared', (name) => {
    expect(platformIndex[name]).toBe(shared[name])
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
      expect(() => assertApiPath(url)).toThrow(
        expect.objectContaining({ code: 'INVALID_URL', status: 0 }),
      )
    },
  )

  it('assertApiPath accepts API-relative paths', () => {
    expect(() => assertApiPath('/sales/orders?x=1')).not.toThrow()
    expect(() => assertApiPath('auth/me')).not.toThrow()
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
