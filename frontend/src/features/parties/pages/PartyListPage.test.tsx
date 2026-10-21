import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeParty } from '@/test/handlers/parties'
import { must, renderParties, setupParties } from '../testUtils'

function seed() {
  return [
    makeParty({ code: 'P000001', name: 'Anadolu Makina', roles: ['customer'] }),
    makeParty({ code: 'P000002', name: 'Ege Tekstil', roles: ['supplier'], country: 'TR' }),
    makeParty({
      code: 'P000003',
      name: 'Berlin GmbH',
      roles: ['customer', 'supplier'],
      country: 'DE',
    }),
    makeParty({ code: 'P000004', name: 'Kapalı Ltd', is_active: false }),
  ]
}

const grid = () => screen.getByRole('grid', { name: 'Cari listesi' })

describe('PartyListPage', () => {
  beforeEach(() => localStorage.clear())

  it('lists parties with role badges and filters by preset view', async () => {
    setupParties({ parties: seed() })
    const user = userEvent.setup()
    renderParties('/parties')
    await screen.findByRole('grid', { name: 'Cari listesi' })

    expect(await within(grid()).findByText('Anadolu Makina')).toBeInTheDocument()
    expect(within(grid()).getAllByText('Tedarikçi')).toHaveLength(2)

    await user.click(screen.getByRole('button', { name: 'Tedarikçiler' }))
    await waitFor(() =>
      expect(within(grid()).queryByText('Anadolu Makina')).not.toBeInTheDocument(),
    )
    expect(within(grid()).getByText('Ege Tekstil')).toBeInTheDocument()
    expect(within(grid()).getByText('Berlin GmbH')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tedarikçiler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('searches by text and shows the filtered empty state', async () => {
    setupParties({ parties: seed() })
    const user = userEvent.setup()
    renderParties('/parties')
    await screen.findByRole('grid', { name: 'Cari listesi' })
    await within(grid()).findByText('Anadolu Makina')

    await user.type(screen.getByRole('searchbox', { name: /ara/i }), 'zzz{Enter}')
    expect(await screen.findByText('Eşleşen cari yok')).toBeInTheDocument()
  })

  it('deactivates selected parties in bulk, each with its own version', async () => {
    const db = setupParties({ parties: seed() })
    const user = userEvent.setup()
    renderParties('/parties')
    await screen.findByRole('grid', { name: 'Cari listesi' })
    await within(grid()).findByText('Anadolu Makina')

    const rows = within(grid()).getAllByRole('row')
    const row = (name: string) => must(rows.find((r) => within(r).queryByText(name)))
    await user.click(within(row('Anadolu Makina')).getByRole('checkbox'))
    await user.click(within(row('Ege Tekstil')).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Pasifleştir' }))

    expect(await screen.findByText('2 cari güncellendi.')).toBeInTheDocument()
    const patches = db.calls.filter((c) => c.method === 'PATCH')
    expect(patches.map((c) => c.body)).toEqual([
      { is_active: false, version: 1 },
      { is_active: false, version: 1 },
    ])
    expect(db.parties.filter((p) => !p.is_active)).toHaveLength(3)
  })

  it('hides create and bulk selection without permissions', async () => {
    setupParties({ parties: seed() }, ['parties.view'])
    renderParties('/parties')
    await screen.findByRole('grid', { name: 'Cari listesi' })
    await within(grid()).findByText('Anadolu Makina')
    expect(screen.queryByRole('link', { name: 'Yeni cari' })).not.toBeInTheDocument()
    expect(within(grid()).queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('shows the empty state with a create action when there are no parties', async () => {
    setupParties()
    renderParties('/parties')
    await screen.findByRole('grid', { name: 'Cari listesi' })
    expect(await screen.findByText('Henüz cari yok')).toBeInTheDocument()
  })
})
