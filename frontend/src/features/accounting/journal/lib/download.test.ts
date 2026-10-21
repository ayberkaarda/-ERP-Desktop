import { COMPANY_A } from '@/test/handlers/fea'
import { setupAccounting2 } from '../testing'
import { downloadFile, EXPORT_MIME, exportFilename, exportPath, toBlob } from './download'

describe('downloadFile', () => {
  it('fetches the export through the platform client and hands the file to the browser', async () => {
    const db = setupAccounting2()
    const created: Blob[] = []
    const createObjectURL = vi.fn((b: Blob) => {
      created.push(b)
      return 'blob:x'
    })
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    await downloadFile(exportPath('/reports/trial-balance'), {
      params: { format: 'csv', date_from: '2026-01-01' },
      mime: EXPORT_MIME.csv,
      filename: exportFilename('mizan', 'csv', '2026-01-31'),
    })

    const call = db.calls.find((c) => c.path === '/reports/trial-balance/export')
    expect(call?.url.searchParams.get('format')).toBe('csv')
    expect(call?.headers.get('X-Company-Id')).toBe(COMPANY_A)
    expect(click).toHaveBeenCalledOnce()
    expect(await created[0]?.text()).toContain('/reports/trial-balance/export')
    expect(created[0]?.type).toBe('text/csv')
    click.mockRestore()
  })

  it('wraps any body in a blob of the right type', async () => {
    expect(await toBlob('a;b', 'text/csv').text()).toBe('a;b')
    expect(toBlob(new Uint8Array([1, 2]), EXPORT_MIME.xlsx).size).toBe(2)
    expect(exportPath('/journal-entries/')).toBe('/journal-entries/export')
  })
})
