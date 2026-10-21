import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { server } from '@/test/msw/server'
import { renderAccounting, setupAccounting } from '../../shared/testing'
import '../pages/ChartOfAccountsPage'

const csv = (body: string, name = 'plan.csv') =>
  new File([body], name, { type: 'text/csv', lastModified: 1_700_000_000_000 })

async function openWizard() {
  const user = userEvent.setup()
  renderAccounting('/accounting/accounts')
  await screen.findByRole('tree', { name: 'Hesap planı' })
  await user.click(screen.getByRole('button', { name: 'İçe aktar' }))
  const dialog = await screen.findByRole('dialog', { name: 'Hesap planı içe aktarma' })
  return { user, dialog }
}

describe('ImportWizard', () => {
  it('blocks file changes while a dry run is pending and shows the report for that file', async () => {
    setupAccounting()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // Hold the first upload until released, then let the in-memory API answer it.
    server.use(
      http.post('*/api/v1/accounts/import', async () => {
        await gate
        return undefined
      }),
    )
    const { user, dialog } = await openWizard()
    const input = within(dialog).getByLabelText('Dosya')
    await user.upload(input, csv('code,name,type\n150,İlk Madde,asset\n', 'a.csv'))
    const run = within(dialog).getByRole('button', { name: 'Deneme çalıştır' })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    await waitFor(() => expect(input).toBeDisabled())
    release()
    expect(await within(dialog).findByText('Deneme sonucu: a.csv')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'İçe aktar' })).toBeEnabled()
  })

  it('derives the idempotency key from the content, not name, size or time', async () => {
    const db = setupAccounting()
    const { user, dialog } = await openWizard()
    // Same name, size and modification time; different bytes.
    await user.upload(within(dialog).getByLabelText('Dosya'), csv('code,name\n150,AAAA\n'))
    await user.click(
      await waitFor(() => {
        const b = within(dialog).getByRole('button', { name: 'Deneme çalıştır' })
        expect(b).toBeEnabled()
        return b
      }),
    )
    await within(dialog).findByText('Deneme sonucu: plan.csv')
    await user.click(within(dialog).getByRole('button', { name: 'Geri' }))
    await user.upload(within(dialog).getByLabelText('Dosya'), csv('code,name\n150,BBBB\n'))
    const run = within(dialog).getByRole('button', { name: 'Deneme çalıştır' })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    await within(dialog).findByText('Deneme sonucu: plan.csv')
    const keys = db.calls
      .filter((c) => c.path === '/accounts/import')
      .map((c) => c.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('reports rows that failed during the real import and offers the error report', async () => {
    setupAccounting({
      db: {
        commitFailures: [
          {
            row: 9,
            code: '151',
            name: 'Yarı Mamul',
            status: 'error',
            errors: ['Kilit çakışması.'],
          },
        ],
      },
    })
    const { user, dialog } = await openWizard()
    await user.upload(within(dialog).getByLabelText('Dosya'), csv('code,name\n150,İlk Madde\n'))
    const run = within(dialog).getByRole('button', { name: 'Deneme çalıştır' })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    await user.click(await within(dialog).findByRole('button', { name: 'İçe aktar' }))
    expect(await within(dialog).findByText(/1 satır içe aktarılamadı/)).toBeInTheDocument()
    expect(within(dialog).getByText('Kilit çakışması.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Hata raporunu indir' })).toBeInTheDocument()
  })

  it('pages large result tables instead of rendering every row', async () => {
    setupAccounting()
    const { user, dialog } = await openWizard()
    const lines = Array.from({ length: 250 }, (_, i) => `${900000 + i},Hesap ${i}`).join('\n')
    await user.upload(within(dialog).getByLabelText('Dosya'), csv(`code,name\n${lines}\n`))
    const run = within(dialog).getByRole('button', { name: 'Deneme çalıştır' })
    await waitFor(() => expect(run).toBeEnabled())
    await user.click(run)
    const table = await within(dialog).findByRole('table', {
      name: 'Deneme çalıştırması satır sonuçları',
    })
    expect(within(table).getAllByRole('row')).toHaveLength(101)
    expect(within(dialog).getByText('Sayfa 1 / 3')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Sonraki' }))
    expect(within(table).getByText('900100')).toBeInTheDocument()
  })
})
