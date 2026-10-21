import { platform } from '@/platform'

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

/** List export (50k cap and formula guard live on the server); the server file name wins. */
export async function downloadExport(
  path: string,
  format: ExportFormat,
  params: Record<string, string>,
  fallbackName: string,
): Promise<void> {
  const res = await platform.http.download(`${path.replace(/\/+$/, '')}/export`, {
    params: { ...params, format },
    headers: { Accept: `${EXPORT_MIME[format]}, application/json` },
  })
  saveBlob(res.blob, res.filename ?? `${fallbackName}.${format}`)
}

/** Export params of a list: the filters and search of the current query, never paging. */
export function exportParams(q: string, filters: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  if (q.trim()) out.q = q.trim()
  for (const [k, v] of Object.entries(filters)) if (v !== '') out[`filter[${k}]`] = v
  return out
}
