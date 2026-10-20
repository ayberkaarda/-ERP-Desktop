import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createWebHttp } from '@/platform/web/http'
import { createFileHandlers } from '@/test/handlers/feb'
import { server } from '@/test/msw/server'
import { AttachmentPanel } from './AttachmentPanel'
import { createFilesApi } from './filesApi'
import type { AttachmentApi } from './types'

const doc = { type: 'sales_invoice', id: 'inv-1' }

function setup(seed = true) {
  const { handlers, files } = createFileHandlers(
    seed
      ? [
          {
            id: 'file-1',
            original_name: 'teklif.pdf',
            mime_type: 'application/pdf',
            size: 2048,
            created_at: '2026-10-20T10:00:00Z',
            uploaded_by: { id: 'u1', name: 'Ayşe Demir' },
            attachable_type: doc.type,
            attachable_id: doc.id,
          },
          {
            id: 'file-x',
            original_name: 'baska-belge.pdf',
            mime_type: 'application/pdf',
            size: 10,
            created_at: '2026-10-20T10:00:00Z',
            attachable_type: doc.type,
            attachable_id: 'inv-2',
          },
        ]
      : [],
  )
  server.use(...handlers)
  const api = createFilesApi(createWebHttp(), doc)
  return { api, files }
}

const pdf = (name: string, bytes = 100) =>
  new File(['x'.repeat(bytes)], name, { type: 'application/pdf' })

describe('AttachmentPanel', () => {
  it('lists the document files from /files with download links', async () => {
    const { api } = setup()
    render(<AttachmentPanel api={api} />)
    const link = await screen.findByRole('link', { name: 'teklif.pdf' })
    expect(link).toHaveAttribute('href', '/api/v1/files/file-1/download')
    expect(screen.queryByText('baska-belge.pdf')).not.toBeInTheDocument()
    expect(screen.getByText(/2 kB · 20\.10\.2026 13:00 · Ayşe Demir/)).toBeInTheDocument()
  })

  it('uploads through POST /files and shows the new file', async () => {
    const user = userEvent.setup()
    const { api, files } = setup(false)
    render(<AttachmentPanel api={api} />)
    expect(await screen.findByText('Henüz ek yok.')).toBeInTheDocument()

    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('file input missing')
    await user.upload(input, pdf('fatura.pdf'))
    expect(await screen.findByRole('link', { name: 'fatura.pdf' })).toBeInTheDocument()
    const stored = [...files.values()][0]
    expect(stored).toMatchObject({
      original_name: 'fatura.pdf',
      attachable_type: 'sales_invoice',
      attachable_id: 'inv-1',
    })
  })

  it('rejects too large or unsupported files before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const upload = vi.fn()
    const api: AttachmentApi = {
      list: () => Promise.resolve([]),
      upload,
      remove: () => Promise.resolve(),
      downloadUrl: (id) => `/api/v1/files/${id}/download`,
    }
    render(<AttachmentPanel api={api} maxBytes={50} />)
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('file input missing')
    await user.upload(input, [pdf('buyuk.pdf', 51), new File(['x'], 'virus.exe')])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('buyuk.pdf çok büyük (en fazla 50 bayt).')
    expect(alert).toHaveTextContent('virus.exe dosya türü desteklenmiyor.')
    expect(upload).not.toHaveBeenCalled()
  })

  it('maps server upload errors', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const { api } = setup(false)
    render(<AttachmentPanel api={api} accept={['pdf', 'exe']} />)
    await screen.findByText('Henüz ek yok.')
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    if (!input) throw new Error('file input missing')
    await user.upload(input, new File(['x'], 'kur.exe'))
    expect(await screen.findByRole('alert')).toHaveTextContent('kur.exe dosya türü desteklenmiyor.')
  })

  it('deletes after confirmation via DELETE /files/{id}', async () => {
    const user = userEvent.setup()
    const { api, files } = setup()
    render(<AttachmentPanel api={api} />)
    await user.click(await screen.findByRole('button', { name: 'teklif.pdf dosyasını sil' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('teklif.pdf kalıcı olarak silinecek.')
    await user.click(within(dialog).getByRole('button', { name: 'Sil' }))
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'teklif.pdf' })).not.toBeInTheDocument(),
    )
    expect(files.has('file-1')).toBe(false)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('offers a retry when the list fails', async () => {
    const user = userEvent.setup()
    let calls = 0
    const api: AttachmentApi = {
      list: () => (++calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve([])),
      upload: () => Promise.reject(new Error('no')),
      remove: () => Promise.resolve(),
      downloadUrl: () => '#',
    }
    render(<AttachmentPanel api={api} readOnly />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Ekler yüklenemedi.')
    await user.click(within(alert).getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByText('Henüz ek yok.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dosya seç' })).not.toBeInTheDocument()
  })
})
