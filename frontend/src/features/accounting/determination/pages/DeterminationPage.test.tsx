import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACC_BANK } from '@/test/handlers/accounting1'
import { renderAccounting, setupAccounting } from '../../shared/testing'
import './DeterminationPage'

const table = (event: string) =>
  screen.findByRole('table', { name: `${event} kuralları (öncelik sırasıyla)` })

describe('DeterminationPage', () => {
  it('groups rules by event, highest priority first, and reorders with move up/down', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/determination')
    const revenue = await table('sales.revenue.goods')
    expect(screen.getByRole('heading', { name: 'Satış' })).toBeInTheDocument()
    const rows = within(revenue).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      '20',
      '10',
      '0',
    ])
    expect(within(rows[2] ?? document.body).getByText('Varsayılan')).toBeInTheDocument()
    expect(within(rows[0] ?? document.body).getByText('Para birimi: USD')).toBeInTheDocument()

    await user.click(
      within(revenue).getByRole('button', { name: 'sales.revenue.goods 2. kuralı yukarı taşı' }),
    )
    await waitFor(() => expect(db.rules.find((r) => r.id === 'rule-rev-eur')?.priority).toBe(20))
    expect(db.rules.find((r) => r.id === 'rule-rev-usd')?.priority).toBe(10)
    const patches = db.calls.filter((c) => c.method === 'PATCH')
    expect(patches.map((c) => c.body)).toEqual([
      { priority: 20, version: 1 },
      { priority: 10, version: 1 },
    ])
    // System (default) rules keep their place.
    expect(
      within(revenue).getByRole('button', { name: 'sales.revenue.goods 3. kuralı yukarı taşı' }),
    ).toBeDisabled()
  })

  it('tests the resolution and highlights the matched rule', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/determination')
    await table('sales.revenue.goods')
    const panel = screen.getByRole('region', { name: 'Kural testi' })
    await user.selectOptions(within(panel).getByLabelText(/^Olay/), 'sales.revenue.goods')
    await user.type(within(panel).getByLabelText('Para birimi'), 'GBP')
    await user.click(within(panel).getByRole('button', { name: 'Test et' }))
    expect(await within(panel).findByText('Belirlenen hesap')).toBeInTheDocument()
    expect(within(panel).getByText('Koşullu kural')).toBeInTheDocument()
    expect(db.calls.find((c) => c.path === '/account-determination/test')?.body).toEqual({
      event_key: 'sales.revenue.goods',
      context: { currency: 'GBP' },
    })
    const revenue = await table('sales.revenue.goods')
    const matched = within(revenue)
      .getAllByRole('row')
      .find((r) => r.dataset.matched)
    expect(matched && within(matched).getByText('Para birimi: EUR | GBP')).toBeTruthy()

    await user.selectOptions(within(panel).getByLabelText(/^Olay/), 'fx.gain')
    await user.click(within(panel).getByRole('button', { name: 'Test et' }))
    expect(await within(panel).findByText('fx.gain için hesap belirlenemedi.')).toBeInTheDocument()
  })

  it('creates a conditional rule with an Idempotency-Key', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/determination')
    await table('sales.vat_output')
    await user.click(screen.getByRole('button', { name: 'sales.vat_output için kural ekle' }))
    const dialog = await screen.findByRole('dialog', { name: 'Yeni hesap belirleme kuralı' })
    expect(within(dialog).getByLabelText(/^Olay/)).toHaveValue('sales.vat_output')
    expect(within(dialog).getByLabelText(/^Öncelik/)).toHaveValue('10')
    await user.click(within(dialog).getByRole('combobox', { name: /^Hesap/ }))
    await user.keyboard('102')
    await user.click(await screen.findByRole('option', { name: /102 · Bankalar/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Koşul ekle' }))
    await user.type(within(dialog).getByLabelText('1. koşul anahtarı'), 'tax_code')
    await user.type(within(dialog).getByLabelText('1. koşul değeri'), 'KDV10, KDV1')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = db.calls.find(
      (c) => c.method === 'POST' && c.path === '/account-determination-rules',
    )
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(post?.body).toEqual({
      event_key: 'sales.vat_output',
      priority: 10,
      conditions: { tax_code: ['KDV10', 'KDV1'] },
      account_id: ACC_BANK,
      side: null,
      description: null,
    })
  })

  it('filters by text and group from the URL', async () => {
    setupAccounting()
    renderAccounting('/accounting/determination?q=391')
    expect(await table('sales.vat_output')).toBeInTheDocument()
    expect(screen.queryByRole('table', { name: /sales\.revenue\.goods/ })).not.toBeInTheDocument()
  })
})
