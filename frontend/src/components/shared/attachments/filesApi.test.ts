import type { HttpClient, HttpRequestOptions } from '@/platform/types'
import { createFilesApi } from './filesApi'
import type { FileMeta } from './types'

const doc = { type: 'party', id: 'p-1' }

function meta(id: string): FileMeta {
  return {
    id,
    original_name: `${id}.pdf`,
    mime_type: 'application/pdf',
    size: 1,
    created_at: '2026-10-21T08:00:00Z',
  }
}

function fakeHttp(pages: { data: FileMeta[]; meta?: unknown }[]) {
  const posts: HttpRequestOptions[] = []
  let gets = 0
  const http: Pick<HttpClient, 'get' | 'post' | 'delete'> = {
    get: <T>() => Promise.resolve(pages[gets++] as T),
    post: <T>(_url: string, _body?: unknown, options: HttpRequestOptions = {}) => {
      posts.push(options)
      return Promise.resolve({ data: meta('new') } as T)
    },
    delete: <T>() => Promise.resolve(undefined as T),
  }
  return { http, posts, gets: () => gets }
}

describe('createFilesApi', () => {
  it('reads last_page from meta.pagination (Core paginator) and stops there', async () => {
    const full = Array.from({ length: 100 }, (_, i) => meta(`f${i}`))
    const fake = fakeHttp([
      { data: full, meta: { pagination: { last_page: 2 } } },
      { data: full, meta: { pagination: { last_page: 2 } } },
      { data: [meta('never')] },
    ])
    const files = await createFilesApi(fake.http, doc).list()
    expect(files).toHaveLength(200)
    expect(fake.gets()).toBe(2)
  })

  it('still accepts a flat meta.last_page', async () => {
    const full = Array.from({ length: 100 }, (_, i) => meta(`f${i}`))
    const fake = fakeHttp([{ data: full, meta: { last_page: 1 } }, { data: [meta('never')] }])
    expect(await createFilesApi(fake.http, doc).list()).toHaveLength(100)
  })

  it('sends one Idempotency-Key per selected file, reused when that file is retried', async () => {
    const fake = fakeHttp([])
    let n = 0
    const api = createFilesApi(fake.http, doc, '/api/v1', () => `key-${++n}`)
    const a = new File(['a'], 'a.pdf')
    const b = new File(['b'], 'b.pdf')
    const signal = new AbortController().signal
    await api.upload(a, signal)
    await api.upload(a, signal)
    await api.upload(b, signal)
    expect(fake.posts.map((o) => o.idempotencyKey)).toEqual(['key-1', 'key-1', 'key-2'])
    expect(fake.posts[0]?.signal).toBe(signal)
  })
})
