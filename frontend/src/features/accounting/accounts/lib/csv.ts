import type { ImportRowResult } from '../../shared/types'

/** Spreadsheet apps run cells starting with these as formulas (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (FORMULA_START.test(s)) s = `'${s}`
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  // BOM so spreadsheet apps read UTF-8 (Turkish letters) correctly.
  return `${String.fromCharCode(0xfeff)}${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`
}

/** Error report of an import run: only the rows that failed, one line per row. */
export function errorReportCsv(
  rows: readonly ImportRowResult[],
  headers: { row: string; code: string; name: string; errors: string },
): string {
  const failed = rows.filter((r) => r.status === 'error')
  return toCsv([
    [headers.row, headers.code, headers.name, headers.errors],
    ...failed.map((r) => [r.row, r.code, r.name, r.errors.join(' | ')]),
  ])
}

/** Columns the import accepts, in template order (API field names). */
export const IMPORT_COLUMNS = [
  'code',
  'name',
  'parent_code',
  'type',
  'normal_balance',
  'is_postable',
  'is_active',
  'currency_code',
  'requires_party',
  'requires_cost_center',
  'requires_project',
  'is_revaluable',
  'notes',
] as const

export function templateCsv(): string {
  return toCsv([
    [...IMPORT_COLUMNS],
    [
      '100',
      'Kasa',
      '',
      'asset',
      'debit',
      'false',
      'true',
      '',
      'false',
      'false',
      'false',
      'false',
      '',
    ],
    [
      '100.01',
      'Merkez Kasa',
      '100',
      'asset',
      'debit',
      'true',
      'true',
      '',
      'false',
      'false',
      'false',
      'false',
      '',
    ],
  ])
}

/** Saves text as a file in the browser (generated locally; no network request). */
export function saveTextFile(content: string, fileName: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024

export function isAcceptedFile(file: File): boolean {
  return /\.(csv|xlsx)$/i.test(file.name)
}
