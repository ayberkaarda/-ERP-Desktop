import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ITEM_BOLT, PARTY_DEALER, U_PCS } from '@/test/handlers/catalog'
import { renderCatalog, setupCatalog } from '../testing'
import './PricingPlaygroundPage'

describe('PricingPlaygroundPage', () => {
  it('resolves a price and explains the precedence', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/pricing')

    const item = await screen.findByRole('combobox', { name: /^Stok/ })
    await user.type(item, 'Cıvata')
    await user.click(await screen.findByRole('option', { name: /Cıvata M8/ }))
    const qty = screen.getByLabelText(/^Miktar/)
    await user.clear(qty)
    await user.type(qty, '120')
    await user.click(screen.getByRole('button', { name: 'Fiyatı hesapla' }))

    const result = await screen.findByRole('region', { name: 'Sonuç' })
    // Default list, 100+ tier = 11; category rule 10% from 50 pcs.
    expect(await within(result).findByText('11,00 TRY')).toBeInTheDocument()
    expect(within(result).getByText('%10')).toBeInTheDocument()
    expect(within(result).getByText('9,90 TRY')).toBeInTheDocument()
    expect(within(result).getByText('1.188,00 TRY')).toBeInTheDocument()
    expect(within(result).getByText('Varsayılan liste')).toBeInTheDocument()
    expect(await within(result).findByText('GENEL · Genel liste')).toBeInTheDocument()

    const call = db.calls.find((c) => c.path === '/pricing/resolve')
    expect(call?.url.searchParams.get('item_id')).toBe(ITEM_BOLT)
    expect(call?.url.searchParams.get('unit_id')).toBe(U_PCS)
    expect(call?.url.searchParams.get('qty')).toBe('120.000000')
    expect(call?.url.searchParams.has('party_id')).toBe(false)
    // The API requires a currency; the playground defaults to TRY.
    expect(call?.url.searchParams.get('currency')).toBe('TRY')

    const steps = screen.getByRole('region', { name: 'Öncelik sırası' })
    const items = within(steps).getAllByRole('listitem')
    expect(items[0]).toHaveTextContent('Cariye özel fiyat listesiAtlandı')
    expect(items[1]).toHaveTextContent('Varsayılan fiyat listesiBelirleyici')
  })

  it('prefers the party price list', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/pricing')
    const item = await screen.findByRole('combobox', { name: /^Stok/ })
    await user.type(item, 'Cıvata')
    await user.click(await screen.findByRole('option', { name: /Cıvata M8/ }))
    await user.type(screen.getByRole('combobox', { name: /^Cari/ }), 'Ege')
    await user.click(await screen.findByRole('option', { name: /Ege Bayi/ }))
    await user.click(screen.getByRole('button', { name: 'Fiyatı hesapla' }))
    const result = await screen.findByRole('region', { name: 'Sonuç' })
    expect(await within(result).findByText('Cariye özel liste')).toBeInTheDocument()
    expect(within(result).getAllByText('10,00 TRY')).toHaveLength(3)
    await waitFor(() =>
      expect(
        db.calls.find((c) => c.path === '/pricing/resolve')?.url.searchParams.get('party_id'),
      ).toBe(PARTY_DEALER),
    )
  })

  it('requires an item', async () => {
    setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/pricing')
    await user.click(await screen.findByRole('button', { name: 'Fiyatı hesapla' }))
    expect(await screen.findByText('Bu alan zorunludur.')).toBeInTheDocument()
  })
})
