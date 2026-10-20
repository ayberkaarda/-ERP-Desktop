import type { HttpClient } from '@/platform/types'
import type { AttachmentApi, FileMeta } from './types'

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
    async list() {
      const res = await http.get<{ data: FileMeta[] }>('/files', {
        params: {
          'filter[attachable_type]': attachable.type,
          'filter[attachable_id]': attachable.id,
          per_page: 100,
        },
      })
      return res.data
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
