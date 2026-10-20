/** File metadata as returned by POST /files and GET /files/{id}. */
export interface FileMeta {
  id: string
  original_name: string
  mime_type: string
  size: number
  /** ISO instant. */
  created_at: string
  uploaded_by?: { id: string; name: string } | null
}

/** Everything AttachmentPanel needs from the outside; see createFilesApi for the HTTP binding. */
export interface AttachmentApi {
  /** Identity of the owning document ("sales_invoice:42"); a new key resets the panel. */
  key: string
  list: () => Promise<FileMeta[]>
  upload: (file: File, signal: AbortSignal) => Promise<FileMeta>
  remove: (id: string) => Promise<void>
  /** Same-origin URL of GET /files/{id}/download (redirects to a signed temporary URL). */
  downloadUrl: (id: string) => string
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024

/** Client-side hint only; the API's extension+mime allowlist is authoritative. */
export const DEFAULT_ACCEPT = [
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
] as const
