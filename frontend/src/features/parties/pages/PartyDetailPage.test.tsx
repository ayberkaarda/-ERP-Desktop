import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { makeParty } from '@/test/handlers/parties'
import { server } from '@/test/msw/server'
import { must, renderParties, setupParties } from '../testUtils'

/** Real GET /customers/{id}/exposure and /sales-summary shapes; records which paths were asked. */
function mockCustomerEndpoints(partyId: string) {
  const calls: string[] = []
  const exposure = {
    party_id: partyId,
    limit: '1000.00',
    currency: 'TRY',
    open_invoices: '900.00',
    open_orders: '200.00',
    total: '1100.00',
    available: '-100.00',
  }
  server.use(
    http.get('*/api/v1/customers/:id/exposure', ({ request }) => {
      calls.push(new URL(request.url).pathname)
      return HttpResponse.json({ data: exposure })
    }),
    http.get('*/api/v1/customers/:id/sales-summary', ({ request }) => {
      calls.push(new URL(request.url).pathname)
      return HttpResponse.json({
        data: {
          party_id: partyId,
          currency: 'TRY',
          exposure,
          quotes: { open_count: 0, open_total: '0.00' },
          orders: { open_count: 1, open_value: '200.00' },
          invoices: {
            count: 3,
            invoiced_total: '4500.00',
            credited_total: '0.00',
            balance_due: '900.00',
            last_invoice_date: '2026-10-01',
          },
          recent_orders: [],
          recent_invoices: [],
        },
      })
    }),
  )
  return calls
}

function address(partyId: string, overrides: Record<string, unknown>) {
  return {
    id: `a-${String(overrides.label)}`,
    party_id: partyId,
    type: 'billing' as const,
    label: 'Merkez',
    line1: 'Atatürk Cad. 1',
    line2: null,
    district: 'Kadıköy',
    city: 'İstanbul',
    postal_code: '34710',
    country: 'TR',
    is_default: false,
    version: 1,
    ...overrides,
  }
}

