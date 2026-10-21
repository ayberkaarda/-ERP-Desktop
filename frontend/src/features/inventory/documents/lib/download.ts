import { platform, type HttpRequestOptions } from '@/platform'

export type ExportFormat = 'csv' | 'xlsx'

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export interface DownloadOptions {
  params?: HttpRequestOptions['params']
  /** Used when the server sends no usable Content-Disposition file name. */
  filename: string
  mime: string
  signal?: AbortSignal
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
 * Downloads a file through the platform HTTP client as a binary Blob (company header, CSRF and
 * auth handling included); the server's file name wins over the fallback.
 */
export async function downloadFile(url: string, options: DownloadOptions): Promise<void> {
  const res = await platform.http.download(url, {
    params: options.params,
    signal: options.signal,
    headers: { Accept: `${options.mime}, application/json` },
  })
  saveBlob(res.blob, res.filename ?? options.filename)
}

/** Export endpoint of a list or report, e.g. /reports/trial-balance -> /reports/trial-balance/export. */
export function exportPath(path: string): string {
  return `${path.replace(/\/+$/, '')}/export`
}

export function exportFilename(base: string, format: ExportFormat, today: string): string {
  return `${base}-${today}.${format}`
}
