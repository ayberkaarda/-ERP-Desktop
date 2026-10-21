import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { ITEM_BOLT, U_PCS } from '@/test/handlers/catalog'
import { server } from '@/test/msw/server'
import { renderCatalog, setupCatalog } from '../testing'
import './ItemFormPage'

async function pickOption(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  text: string,
) {
  await user.click(input)
  await user.type(input, text)
  await user.click(await screen.findByRole('option', { name: new RegExp(text) }))
}

describe('ItemFormPage', () => {
  it('creates an item and opens it', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    const { router } = renderCatalog('/catalog/items/new')

    const name = await screen.findByLabelText(/^Ad/)
    expect(screen.getByRole('tab', { name: 'Barkodlar' })).toBeDisabled()
    await user.type(name, 'Somun M8')
    await pickOption(user, screen.getByRole('combobox', { name: /Temel birim/ }), 'ADET')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/catalog\/items\/item-new-/),
    )
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/items')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(post?.body).toMatchObject({
      name: 'Somun M8',
      base_unit_id: U_PCS,
      type: 'stock',
      tracking: 'none',
    })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Barkodlar' })).toBeEnabled())
  })

  it('clears stock-only fields for services and validates attributes', async () => {
    setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/items/new')
    await user.selectOptions(await screen.findByLabelText(/^Tür/), 'service')
    expect(screen.getByLabelText(/^Takip/)).toBeDisabled()
    expect(screen.getByText('Hizmetlerde stok takibi yapılmaz.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Özellik ekle' }))
    await user.click(screen.getByRole('button', { name: 'Özellik ekle' }))
    await user.type(screen.getByLabelText('1. özellik adı'), 'Renk')
    await user.type(screen.getByLabelText('2. özellik adı'), 'renk')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByText('Bu özellik adı zaten kullanılıyor.')).toBeInTheDocument()
    expect(screen.getAllByText('Bu alan zorunludur.').length).toBeGreaterThan(0)
  })

  it('maps server field errors onto the form', async () => {
    setupCatalog()
    server.use(
      http.patch('*/api/v1/items/:id', () =>
        HttpResponse.json(
          {
            errors: {
              message: 'Gönderilen bilgiler geçersiz.',
              code: 'VALIDATION_FAILED',
              fields: { name: ['Bu ad başka bir kartta kullanılıyor.'], weird: ['Sunucu notu.'] },
            },
          },
          { status: 422 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderCatalog(`/catalog/items/${ITEM_BOLT}`)
    const name = await screen.findByLabelText(/^Ad/)
    await waitFor(() => expect(name).toHaveValue('Cıvata M8'))
    await user.type(name, 'X')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    const summary = await screen.findByText('Kayıt tamamlanamadı')
    expect(summary).toBeInTheDocument()
    expect(screen.getByText('Sunucu notu.')).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText('Bu ad başka bir kartta kullanılıyor.').length).toBeGreaterThan(0)
  })

  it('handles a version conflict with a reload', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog(`/catalog/items/${ITEM_BOLT}`)
    const name = await screen.findByLabelText(/^Ad/)
    await waitFor(() => expect(name).toHaveValue('Cıvata M8'))
    const bolt = db.items.find((i) => i.id === ITEM_BOLT)
    if (bolt) {
      bolt.version = 3
      bolt.name = 'Cıvata M8 (yeni)'
    }
    await user.type(name, ' çinko')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByText('Kayıt başka biri tarafından değiştirildi')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Son hâli yükle' }))
    await waitFor(() => expect(screen.getByLabelText(/^Ad/)).toHaveValue('Cıvata M8 (yeni)'))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(bolt?.version).toBe(4))
  })

  it('validates barcode check digits before saving', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog(`/catalog/items/${ITEM_BOLT}?tab=barcodes`)
    expect(await screen.findByText('4006381333931')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Barkod ekle' }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByRole('textbox', { name: /^Barkod/ })
    await user.type(input, '5901234123450')
    expect(within(dialog).getByText('Kontrol hanesi 7 olmalı.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(await within(dialog).findAllByText('Kontrol hanesi hatalı.')).not.toHaveLength(0)
    expect(db.calls.some((c) => c.method === 'POST' && c.path.endsWith('/barcodes'))).toBe(false)

    await user.clear(input)
    await user.type(input, '5901234123457')
    expect(within(dialog).getByText('Kontrol hanesi doğru.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(db.barcodes.some((b) => b.barcode === '5901234123457')).toBe(true))
    expect(await screen.findByText('5901234123457')).toBeInTheDocument()
  })

  it('adds an alternate unit with a live conversion preview', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog(`/catalog/items/${ITEM_BOLT}?tab=units`)
    expect(await screen.findByText('1 KOLI = 12 ADET')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Birim ekle' }))
    const dialog = await screen.findByRole('dialog')
    const unit = within(dialog).getByRole('combobox', { name: /^Birim/ })
    await user.click(unit)
    await user.keyboard('{ArrowDown}')
    // Base unit and units already attached are not offered.
    expect(screen.queryByRole('option', { name: /ADET/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /KOLI/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /GR/ }))

    const factor = within(dialog).getByLabelText(/^1 GR kaç ADET/)
    await user.type(factor, '0')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(await within(dialog).findByText('Çarpan sıfırdan büyük olmalıdır.')).toBeInTheDocument()

    await user.clear(factor)
    await user.type(factor, '2,5')
    const sample = within(dialog).getByLabelText(/^Miktar/)
    await user.clear(sample)
    await user.type(sample, '4')
    expect(within(dialog).getByText('4 GR = 10 ADET')).toBeInTheDocument()
    expect(within(dialog).getByText('1 ADET = 0,4 GR')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(db.itemUnits).toHaveLength(2))
    expect(db.itemUnits[1]?.factor).toBe('2.500000')
  })

  it('adds a variant with attributes', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog(`/catalog/items/${ITEM_BOLT}?tab=variants`)
    expect(await screen.findByText('CVT-M8-ZN')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Varyant ekle' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^SKU/), 'CVT-M8-SY')
    await user.click(within(dialog).getByRole('button', { name: 'Özellik ekle' }))
    await user.type(within(dialog).getByLabelText('1. özellik adı'), 'kaplama')
    await user.type(within(dialog).getByLabelText('1. özellik değeri'), 'siyah')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(db.variants).toHaveLength(2))
    expect(db.variants[1]).toMatchObject({ sku: 'CVT-M8-SY', attributes: { kaplama: 'siyah' } })
    expect(await screen.findByText('kaplama: siyah')).toBeInTheDocument()
  })

  it('keeps unsaved general edits across tab switches', async () => {
    setupCatalog()
    const user = userEvent.setup()
    renderCatalog(`/catalog/items/${ITEM_BOLT}`)
    const name = await screen.findByLabelText(/^Ad/)
    await waitFor(() => expect(name).toHaveValue('Cıvata M8'))
    await user.type(name, ' kalın')
    await user.click(screen.getByRole('tab', { name: 'Varyantlar' }))
    expect(await screen.findByText('CVT-M8-ZN')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Genel' }))
    expect(screen.getByLabelText(/^Ad/)).toHaveValue('Cıvata M8 kalın')
  })

  it('is read-only without items.update', async () => {
    setupCatalog({ permissions: ['items.view'] })
    renderCatalog(`/catalog/items/${ITEM_BOLT}`)
    const name = await screen.findByLabelText(/^Ad/)
    await waitFor(() => expect(name).toHaveValue('Cıvata M8'))
    expect(name).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Kaydet' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sil' })).not.toBeInTheDocument()
  })
})
