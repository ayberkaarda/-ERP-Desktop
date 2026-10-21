import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ITEM_BOLT, ITEM_SERVICE, PL_DEFAULT, U_PCS } from '@/test/handlers/catalog'
import type { PriceListLine } from '../types'
import { renderCatalog, setupCatalog } from '../testing'
import './PriceListFormPage'
import './PriceListListPage'

const ghostLine: PriceListLine = {
  id: 'pll-ghost',
  item_id: 'item-deleted',
  variant_id: null,
  unit_id: U_PCS,
  min_qty: '1',
  price: '5',
  valid_from: null,
  valid_to: null,
}

describe('price lists', () => {
  it('lists price lists and creates one', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    const { router } = renderCatalog('/catalog/price-lists')
    expect(await screen.findByText('Bayi listesi')).toBeInTheDocument()
    expect(screen.getByText('Varsayılan')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Yeni fiyat listesi' }))
    const code = await screen.findByLabelText(/^Kod/)
    await user.type(code, 'IHR')
    await user.type(screen.getByLabelText(/^Ad/), 'İhracat')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/catalog\/price-lists\/pl-new-/),
    )
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/price-lists')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(post?.body).toMatchObject({ code: 'IHR', currency_code: 'TRY', valid_from: null })
    expect(await screen.findByRole('table', { name: 'Fiyat satırları' })).toBeInTheDocument()
  })

  it('shows per-line server errors from the bulk save', async () => {
    const db = setupCatalog()
    db.lines[PL_DEFAULT]?.push(ghostLine)
    const user = userEvent.setup()
    renderCatalog(`/catalog/price-lists/${PL_DEFAULT}`)
    const table = await screen.findByRole('table', { name: 'Fiyat satırları' })
    await waitFor(() =>
      expect(within(table).getAllByRole('row', { name: /^\d+\. satır$/ })).toHaveLength(3),
    )

    const price2 = within(table).getByLabelText('Fiyat, 2. satır')
    await user.clear(price2)
    await user.type(price2, '0')
    await user.click(screen.getByRole('button', { name: 'Satırları kaydet' }))
    expect(await within(table).findByText('Değer sıfırdan büyük olmalıdır.')).toBeInTheDocument()
    expect(db.calls.some((c) => c.method === 'PUT')).toBe(false)

    await user.clear(price2)
    await user.type(price2, '10,75')
    await user.click(screen.getByRole('button', { name: 'Satırları kaydet' }))
    expect(await within(table).findByText('Stok bulunamadı.')).toBeInTheDocument()
    expect(screen.getByText('Hatalı satırlar: 3')).toBeInTheDocument()
    expect(within(table).getByLabelText('Stok, 3. satır')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: '3. satır, Stok' })).toBeInTheDocument()
    const put = db.calls.find((c) => c.method === 'PUT')
    expect((put?.body as { lines: PriceListLine[] }).lines[1]).toMatchObject({
      id: 'pll-2',
      price: '10.750000',
      min_qty: '100',
    })

    await user.click(within(table).getByRole('button', { name: '3. satırı sil' }))
    await user.click(screen.getByRole('button', { name: 'Satırları kaydet' }))
    expect(await screen.findByText('2 satır kaydedildi.')).toBeInTheDocument()
    expect(db.lines[PL_DEFAULT]).toHaveLength(2)
    expect(db.lines[PL_DEFAULT]?.[1]?.price).toBe('10.750000')
  })

  it('adds a line from the keyboard and saves with Ctrl+S', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog(`/catalog/price-lists/${PL_DEFAULT}`)
    const table = await screen.findByRole('table', { name: 'Fiyat satırları' })
    const lastCell = await within(table).findByLabelText('Geçerlilik bitişi, 2. satır')
    lastCell.focus()
    await user.keyboard('{Enter}')
    const item = await within(table).findByRole('combobox', { name: 'Stok, 3. satır' })
    await waitFor(() => expect(item).toHaveFocus())
    await user.type(item, 'Montaj')
    await user.click(await screen.findByRole('option', { name: /Montaj hizmeti/ }))
    // Picking the item fills its base unit.
    await waitFor(() =>
      expect(within(table).getByRole('combobox', { name: 'Birim, 3. satır' })).toHaveValue(
        'ADET · Adet',
      ),
    )
    await user.type(within(table).getByLabelText('Fiyat, 3. satır'), '250')
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(db.lines[PL_DEFAULT]).toHaveLength(3))
    expect(db.lines[PL_DEFAULT]?.[2]).toMatchObject({
      item_id: ITEM_SERVICE,
      unit_id: U_PCS,
      price: '250.000000',
      min_qty: '1',
    })
    expect(db.lines[PL_DEFAULT]?.[0]?.item_id).toBe(ITEM_BOLT)
  })

  it('reads lines without editing rights', async () => {
    setupCatalog({ permissions: ['price_lists.view'] })
    renderCatalog(`/catalog/price-lists/${PL_DEFAULT}`)
    await screen.findByRole('table', { name: 'Fiyat satırları' })
    expect(screen.queryByRole('button', { name: 'Satırları kaydet' })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Kod/)).toBeDisabled()
  })
})
