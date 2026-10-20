import { http, HttpResponse } from 'msw'
import type { FileMeta } from '@/components/shared/attachments/types'

// In-memory /files API (contract: POST /files multipart, GET /files/{id}, GET /files/{id}/download,
// DELETE /files/{id}); listing is filtered by attachable like ListQuery filter[...] params.

interface StoredFile extends FileMeta {
  attachable_type: string
  attachable_id: string
}

const MAX = 25 * 1024 * 1024
const ALLOWED = new Set([
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'xlsx',
  'xls',
  'csv',
  'docx',
  'doc',
  'txt',
  'xml',
  'zip',
])

const text = (value: unknown) => (typeof value === 'string' ? value : '')

const fail = (status: number, code: string, message: string) =>
  HttpResponse.json({ errors: { message, code } }, { status })

export function createFileHandlers(seed: StoredFile[] = []) {
  const files = new Map(seed.map((f) => [f.id, f]))
  let next = seed.length + 1
  const handlers = [
    http.get('*/api/v1/files', ({ request }) => {
      const url = new URL(request.url)
      const type = url.searchParams.get('filter[attachable_type]')
      const id = url.searchParams.get('filter[attachable_id]')
      const data = [...files.values()].filter(
        (f) => (!type || f.attachable_type === type) && (!id || f.attachable_id === id),
      )
      return HttpResponse.json({ data, meta: { total: data.length } })
    }),
    http.post('*/api/v1/files', async ({ request }) => {
      const form = await request.formData()
      const entry = form.get('file')
      // jsdom and Node each have their own File class, so check the shape, not the prototype.
      const file = typeof entry === 'object' && entry !== null && 'name' in entry ? entry : null
      if (!file) {
        return HttpResponse.json(
          {
            errors: {
              message: 'The file field is required.',
              code: 'VALIDATION_FAILED',
              fields: { file: ['The file field is required.'] },
            },
          },
          { status: 422 },
        )
      }
      if (file.size > MAX) return fail(413, 'FILE_TOO_LARGE', 'File too large.')
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (!ALLOWED.has(ext)) return fail(422, 'UNSUPPORTED_FILE_TYPE', 'Unsupported file type.')
      const meta: StoredFile = {
        id: `file-${next++}`,
        original_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
        created_at: '2026-10-21T09:00:00Z',
        uploaded_by: { id: 'u-test', name: 'Test User' },
        attachable_type: text(form.get('attachable_type')),
        attachable_id: text(form.get('attachable_id')),
      }
      files.set(meta.id, meta)
      return HttpResponse.json({ data: meta }, { status: 201 })
    }),
    http.get('*/api/v1/files/:id/download', ({ params }) =>
      files.has(String(params.id))
        ? new HttpResponse(null, {
            status: 302,
            headers: { Location: 'https://minio.test/signed' },
          })
        : fail(404, 'NOT_FOUND', 'Not found.'),
    ),
    http.get('*/api/v1/files/:id', ({ params }) => {
      const file = files.get(String(params.id))
      return file ? HttpResponse.json({ data: file }) : fail(404, 'NOT_FOUND', 'Not found.')
    }),
    http.delete('*/api/v1/files/:id', ({ params }) =>
      files.delete(String(params.id))
        ? new HttpResponse(null, { status: 204 })
        : fail(404, 'NOT_FOUND', 'Not found.'),
    ),
  ]
  return { handlers, files }
}

export const febHandlers = createFileHandlers().handlers
