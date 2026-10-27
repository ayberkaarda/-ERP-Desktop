import { describe, expect, it } from 'vitest'

import {
  API_REQUEST,
  apiError,
  apiRequest,
  bytes,
  header,
  json,
  jsonRequest,
  type ApiResponse,
  type Invoke,
} from './api'

function recorder(answer: unknown) {
  const calls: { command: string; args?: Record<string, unknown> }[] = []
  const invoke = ((command: string, args?: Record<string, unknown>) => {
    calls.push({ command, args })
    return Promise.resolve(answer)
  }) as Invoke
  return { invoke, calls }
}

const page: ApiResponse = {
  status: 200,
  headers: [['content-type', 'application/json']],
  body: { kind: 'json', value: { data: [{ id: '1' }], meta: { pagination: { total: 1 } } } },
  source: 'network',
}

describe('apiRequest', () => {
  it('invokes api_request with the request under `req`', async () => {
    const { invoke, calls } = recorder(page)
    const request = jsonRequest('GET', '/api/v1/parties', { query: { page: '2' } })
    const response = await apiRequest(invoke, request)
    expect(calls).toEqual([
      { command: API_REQUEST, args: { req: { method: 'GET', path: '/api/v1/parties', query: [['page', '2']] } } },
    ])
    expect(response).toBe(page)
  })

  it('passes the command error through', async () => {
    const failure = Object.assign(new Error('down'), { code: 'NETWORK_ERROR' })
    const invoke = (() => Promise.reject(failure)) as Invoke
    await expect(apiRequest(invoke, jsonRequest('GET', '/api/v1/parties'))).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: 'down',
    })
  })
})

describe('jsonRequest', () => {
  it('tags a JSON body and flattens repeated query values in order', () => {
    expect(
      jsonRequest('POST', '/api/v1/parties', {
        json: { name: 'Acme' },
        query: { 'filter[status][]': ['a', 'b'], page: '1' },
        headers: { 'Idempotency-Key': 'k1' },
      }),
    ).toEqual({
      method: 'POST',
      path: '/api/v1/parties',
      query: [
        ['filter[status][]', 'a'],
        ['filter[status][]', 'b'],
        ['page', '1'],
      ],
      headers: [['Idempotency-Key', 'k1']],
      body: { kind: 'json', value: { name: 'Acme' } },
    })
  })

  it('keeps a null JSON body and leaves out an absent one', () => {
    expect(jsonRequest('PATCH', '/api/v1/x', { json: null }).body).toEqual({ kind: 'json', value: null })
    expect('body' in jsonRequest('DELETE', '/api/v1/x')).toBe(false)
  })
})

describe('response envelope', () => {
  it('reads headers in any case and the JSON body', () => {
    expect(header(page, 'Content-Type')).toBe('application/json')
    expect(header(page, 'etag')).toBeUndefined()
    expect((json(page) as { data: unknown[] }).data).toHaveLength(1)
  })

  it('reads the Laravel error envelope of server and local answers', () => {
    const invalid: ApiResponse = {
      status: 422,
      headers: [],
      body: {
        kind: 'json',
        value: { errors: { message: 'invalid', code: 'VALIDATION_ERROR', fields: { name: ['required'] } } },
      },
      source: 'network',
    }
    expect(apiError(invalid)).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'invalid',
      fields: { name: ['required'] },
    })

    const offline: ApiResponse = {
      status: 503,
      headers: [['content-type', 'application/json']],
      body: {
        kind: 'json',
        value: {
          errors: { message: 'not offline', code: 'OFFLINE_UNAVAILABLE' },
          meta: { offline: { partial: false, stale: false, unsupported_filters: ['filter[city]'] } },
        },
      },
      source: 'local',
    }
    expect(apiError(offline)).toEqual({ code: 'OFFLINE_UNAVAILABLE', message: 'not offline' })
    expect(apiError(page)).toBeUndefined()
    expect(apiError({ ...invalid, body: { kind: 'text', value: '<html>' } })).toBeUndefined()
    expect(apiError({ ...invalid, body: null })).toBeUndefined()
  })

  it('decodes binary and text bodies to bytes', () => {
    const pdf: ApiResponse = { status: 200, headers: [], body: { kind: 'binary', base64: 'JVBERg==' }, source: 'network' }
    expect(Array.from(bytes(pdf) ?? [])).toEqual([0x25, 0x50, 0x44, 0x46])
    const csv: ApiResponse = { ...pdf, body: { kind: 'text', value: 'a;b' } }
    expect(Array.from(bytes(csv) ?? [])).toEqual([0x61, 0x3b, 0x62])
    expect(bytes(page)).toBeUndefined()
    expect(bytes({ ...pdf, status: 204, body: null })).toBeUndefined()
  })
})
