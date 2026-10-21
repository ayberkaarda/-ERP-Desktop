import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  BARCODE_CASE,
  BARCODE_PCS,
  DOC_DRAFT,
  DOC_POSTED,
  ITEM_BOLT,
  UNIT_CASE,
  UNIT_PCS,
  WH_MAIN,
  WH_SECOND,
} from '@/test/handlers/inventoryDocs'
import { COMPANY_A } from '@/test/handlers/fea'
import type { StockDocumentInput } from '../types'
import { renderInvDocs, setupInvDocs } from '../testing'
import './StockDocumentListPage'
import './StockDocumentPage'

// Keyboard-driven flows through the real router are slow on a cold run.
vi.setConfig({ testTimeout: 20_000 })

async function scan(user: ReturnType<typeof userEvent.setup>, code: string) {
  const input = screen.getByLabelText('Barkod okut')
  await user.click(input)
  await user.keyboard(`${code}{Enter}`)
  await waitFor(() => expect(input).toHaveValue(''))
}

describe('stock document list', () => {
  beforeEach(() => window.localStorage.clear())

  it('lists documents with type and status and filters from the URL', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    const { router } = renderInvDocs(`/inventory/documents?filter[warehouse_id]=${WH_MAIN}`)
    const grid = await screen.findByRole('grid', { name: 'Stok fişleri' })
    expect(await within(grid).findByText('ISS2026000000001')).toBeInTheDocument()
    // Rows carry warehouse ids; the label comes from /stock-warehouses.
    expect((await within(grid).findAllByText('ANA · Ana depo')).length).toBeGreaterThan(0)
    expect(within(grid).getAllByText('Taslak').length).toBeGreaterThan(0)
    expect(within(grid).getByText('Kesinleşti')).toBeInTheDocument()
    expect(within(grid).getByText('Sayım')).toBeInTheDocument()
    const list = db.calls.filter((c) => c.method === 'GET' && c.path === '/stock-documents').at(-1)
    expect(list?.url.searchParams.get('filter[warehouse_id]')).toBe(WH_MAIN)

    await user.click(screen.getByRole('button', { name: /Yeni fiş/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Transfer' }))
    await waitFor(() => expect(router.state.location.search).toBe('?type=transfer'))
    expect(router.state.location.pathname).toBe('/inventory/documents/new')
  })

  it('hides creating without the create permission', async () => {
    setupInvDocs({ permissions: ['inventory.documents.view'] })
    renderInvDocs('/inventory/documents')
    await screen.findByRole('grid', { name: 'Stok fişleri' })
    expect(screen.queryByRole('button', { name: /Yeni fiş/ })).not.toBeInTheDocument()
  })

  it('needs the view permission', async () => {
    setupInvDocs({ permissions: ['inventory.reports.view'] })
    renderInvDocs('/inventory/documents')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })
})

describe('stock document editor', () => {
  it('adds lines by barcode with unit conversion, validates and saves a receipt', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    const { router } = renderInvDocs('/inventory/documents/new?type=receipt')
    await screen.findByRole('heading', { name: 'Yeni Giriş fişi' })
    // The company default warehouse is preselected.
    await waitFor(() => expect(screen.getByLabelText(/^Depo/)).toHaveValue('ANA · Ana depo'))

    await scan(user, BARCODE_CASE)
    const table = screen.getByRole('table', { name: 'Satırlar' })
    await waitFor(() => expect(within(table).getByLabelText('Birim, 1. satır')).toHaveValue('KOLI'))
    expect(within(table).getByLabelText('Miktar, 1. satır')).toHaveValue('1')
    expect(within(table).getByTestId('base-preview-0')).toHaveTextContent('= 24 ADET')

    // A second scan of the same barcode adds one more case to the line.
    await scan(user, BARCODE_CASE)
    await waitFor(() =>
      expect(within(table).getByTestId('base-preview-0')).toHaveTextContent('= 48 ADET'),
    )
    // A piece barcode is another unit: a new line.
    await scan(user, BARCODE_PCS)
    await waitFor(() => expect(within(table).getByLabelText('Birim, 2. satır')).toHaveValue('ADET'))

    // Receipts need a unit cost.
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    expect((await within(table).findAllByText('Geçerli bir birim maliyet girin.')).length).toBe(2)

    await user.click(within(table).getByLabelText('Birim maliyet, 1. satır'))
    await user.keyboard('120')
    await user.click(within(table).getByLabelText('Birim maliyet, 2. satır'))
    await user.keyboard('5,5')
    await user.tab()
    expect(screen.getByTestId('doc-totals')).toHaveTextContent('Toplam miktar: 49 ADET')
    expect(screen.getByTestId('doc-totals')).toHaveTextContent('Toplam maliyet: 245,50')

    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/inventory/documents/sd-new-1'),
    )
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/stock-documents')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    const body = post?.body as StockDocumentInput
    expect(body).toMatchObject({ doc_type: 'receipt', warehouse_id: WH_MAIN })
    expect(body.lines).toEqual([
      expect.objectContaining({
        item_id: ITEM_BOLT,
        unit_id: UNIT_CASE,
        quantity: '2',
        unit_cost: '120.000000',
      }),
      expect.objectContaining({
        item_id: ITEM_BOLT,
        unit_id: UNIT_PCS,
        quantity: '1',
        unit_cost: '5.500000',
      }),
    ])
  })

  it('posts an unchanged draft with only the post permission', async () => {
    const db = setupInvDocs({
      permissions: ['inventory.documents.view', 'inventory.documents.post'],
    })
    const user = userEvent.setup()
    const { queryClient } = renderInvDocs(`/inventory/documents/${DOC_DRAFT}`)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await screen.findByRole('heading', { name: 'Giriş fişi (taslak)' })
    expect(screen.queryByRole('button', { name: 'Taslağı kaydet' })).not.toBeInTheDocument()
    expect(screen.getByText('Bu fişi düzenleme yetkiniz yok.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Kesinleştir' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Fiş kesinleştirilsin mi?' })
    await user.click(within(dialog).getByRole('button', { name: 'Kesinleştir' }))
    expect(await screen.findByTestId('posted-number')).toHaveTextContent('REC2026000000001')
    const post = db.calls.find((c) => c.path === `/stock-documents/${DOC_DRAFT}/post`)
    expect(post?.body).toEqual({ version: 2 })
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(db.calls.some((c) => c.method === 'PATCH')).toBe(false)
    // Stock screens and reports of the company are refreshed after posting.
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(['inventory', COMPANY_A, 'stock-views', 'balances']))
    expect(keys).toContain(JSON.stringify(['inventory', COMPANY_A, 'docs', 'reports']))
  })

  it('reports a version conflict on save with a reload prompt', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs(`/inventory/documents/${DOC_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Satırlar' })
    // Someone else saves the draft meanwhile.
    const stored = db.documents.find((d) => d.id === DOC_DRAFT)
    if (stored) stored.version = 5
    await user.click(within(table).getByLabelText('Miktar, 1. satır'))
    await user.keyboard('{Control>}a{/Control}12')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    expect(await screen.findByText('Fiş başka biri tarafından değiştirildi')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yeniden yükle' }))
    await waitFor(() =>
      expect(screen.queryByText('Fiş başka biri tarafından değiştirildi')).not.toBeInTheDocument(),
    )
  })

  it('requires a different target warehouse on transfers', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs('/inventory/documents/new?type=transfer')
    await screen.findByRole('heading', { name: 'Yeni Transfer fişi' })
    expect(screen.getByLabelText(/^Kaynak depo/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText(/^Kaynak depo/)).toHaveValue('ANA · Ana depo'))
    await scan(user, BARCODE_PCS)
    // No unit cost on transfers: they move at source cost.
    expect(screen.queryByLabelText('Birim maliyet, 1. satır')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    expect(await screen.findAllByText('Hedef depoyu seçin.')).not.toHaveLength(0)

    const target = screen.getByLabelText(/^Hedef depo/)
    await user.click(target)
    await user.type(target, 'SUBE')
    await user.click(await screen.findByRole('option', { name: 'SUBE · Şube deposu' }))
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.method === 'POST' && c.path === '/stock-documents')).toBe(true),
    )
    const body = db.calls.find((c) => c.method === 'POST' && c.path === '/stock-documents')
      ?.body as StockDocumentInput
    expect(body).toMatchObject({ doc_type: 'transfer', target_warehouse_id: WH_SECOND })
    expect(body.lines[0]?.unit_cost).toBeNull()
    // Without inventory.documents.issue_expired the flag is not offered and stays false.
    expect(
      screen.queryByRole('checkbox', { name: /Süresi geçmiş lotlardan/ }),
    ).not.toBeInTheDocument()
    expect(body.allow_expired).toBe(false)
  })

  it('offers issuing from expired lots to permitted users and sends allow_expired', async () => {
    const db = setupInvDocs({
      permissions: [
        'inventory.documents.view',
        'inventory.documents.create',
        'inventory.documents.issue_expired',
        'items.view',
      ],
    })
    const user = userEvent.setup()
    renderInvDocs('/inventory/documents/new?type=issue')
    await screen.findByRole('heading', { name: 'Yeni Çıkış fişi' })
    await waitFor(() => expect(screen.getByLabelText(/^Depo/)).toHaveValue('ANA · Ana depo'))
    await scan(user, BARCODE_PCS)
    await user.click(
      screen.getByRole('checkbox', { name: 'Süresi geçmiş lotlardan çıkışa izin ver' }),
    )
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.method === 'POST' && c.path === '/stock-documents')).toBe(true),
    )
    const body = db.calls.find((c) => c.method === 'POST' && c.path === '/stock-documents')
      ?.body as StockDocumentInput
    expect(body).toMatchObject({ doc_type: 'issue', allow_expired: true })
  })

  it('sends adjustment lines with a direction and positive quantities', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    renderInvDocs('/inventory/documents/new?type=adjustment')
    await screen.findByRole('heading', { name: 'Yeni Düzeltme fişi' })
    await waitFor(() => expect(screen.getByLabelText(/^Depo/)).toHaveValue('ANA · Ana depo'))
    await scan(user, BARCODE_PCS)
    const table = screen.getByRole('table', { name: 'Satırlar' })
    await waitFor(() => expect(within(table).getByLabelText('Birim, 1. satır')).toHaveValue('ADET'))
    await user.selectOptions(within(table).getByLabelText('Yön, 1. satır'), 'out')
    // Outbound lines leave at the current cost: no cost to enter.
    expect(within(table).getByLabelText('Birim maliyet, 1. satır')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() =>
      expect(db.calls.some((c) => c.method === 'POST' && c.path === '/stock-documents')).toBe(true),
    )
    const body = db.calls.find((c) => c.method === 'POST' && c.path === '/stock-documents')
      ?.body as StockDocumentInput
    expect(body.lines[0]).toMatchObject({ quantity: '1', direction: 'out', unit_cost: null })
    expect(body).not.toHaveProperty('allow_expired')
  })
})

describe('posted stock document', () => {
  it('shows lines and the journal link, and reverses with a reason', async () => {
    const db = setupInvDocs()
    const user = userEvent.setup()
    const { queryClient } = renderInvDocs(`/inventory/documents/${DOC_POSTED}`)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await screen.findByRole('heading', { name: 'Çıkış ISS2026000000001' })
    expect(screen.getByRole('link', { name: 'Muhasebe fişini aç' })).toHaveAttribute(
      'href',
      '/accounting/journal-entries/je-77',
    )
    // Lines carry ids; item and unit labels come from Catalog.
    expect(await screen.findByText('Cıvata M8')).toBeInTheDocument()
    expect(screen.getByText('ADET')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Ters kayıt' }))
    const dialog = await screen.findByRole('dialog', {
      name: 'ISS2026000000001 ters kayıtla iptal edilsin mi?',
    })
    await user.click(within(dialog).getByRole('button', { name: 'Ters kaydı oluştur' }))
    expect(await within(dialog).findByText('Gerekçe en az 3 karakter olmalı.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Gerekçe/), 'Yanlış depo')
    await user.click(within(dialog).getByRole('button', { name: 'Ters kaydı oluştur' }))
    expect(await screen.findByText(/ters kayıtla iptal edildi: Yanlış depo/)).toBeInTheDocument()
    const call = db.calls.find((c) => c.path === `/stock-documents/${DOC_POSTED}/reverse`)
    expect(call?.body).toMatchObject({ reason: 'Yanlış depo', version: 3 })
    // The same document comes back cancelled; no second document is created.
    expect(db.documents.find((d) => d.id === DOC_POSTED)).toMatchObject({
      status: 'cancelled',
      reversal_reason: 'Yanlış depo',
    })
    expect(db.documents).toHaveLength(3)
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Ters kayıt' })).not.toBeInTheDocument()
    const keys = invalidate.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))
    expect(keys).toContain(JSON.stringify(['inventory', COMPANY_A, 'stock-views', 'movements']))
  })

  it('hides reversing without the reverse permission', async () => {
    setupInvDocs({ permissions: ['inventory.documents.view'] })
    renderInvDocs(`/inventory/documents/${DOC_POSTED}`)
    await screen.findByRole('heading', { name: 'Çıkış ISS2026000000001' })
    expect(screen.queryByRole('button', { name: 'Ters kayıt' })).not.toBeInTheDocument()
  })
})