describe('PartyDetailPage', () => {
  it('shows the summary and keeps one default address per type', async () => {
    const party = makeParty({ name: 'Ege Tekstil', tax_number: '1234567890', roles: ['supplier'] })
    const db = setupParties({
      parties: [party],
      addresses: [
        address(party.id, { label: 'Merkez', is_default: true }),
        address(party.id, { label: 'Şube' }),
        address(party.id, { label: 'Depo', type: 'shipping', is_default: true }),
      ],
    })
    const user = userEvent.setup()
    renderParties(`/parties/${party.id}`)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ege Tekstil' }),
    ).toBeInTheDocument()
    expect(screen.getByText('(10 haneli vergi kimlik numarası)')).toBeInTheDocument()

    const table = await screen.findByRole('table', { name: 'Adresler' })
    const row = (label: string) =>
      must(
        within(table)
          .getAllByRole('row')
          .find((r) => within(r).queryByText(label)),
      )
    await within(table).findByText('Şube')
    await user.click(within(row('Şube')).getByRole('button', { name: 'Varsayılan yap' }))

    await waitFor(() =>
      expect(
        within(row('Merkez')).getByRole('button', { name: 'Varsayılan yap' }),
      ).toBeInTheDocument(),
    )
    // The shipping default is in another scope and stays.
    expect(within(row('Depo')).getByText('Varsayılan')).toBeInTheDocument()
    expect(db.addresses.filter((a) => a.is_default).map((a) => a.label)).toEqual(['Şube', 'Depo'])
  })

  it('adds a bank account inline, rejecting a bad IBAN before sending', async () => {
    const party = makeParty()
    const db = setupParties({ parties: [party] })
    const user = userEvent.setup()
    renderParties(`/parties/${party.id}?tab=bankAccounts`)

    const table = await screen.findByRole('table', { name: 'Banka hesapları' })
    expect(await within(table).findByText('Banka hesabı yok.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ekle' }))

    const bank = within(table).getByRole('textbox', { name: /Banka/ })
    expect(bank).toHaveFocus()
    await user.type(bank, 'Ziraat')
    const iban = within(table).getByRole('textbox', { name: /IBAN/ })
    await user.type(iban, 'TR33 0006 1005 1978 6457 8413 27{Enter}')
    expect(await within(table).findByText('IBAN kontrol haneleri tutmuyor.')).toBeInTheDocument()
    expect(db.calls.some((c) => c.method === 'POST')).toBe(false)

    await user.clear(iban)
    await user.type(iban, 'TR33 0006 1005 1978 6457 8413 26{Enter}')
    expect(await within(table).findByText('TR33 0006 1005 1978 6457 8413 26')).toBeInTheDocument()
    const post = db.calls.find((c) => c.method === 'POST')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    // The first account becomes the default; IBAN goes out without spaces.
    expect(post?.body).toMatchObject({ iban: 'TR330006100519786457841326', is_default: true })
  })

  it('pins the row version while editing and flags a change made elsewhere', async () => {
    const party = makeParty()
    const contact = {
      id: 'c-1',
      party_id: party.id,
      name: 'Ayşe Demir',
      title: null,
      email: null,
      phone: null,
      is_primary: true,
      version: 1,
    }
    const db = setupParties({ parties: [party], contacts: [contact] })
    const user = userEvent.setup()
    const { queryClient } = renderParties(`/parties/${party.id}?tab=contacts`)
    const table = await screen.findByRole('table', { name: 'Kişiler' })
    await within(table).findByText('Ayşe Demir')
    await user.click(within(table).getByRole('button', { name: 'Düzenle: 1. satır' }))
    const title = within(table).getByRole('textbox', { name: 'Unvan' })
    await user.type(title, 'Muhasebe')

    Object.assign(must(db.contacts[0]), { phone: '555', version: 2 })
    await queryClient.invalidateQueries()
    expect(
      await within(table).findByText(
        'Bu satır başka yerde değiştirildi; kaydetmek çakışma verecek.',
      ),
    ).toBeInTheDocument()
    expect(title).toHaveValue('Muhasebe')

    await user.click(within(table).getByRole('button', { name: 'Kaydet' }))
    expect(
      await screen.findByText('Satır başka biri tarafından değiştirildi; liste yenilendi.'),
    ).toBeInTheDocument()
    const patch = db.calls.filter((c) => c.method === 'PATCH').at(-1)
    expect(patch?.body).toMatchObject({ version: 1, title: 'Muhasebe' })
    expect(db.contacts[0]?.title).toBeNull()
  })

  it('reads only without update permission', async () => {
    const party = makeParty()
    setupParties({ parties: [party] }, ['parties.view'])
    renderParties(`/parties/${party.id}?tab=contacts`)
    await screen.findByRole('table', { name: 'Kişiler' })
    expect(screen.queryByRole('button', { name: 'Ekle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Düzenle' })).not.toBeInTheDocument()
  })

  it('deletes with the version the user saw', async () => {
    const party = makeParty({ name: 'Silinecek Ltd', version: 3 })
    const db = setupParties({ parties: [party] })
    const user = userEvent.setup()
    const { router } = renderParties(`/parties/${party.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Silinecek Ltd' })
    await user.click(screen.getByRole('button', { name: 'Sil' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }),
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/parties'))
    expect(db.calls.find((c) => c.method === 'DELETE')?.search).toBe('?version=3')
    expect(db.parties).toHaveLength(0)
  })

  it('stays on a party the server deactivated because it is in use', async () => {
    const party = makeParty({ name: 'Kullanımda AŞ' })
    const db = setupParties({ parties: [party], inUseIds: new Set([party.id]) })
    const user = userEvent.setup()
    const { router } = renderParties(`/parties/${party.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Kullanımda AŞ' })
    await user.click(screen.getByRole('button', { name: 'Sil' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }),
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe(`/parties/${party.id}`)
    expect(db.parties[0]).toMatchObject({ is_active: false, version: 2 })
    expect(await screen.findByRole('button', { name: 'Aktifleştir' })).toBeInTheDocument()
  })

  it('sends the row version when deleting a sub-resource', async () => {
    const party = makeParty()
    const db = setupParties({
      parties: [party],
      addresses: [address(party.id, { label: 'Eski', version: 4 })],
    })
    const user = userEvent.setup()
    renderParties(`/parties/${party.id}`)
    const table = await screen.findByRole('table', { name: 'Adresler' })
    await within(table).findByText('Eski')
    await user.click(within(table).getByRole('button', { name: /Sil/ }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Sil' }),
    )
    await waitFor(() => expect(db.addresses).toHaveLength(0))
    expect(db.calls.find((c) => c.method === 'DELETE')?.search).toBe('?version=4')
  })

  it('shows the sales tab and the exposure badge of a customer to sales readers', async () => {
    const party = makeParty({ name: 'Acme Ticaret', roles: ['customer'] })
    setupParties({ parties: [party] }, ['parties.view', 'sales.orders.view'])
    const calls = mockCustomerEndpoints(party.id)
    const user = userEvent.setup()
    renderParties(`/parties/${party.id}`)

    expect(await screen.findByTestId('exposure-badge')).toHaveTextContent(
      'Limit aşıldı: 1.100,00 TRY / 1.000,00 TRY',
    )
    await user.click(screen.getByRole('tab', { name: 'Satış' }))
    expect(await screen.findByTestId('summary-invoiced')).toHaveTextContent('4.500,00 TRY')
    expect(calls).toContain(`/api/v1/customers/${party.id}/sales-summary`)
  })

  it('has no sales tab or badge without a sales read permission or the customer role', async () => {
    const supplier = makeParty({ name: 'Tedarik AŞ', roles: ['supplier'] })
    const customer = makeParty({ name: 'Müşteri AŞ', roles: ['customer'] })
    setupParties({ parties: [supplier, customer] }, ['parties.view', 'sales.reports.view'])
    const calls = mockCustomerEndpoints(customer.id)
    const { unmount } = renderParties(`/parties/${customer.id}?tab=sales`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Müşteri AŞ' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Satış' })).not.toBeInTheDocument()
    // An unknown or forbidden ?tab= falls back to addresses.
    expect(await screen.findByRole('table', { name: 'Adresler' })).toBeInTheDocument()
    unmount()

    setupParties({ parties: [supplier] }, ['parties.view', 'sales.invoices.view'])
    renderParties(`/parties/${supplier.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Tedarik AŞ' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Satış' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('exposure-badge')).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('shows a not-found state', async () => {
    setupParties()
    renderParties('/parties/0192b000-0000-7000-8000-ffffffffffff')
    expect(await screen.findByText('Cari bulunamadı.')).toBeInTheDocument()
  })
})
