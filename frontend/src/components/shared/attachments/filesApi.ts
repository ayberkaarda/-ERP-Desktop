import type { HttpClient } from '@/platform/types'
import { createIdempotencyKey, withIdempotency } from '@/platform/web/http'
import type { AttachmentApi, FileMeta } from './types'

const PER_PAGE = 100
/** Safety stop: 50 pages = 5000 attachments on one document. */
const MAX_PAGES = 50

export interface AttachableRef {
  /** Morph alias of the owning document, e.g. "sales_invoice". */
  type: string
  id: string
}

interface ListMeta {
  last_page?: number
  pagination?: { last_page?: number }
}

/**
 * Binds AttachmentPanel to the /files endpoints. The HTTP client is injected (platform.http in
 * the app, a test client in specs), so shared components never create their own network client.
 */
export function createFilesApi(
  http: Pick<HttpClient, 'get' | 'post' | 'delete'>,
  attachable: AttachableRef,
  baseUrl = '/api/v1',
  newKey: () => string = createIdempotencyKey,
): AttachmentApi {
  // POST /files is idempotent on the API: one key per selected file, so retrying the same file
  // replays instead of storing it twice, while a newly selected file gets its own key.
  const keys = new WeakMap<File, string>()
  const keyFor = (file: File) => {
    let key = keys.get(file)
    if (!key) {
      key = newKey()
      keys.set(file, key)
    }
    return key
  }

  return {
    key: `${attachable.type}:${attachable.id}`,
    // GET /files?filter[attachable_type]=&filter[attachable_id]=&page=&per_page= (Core ListQuery
    // paginator: meta.pagination.last_page; a flat meta.last_page is accepted too). All pages are
    // fetched so documents with >100 files show fully.
    async list() {
      const all: FileMeta[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await http.get<{ data: FileMeta[]; meta?: ListMeta }>('/files', {
          params: {
            'filter[attachable_type]': attachable.type,
            'filter[attachable_id]': attachable.id,
            page,
            per_page: PER_PAGE,
          },
        })
        all.push(...res.data)
        const last = res.meta?.pagination?.last_page ?? res.meta?.last_page
        if (last !== undefined ? page >= last : res.data.length < PER_PAGE) break
      }
      return all
    },
    async upload(file, signal) {
      const body = new FormData()
      body.append('file', file)
      body.append('attachable_type', attachable.type)
      body.append('attachable_id', attachable.id)
      const res = await http.post<{ data: FileMeta }>(
        '/files',
        body,
        withIdempotency({ signal }, keyFor(file)),
      )
      return res.data
    },
    async remove(id) {
      await http.delete(`/files/${encodeURIComponent(id)}`)
    },
    downloadUrl: (id) => `${baseUrl}/files/${encodeURIComponent(id)}/download`,
  }
}
