import { COMPANY_A } from '@/test/handlers/fea'
import { XLSX_BYTES } from '@/test/handlers/accounting2'
import { setupAccounting2 } from '../testing'
import { downloadFile, EXPORT_MIME, exportFilename, exportPath } from './download'

function captureDownloads() {
  const saved: { blob: Blob; name: string }[] = []
  let last: Blob | null = null
  Object.assign(URL, {
    createObjectURL: vi.fn((b: Blob) => {
      last = b
      return 'blob:x'
    }),
    revokeObjectURL: vi.fn(),
  })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (last) saved.push({ blob: last, name: this.download })
  })
  return { saved, restore: () => click.mockRestore() }
}

describe('downloadFile', () => {
  it('downloads CSV through the platform client with the server file name', async () => {
    const db = setupAccounting2()
    const { saved, restore } = captureDownloads()
    await downloadFile(exportPath('/reports/trial-balance'), {
      params: { format: 'csv', date_from: '2026-01-01', date_to: '2026-01-31' },
      mime: EXPORT_MIME.csv,
      filename: exportFilename('mizan', 'csv', '2026-01-31'),
    })
    const call = db.calls.find((c) => c.path === '/reports/trial-balance/export')
    expect(call?.url.searchParams.get('format')).toBe('csv')
    expect(call?.headers.get('X-Company-Id')).toBe(COMPANY_A)
    expect(saved[0]?.name).toBe('trial-balance-20260121-100000.csv')
    expect(await saved[0]?.blob.text()).toContain('/reports/trial-balance/export')
    restore()
  })

  it('keeps XLSX bytes intact (no text round trip)', async () => {
    setupAccounting2()
    const { saved, restore } = captureDownloads()
    await downloadFile(exportPath('/journal-entries'), {
      params: { format: 'xlsx' },
      mime: EXPORT_MIME.xlsx,
      filename: 'fallback.xlsx',
    })
    const bytes = new Uint8Array(await (saved[0]?.blob ?? new Blob()).arrayBuffer())
    expect([...bytes]).toEqual(XLSX_BYTES)
    expect(saved[0]?.name).toBe('journal-20260121-100000.xlsx')
    restore()
  })

  it('builds export paths and fallback names', () => {
    expect(exportPath('/journal-entries/')).toBe('/journal-entries/export')
    expect(exportFilename('mizan', 'xlsx', '2026-01-31')).toBe('mizan-2026-01-31.xlsx')
  })
})
