import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { COMPANY_A, COMPANY_B } from '@/test/handlers/fea'
import { DOC_COUNT, ITEM_BOLT, LOC_A2, WH_MAIN } from '@/test/handlers/inventoryDocs'
import { server } from '@/test/msw/server'
import { useCompanyStore } from '@/stores/company'
import { invDocsKeys } from '../../documents/api/keys'
import type { CountStartInput, CountUpdateInput } from '../../documents/types'
import { renderInvDocs, setupInvDocs } from '../../documents/testing'
import './CountPage'
import './CountStartPage'

vi.setConfig({ testTimeout: 20_000 })

const counted = (code: string) => screen.getByLabelText(new RegExp(`^Sayılan, ${code}`))

describe('stock count', () => {
  it('starts a count by freezing the warehouse balances', async () => {
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
      notes: null,
    } satisfies Partial<CountStartInput>)
    expect(call?.body).not.toHaveProperty('item_ids')
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    // One non-zero balance in the warehouse: one frozen line, labelled from Catalog.
    expect(await screen.findByTestId('count-progress')).toHaveTextContent('0 / 1 satır sayıldı')
    expect(await screen.findByText('Cıvata M8')).toBeInTheDocument()
  })

  it('starts an empty count without freezing', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs('/inventory/counts/new')
    await screen.findByRole('heading', { name: 'Sayım başlat' })
    await waitFor(() => expect(screen.getByLabelText(/^Depo/)).toHaveValue('ANA · Ana depo'))
    await user.click(screen.getByRole('checkbox', { name: /Mevcut stoğu dondur/ }))
    await user.click(screen.getByRole('button', { name: 'Boş sayım başlat' }))
    expect(await screen.findByText('Bu sayımda satır yok.')).toBeInTheDocument()
    const call = db.calls.find((c) => c.method === 'POST' && c.path === '/stock-documents')
    expect(call?.body).toMatchObject({ doc_type: 'count', freeze: false })
  })

  it('enters counts from the keyboard with a live variance, saves and posts', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs(`/inventory/counts/${DOC_COUNT}`)
    await screen.findByRole('heading', { name: 'Sayım (taslak)' })
    expect(screen.getByTestId('count-progress')).toHaveTextContent('1 / 3 satır sayıldı')
    // Uncounted lines are skipped when posting, so one counted line is enough.
    expect(screen.getByRole('button', { name: 'Kesinleştir' })).toBeEnabled()

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
    const patch = db.calls.find((c) => c.method === 'PATCH')
    expect(patch?.path).toBe(`/stock-documents/${DOC_COUNT}/counts`)
    expect(patch?.body as CountUpdateInput).toEqual({
      version: 1,
      counts: [
        { line_id: `${DOC_COUNT}-l1`, counted_quantity: '98.000000' },
        { line_id: `${DOC_COUNT}-l2`, counted_quantity: '41.000000' },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'Kesinleştir' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Fiş kesinleştirilsin mi?' })
    expect(dialog).toHaveTextContent('30,00 fazla · 5,00 eksik · net 25,00')
    await user.click(within(dialog).getByRole('button', { name: 'Kesinleştir' }))
    expect(await screen.findByTestId('posted-number')).toHaveTextContent('CNT2026000000001')
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
      ['item_code,counted_quantity,location_code,lot_no\nSTK-001,97,A-01,\nSTK-999,3,A-01,\n'],
      'sayim.csv',
      { type: 'text/csv' },
    )
    await user.upload(input, bad)
    await user.click(within(dialog).getByRole('button', { name: 'Dene' }))
    expect(await within(dialog).findByText('2 satırdan 1 uygun')).toBeInTheDocument()
    expect(within(dialog).getByText('Stok kartı bulunamadı: STK-999')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /satırı uygula/ })).toBeDisabled()

    const good = new File(
      [
        'item_code;counted_quantity;location_code;lot_no\nSTK-001;97;A-01;\nSTK-002;40;A-01;L-0925\n',
      ],
      'sayim.csv',
      { type: 'text/csv' },
    )
    await user.upload(input, good)
    await user.click(within(dialog).getByRole('button', { name: 'Dene' }))
    expect(await within(dialog).findByText('2 satırdan 2 uygun')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '2 satırı uygula' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('count-progress')).toHaveTextContent('3 / 3 satır sayıldı')
    expect(counted('STK-001')).toHaveValue('97')
    expect(db.uploads.map((u) => u.dryRun)).toEqual(['1', '1', '0'])
    expect(db.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toContain(
      `/stock-documents/${DOC_COUNT}/import`,
    )
  })

  it('adds a line for stock found outside the snapshot', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs(`/inventory/counts/${DOC_COUNT}`)
    await screen.findByRole('heading', { name: 'Sayım (taslak)' })
    await user.click(screen.getByRole('button', { name: 'Satır ekle' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sayım satırı ekle' })
    await user.type(within(dialog).getByLabelText(/^Stok kartı/), 'STK-001')
    await user.click(await screen.findByRole('option', { name: /STK-001 · Cıvata M8/ }))
    await user.type(within(dialog).getByLabelText(/^Lokasyon/), 'A-02')
    await user.click(await screen.findByRole('option', { name: 'A-02 · Raf A-02' }))
    await user.click(within(dialog).getByLabelText(/^Sayılan/))
    await user.keyboard('3')
    await user.click(within(dialog).getByRole('button', { name: 'Satır ekle' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const patch = db.calls.find((c) => c.method === 'PATCH')
    expect(patch?.path).toBe(`/stock-documents/${DOC_COUNT}/counts`)
    expect(patch?.body).toMatchObject({
      version: 1,
      counts: [],
      add: [{ item_id: ITEM_BOLT, location_id: LOC_A2, lot_no: null }],
    })
    await waitFor(() =>
      expect(screen.getByTestId('count-progress')).toHaveTextContent('2 / 4 satır sayıldı'),
    )
  })

  /**
   * Offline (desktop), a saved `add` is read back from the local queue before the push: the
   * line has no id, line_no or system quantity yet. Two such lines are appended here.
   */
  function withPendingLines(db: ReturnType<typeof setupInvDocs>) {
    const doc = db.documents.find((d) => d.id === DOC_COUNT)
    if (!doc) throw new Error('count fixture missing')
    type Line = (typeof doc.lines)[number]
    for (const [index, counted_quantity] of [
      [0, '3.000000'],
      [1, null],
    ] as const) {
      const source = doc.lines[index]
      if (!source) throw new Error('count line missing')
      const l: Partial<Line> = { ...source, counted_quantity }
      delete l.id
      delete l.line_no
      delete l.system_quantity
      delete l.difference
      doc.lines.push(l as Line)
    }
  }

  it('keeps lines the server has not confirmed yet read-only and out of the saved counts', async () => {
    const db = setupInvDocs()
    withPendingLines(db)
    const user = userEvent.setup()
    renderInvDocs(`/inventory/counts/${DOC_COUNT}`)
    await screen.findByRole('heading', { name: 'Sayım (taslak)' })

    // Both id-less lines render as their own rows (no shared key), marked and locked.
    const first = screen.getByTestId('count-row-pending-3')
    const second = screen.getByTestId('count-row-pending-4')
    for (const row of [first, second]) {
      expect(row).toHaveTextContent('Bekliyor — gönderildikten sonra düzenlenebilir')
      expect(within(row).getByRole('textbox')).toBeDisabled()
    }
    expect(within(first).getByRole('textbox')).toHaveValue('3')
    expect(within(second).getByRole('textbox')).toHaveValue('')
    expect(screen.getByTestId('count-progress')).toHaveTextContent('2 / 5 satır sayıldı')

    // Editing a confirmed line and saving sends only that line: the batch stays valid.
    const bolt = within(screen.getByTestId(`count-row-${DOC_COUNT}-l1`)).getByRole('textbox')
    await user.click(bolt)
    await user.keyboard('98')
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(db.calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(db.calls.find((c) => c.method === 'PATCH')?.body as CountUpdateInput).toEqual({
      version: 1,
      counts: [{ line_id: `${DOC_COUNT}-l1`, counted_quantity: '98.000000' }],
    })
    // Saved: nothing left to send.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sayımı kaydet' })).toBeDisabled(),
    )
    expect(screen.getAllByText('Bekliyor — gönderildikten sonra düzenlenebilir')).toHaveLength(2)
    // Adding another line stays possible.
    expect(screen.getByRole('button', { name: 'Satır ekle' })).toBeEnabled()
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

  /** Holds import requests until released; they then reach the in-memory API. */
  function gateImports() {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('*/api/v1/stock-documents/:id/import', async () => {
        await gate
        return undefined
      }),
    )
    return () => release()
  }

  /** A count CSV with the header and the given rows. */
  const csv = (...rows: string[]) =>
    new File(
      [['item_code,counted_quantity,location_code,lot_no', ...rows, ''].join('\n')],
      'sayim.csv',
      { type: 'text/csv' },
    )

  it('locks the file while a dry run runs and binds the preview to that file', async () => {
    setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs(`/inventory/counts/${DOC_COUNT}`)
    await screen.findByRole('heading', { name: 'Sayım (taslak)' })
    await user.click(screen.getByRole('button', { name: 'CSV içe aktar' }))
    const dialog = await screen.findByRole('dialog', { name: "Sayım CSV'si içe aktar" })
    const input = within(dialog).getByLabelText(/^CSV dosyası/)
    await user.upload(input, csv('STK-001,97,A-01,', 'STK-002,40,A-01,L-0925'))
    const release = gateImports()
    await user.click(within(dialog).getByRole('button', { name: 'Dene' }))
    await waitFor(() => expect(input).toBeDisabled())
    release()
    expect(await within(dialog).findByText('2 satırdan 2 uygun')).toBeInTheDocument()
    expect(input).toBeEnabled()
    expect(within(dialog).getByRole('button', { name: '2 satırı uygula' })).toBeEnabled()
    // Another file drops the preview: it has not been tried yet.
    await user.upload(input, csv('STK-001,1,A-01,'))
    expect(within(dialog).queryByText('2 satırdan 2 uygun')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /satırı uygula/ })).toBeDisabled()
  })

  it('writes an import finished after a company switch to the starting company only', async () => {
    setupInvDocs()
    const user = userEvent.setup()
    const { queryClient } = renderInvDocs(`/inventory/counts/${DOC_COUNT}`)
    await screen.findByRole('heading', { name: 'Sayım (taslak)' })
    await user.click(screen.getByRole('button', { name: 'CSV içe aktar' }))
    const dialog = await screen.findByRole('dialog', { name: "Sayım CSV'si içe aktar" })
    await user.upload(within(dialog).getByLabelText(/^CSV dosyası/), csv('STK-001,97,A-01,'))
    await user.click(within(dialog).getByRole('button', { name: 'Dene' }))
    await within(dialog).findByText('1 satırdan 1 uygun')
    const setData = vi.spyOn(queryClient, 'setQueryData')
    const release = gateImports()
    await user.click(within(dialog).getByRole('button', { name: '1 satırı uygula' }))
    useCompanyStore.setState({ activeCompanyId: COMPANY_B })
    release()
    await waitFor(() =>
      expect(setData.mock.calls.map((call) => JSON.stringify(call[0]))).toContain(
        JSON.stringify(invDocsKeys.document(DOC_COUNT, COMPANY_A)),
      ),
    )
    expect(setData.mock.calls.map((call) => JSON.stringify(call[0]))).not.toContain(
      JSON.stringify(invDocsKeys.document(DOC_COUNT, COMPANY_B)),
    )
  })
})
