import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeParty } from '@/test/handlers/parties'
import { must, renderParties, setupParties } from '../testUtils'

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

  it('reads only without update permission', async () => {
    const party = makeParty()
    setupParties({ parties: [party] }, ['parties.view'])
    renderParties(`/parties/${party.id}?tab=contacts`)
    await screen.findByRole('table', { name: 'Kişiler' })
    expect(screen.queryByRole('button', { name: 'Ekle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Düzenle' })).not.toBeInTheDocument()
  })

  it('shows a not-found state', async () => {
    setupParties()
    renderParties('/parties/0192b000-0000-7000-8000-ffffffffffff')
    expect(await screen.findByText('Cari bulunamadı.')).toBeInTheDocument()
  })
})
