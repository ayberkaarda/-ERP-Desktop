import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DOC_COUNT, WH_MAIN } from '@/test/handlers/inventoryDocs'
import type { CountStartInput, CountUpdateInput } from '../../documents/types'
import { renderInvDocs, setupInvDocs } from '../../documents/testing'
import './CountPage'
import './CountStartPage'

vi.setConfig({ testTimeout: 20_000 })

const counted = (code: string) => screen.getByLabelText(new RegExp(`^Sayılan, ${code}`))

describe('stock count', () => {
  it('starts a count with a frozen scope', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    const { router } = renderInvDocs('/inventory/counts/new')
    await screen.findByRole('heading', { name: 'Sayım başlat' })
    await waitFor(() => expect(screen.getByLabelText(/^Depo/)).toHaveValue('ANA · Ana depo'))
    await user.click(screen.getByRole('button', { name: 'Dondur ve başlat' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/counts/sd-new-1'))
    const call = db.calls.find((c) => c.method === 'POST' && c.path === '/stock-documents')
    expect(call?.body).toMatchObject({
      doc_type: 'count',
      freeze: true,
      warehouse_id: WH_MAIN,
      location_id: null,
      include_zero: false,
    } satisfies Partial<CountStartInput>)
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(await screen.findByTestId('count-progress')).toHaveTextContent('0 / 1 satır sayıldı')
  })

  it('enters counts from the keyboard with a live variance, saves and posts', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs(`/inventory/counts/${DOC_COUNT}`)
    await screen.findByRole('heading', { name: 'Sayım (taslak)' })
    expect(screen.getByTestId('count-progress')).toHaveTextContent('1 / 3 satır sayıldı')
    // Posting waits for every line.
    expect(screen.getByRole('button', { name: 'Kesinleştir' })).toBeDisabled()

    await user.click(counted('STK-001'))
    await user.keyboard('98{Enter}')
    // Enter moves to the next line's counted cell.
    await waitFor(() => expect(counted('STK-002 L-0925')).toHaveFocus())
    await user.keyboard('41')
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(counted('STK-001')).toHaveFocus())
    expect(screen.getByTestId(`variance-${DOC_COUNT}-l1`)).toHaveTextContent('-2')
    expect(screen.getByTestId(`variance-${DOC_COUNT}-l2`)).toHaveTextContent('1')
    // 2 × 2,50 loss; 1 × 30,00 gain.
    expect(screen.getByTestId('count-loss')).toHaveTextContent('5,00')
    expect(screen.getByTestId('count-gain')).toHaveTextContent('30,00')
    expect(screen.getByTestId('count-net')).toHaveTextContent('25,00')

    await user.click(screen.getByRole('checkbox', { name: 'Yalnızca farklı satırlar' }))
    expect(screen.queryByTestId(`count-row-${DOC_COUNT}-l3`)).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Yalnızca farklı satırlar' }))

    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(db.calls.some((c) => c.method === 'PATCH')).toBe(true))
    const patch = db.calls.find((c) => c.method === 'PATCH')?.body as CountUpdateInput
    expect(patch).toEqual({
      version: 1,
      lines: [
        { id: `${DOC_COUNT}-l1`, counted_quantity: '98.000000' },
        { id: `${DOC_COUNT}-l2`, counted_quantity: '41.000000' },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Kesinleştir' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Fiş kesinleştirilsin mi?' })
    expect(dialog).toHaveTextContent('30,00 fazla · 5,00 eksik · net 25,00')
    await user.click(within(dialog).getByRole('button', { name: 'Kesinleştir' }))
    expect(await screen.findByTestId('posted-number')).toHaveTextContent('SAY-2026-000001')
    const post = db.calls.find((c) => c.path === `/stock-documents/${DOC_COUNT}/post`)
    expect(post?.body).toEqual({ version: 2 })
  })

  it('imports counts from CSV after a clean dry run', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs(`/inventory/counts/${DOC_COUNT}`)
    await screen.findByRole('heading', { name: 'Sayım (taslak)' })
    await user.click(screen.getByRole('button', { name: 'CSV içe aktar' }))
    const dialog = await screen.findByRole('dialog', { name: "Sayım CSV'si içe aktar" })
    const input = within(dialog).getByLabelText(/^CSV dosyası/)

    const bad = new File(
      ['item_code,lot_no,location_code,counted_quantity\nSTK-001,,A-01,97\nSTK-999,,A-01,3\n'],
      'sayim.csv',
      { type: 'text/csv' },
    )
    await user.upload(input, bad)
    await user.click(within(dialog).getByRole('button', { name: 'Dene' }))
    expect(await within(dialog).findByText('1 uygun, 1 hatalı satır')).toBeInTheDocument()
    expect(within(dialog).getByText('Sayım satırı bulunamadı.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /satırı uygula/ })).toBeDisabled()

    const good = new File(
      [
        'item_code,lot_no,location_code,counted_quantity\nSTK-001,,A-01,97\nSTK-002,L-0925,A-01,40\n',
      ],
      'sayim.csv',
      { type: 'text/csv' },
    )
    await user.upload(input, good)
    await user.click(within(dialog).getByRole('button', { name: 'Dene' }))
    expect(await within(dialog).findByText('2 uygun, 0 hatalı satır')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '2 satırı uygula' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('count-progress')).toHaveTextContent('3 / 3 satır sayıldı')
    expect(counted('STK-001')).toHaveValue('97')
    expect(db.uploads.map((u) => u.dryRun)).toEqual(['1', '1', '0'])
  })

  it('refuses a non-CSV file', async () => {
    setupInvDocs()
    const user = userEvent.setup({ applyAccept: false })
    renderInvDocs(`/inventory/counts/${DOC_COUNT}`)
    await screen.findByRole('heading', { name: 'Sayım (taslak)' })
    await user.click(screen.getByRole('button', { name: 'CSV içe aktar' }))
    const dialog = await screen.findByRole('dialog', { name: "Sayım CSV'si içe aktar" })
    await user.upload(
      within(dialog).getByLabelText(/^CSV dosyası/),
      new File(['x'], 'sayim.xlsx', { type: 'application/octet-stream' }),
    )
    expect(await within(dialog).findByText('Yalnızca .csv dosyası seçin.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Dene' })).toBeDisabled()
  })

  it('is read-only without the create permission', async () => {
    setupInvDocs({ permissions: ['inventory.documents.view'] })
    renderInvDocs(`/inventory/counts/${DOC_COUNT}`)
    await screen.findByRole('heading', { name: 'Sayım (taslak)' })
    expect(counted('STK-001')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'CSV içe aktar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kesinleştir' })).not.toBeInTheDocument()
  })
})
