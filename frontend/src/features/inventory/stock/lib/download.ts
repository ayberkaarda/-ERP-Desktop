import { platform, type HttpRequestOptions } from '@/platform'

export type ExportFormat = 'csv' | 'xlsx'

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
  setTimeout(() => URL.revokeObjectURL(href), 0)
}

/** Export endpoint of a list, e.g. /stock-balances -> /stock-balances/export. */
export function exportPath(path: string): string {
  return `${path.replace(/\/+$/, '')}/export`
}

export function exportFilename(base: string, format: ExportFormat, today: string): string {
  return `${base}-${today}.${format}`
}

/**
 * Downloads an export through platform.http.download (company header, CSRF and auth handling
 * included); the file name sent by the server wins over the fallback.
 */
export async function downloadExport(
  path: string,
  format: ExportFormat,
  params: HttpRequestOptions['params'],
  fallbackName: string,
): Promise<void> {
  const res = await platform.http.download(exportPath(path), {
    params: { ...params, format },
    headers: { Accept: `${EXPORT_MIME[format]}, application/json` },
  })
  saveBlob(res.blob, res.filename ?? fallbackName)
}
