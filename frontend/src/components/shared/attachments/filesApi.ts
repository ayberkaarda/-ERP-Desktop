import type { HttpClient } from '@/platform/types'
import type { AttachmentApi, FileMeta } from './types'

const PER_PAGE = 100
/** Safety stop: 50 pages = 5000 attachments on one document. */
const MAX_PAGES = 50

export interface AttachableRef {
  /** Morph alias of the owning document, e.g. "sales_invoice". */
  type: string
  id: string
}

/**
 * Binds AttachmentPanel to the /files endpoints. The HTTP client is injected (platform.http in
 * the app, a test client in specs), so shared components never import the network layer.
 */
export function createFilesApi(
  http: Pick<HttpClient, 'get' | 'post' | 'delete'>,
  attachable: AttachableRef,
  baseUrl = '/api/v1',
): AttachmentApi {
  return {
    key: `${attachable.type}:${attachable.id}`,
    // Assumed listing contract (being confirmed with the svc lane):
    // GET /files?filter[attachable_type]=&filter[attachable_id]=&page=&per_page= (ListQuery
    // paginator, meta.last_page). All pages are fetched so documents with >100 files show fully.
    async list() {
      const all: FileMeta[] = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await http.get<{ data: FileMeta[]; meta?: { last_page?: number } }>('/files', {
          params: {
            'filter[attachable_type]': attachable.type,
            'filter[attachable_id]': attachable.id,
            page,
            per_page: PER_PAGE,
          },
        })
        all.push(...res.data)
        const last = res.meta?.last_page
        if (last !== undefined ? page >= last : res.data.length < PER_PAGE) break
      }
      return all
    },
    async upload(file, signal) {
      const body = new FormData()
      body.append('file', file)
      body.append('attachable_type', attachable.type)
      body.append('attachable_id', attachable.id)
      const res = await http.post<{ data: FileMeta }>('/files', body, { signal })
      return res.data
    },
    async remove(id) {
      await http.delete(`/files/${encodeURIComponent(id)}`)
    },
    downloadUrl: (id) => `${baseUrl}/files/${encodeURIComponent(id)}/download`,
  }
}
