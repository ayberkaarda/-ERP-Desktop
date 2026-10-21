import { platform, type HttpClient, type HttpRequestOptions } from '@/platform'

export type ExportFormat = 'csv' | 'xlsx'

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/**
 * Optional binary-aware method a platform adapter may offer. The web HttpClient has no
 * responseType option yet, so until it does the body comes back as parsed text.
 */
interface DownloadCapable extends HttpClient {
  download?: (
    url: string,
    options?: HttpRequestOptions,
  ) => Promise<{ blob: Blob; filename?: string | null }>
}

export interface DownloadOptions {
  params?: HttpRequestOptions['params']
  filename: string
  mime: string
  signal?: AbortSignal
}

export function toBlob(body: unknown, mime: string): Blob {
  if (body instanceof Blob) return body
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    return new Blob([body as BlobPart], { type: mime })
  }
  if (typeof body === 'string') return new Blob([body], { type: mime })
  return new Blob([JSON.stringify(body)], { type: mime })
}

/** Hands a blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  // Some browsers start the download asynchronously; revoke after it had a chance to begin.
  setTimeout(() => URL.revokeObjectURL(href), 0)
}

/**
 * Downloads a file through the platform HTTP client (company header, CSRF and auth handling
 * included). Uses the adapter's binary download when available.
 */
export async function downloadFile(url: string, options: DownloadOptions): Promise<void> {
  const http = platform.http as DownloadCapable
  const request: HttpRequestOptions = {
    params: options.params,
    signal: options.signal,
    headers: { Accept: `${options.mime}, application/json` },
  }
  if (typeof http.download === 'function') {
    const res = await http.download(url, request)
    saveBlob(res.blob, res.filename ?? options.filename)
    return
  }
  const body = await http.get<unknown>(url, request)
  saveBlob(toBlob(body, options.mime), options.filename)
}

/** Export endpoint of a list or report, e.g. /reports/trial-balance -> /reports/trial-balance/export. */
export function exportPath(path: string): string {
  return `${path.replace(/\/+$/, '')}/export`
}

export function exportFilename(base: string, format: ExportFormat, today: string): string {
  return `${base}-${today}.${format}`
}
