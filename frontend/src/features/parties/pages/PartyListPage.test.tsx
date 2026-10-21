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

  it('keeps the selection after a partial bulk failure and retries only the failed party', async () => {
    const parties = seed()
    const failing = must(parties[1])
    const db = setupParties({ parties, failPatchIds: new Set([failing.id]) })
    const user = userEvent.setup()
    renderParties('/parties')
    await screen.findByRole('grid', { name: 'Cari listesi' })
    await within(grid()).findByText('Anadolu Makina')

    const row = (name: string) =>
      must(
        within(grid())
          .getAllByRole('row')
          .find((r) => within(r).queryByText(name)),
      )
    await user.click(within(row('Anadolu Makina')).getByRole('checkbox'))
    await user.click(within(row('Ege Tekstil')).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Pasifleştir' }))

    expect(await screen.findByText(/1 cari güncellenemedi/)).toBeInTheDocument()
    expect(screen.getByText('2 kayıt seçildi')).toBeInTheDocument()

    db.failPatchIds.clear()
    const before = db.calls.filter((c) => c.method === 'PATCH').length
    // Wait for the refreshed list so the retry knows which parties are already inactive.
    await waitFor(() =>
      expect(within(row('Anadolu Makina')).getByText('Pasif')).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'Pasifleştir' }))
    await waitFor(() => expect(screen.queryByText('2 kayıt seçildi')).not.toBeInTheDocument())
    const retried = db.calls.filter((c) => c.method === 'PATCH').slice(before)
    expect(retried.map((c) => c.path)).toEqual([`/api/v1/parties/${failing.id}`])
    expect(db.parties.find((p) => p.id === failing.id)?.is_active).toBe(false)
  })

  it('hides create and bulk selection without permissions', async () => {
    setupParties({ parties: seed() }, ['parties.view'])
    renderParties('/parties')
    await screen.findByRole('grid', { name: 'Cari listesi' })
    await within(grid()).findByText('Anadolu Makina')
    expect(screen.queryByRole('link', { name: 'Yeni cari' })).not.toBeInTheDocument()
    expect(within(grid()).queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('exports the filtered list as a binary XLSX file with the server file name', async () => {
    const db = setupParties({ parties: seed() })
    let last: Blob | null = null
    const saved: { blob: Blob; name: string }[] = []
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      last = b as Blob
      return 'blob:x'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      if (last) saved.push({ blob: last, name: this.download })
    })
    const user = userEvent.setup()
    renderParties('/parties')
    await within(await screen.findByRole('grid', { name: 'Cari listesi' })).findByText(
      'Anadolu Makina',
    )
    await user.click(screen.getByRole('button', { name: 'Tedarikçiler' }))
    await user.click(screen.getByRole('button', { name: 'Dışa aktar' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Excel (XLSX) olarak indir' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.name).toBe('parties-20260121-100000.xlsx')
    const bytes = new Uint8Array(await must(saved[0]).blob.arrayBuffer())
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b])
    const call = must(db.calls.find((c) => c.path === '/api/v1/parties/export'))
    const params = new URLSearchParams(call.search)
    expect(params.get('format')).toBe('xlsx')
    expect(params.get('filter[role]')).toBe('supplier')
    expect(params.has('page')).toBe(false)
    create.mockRestore()
    revoke.mockRestore()
    click.mockRestore()
  })

  it('hides the export without parties.export', async () => {
    setupParties({ parties: seed() }, ['parties.view'])
    renderParties('/parties')
    await within(await screen.findByRole('grid', { name: 'Cari listesi' })).findByText(
      'Anadolu Makina',
    )
    expect(screen.queryByRole('button', { name: 'Dışa aktar' })).not.toBeInTheDocument()
  })

  it('shows the empty state with a create action when there are no parties', async () => {
    setupParties()
    renderParties('/parties')
    await screen.findByRole('grid', { name: 'Cari listesi' })
    expect(await screen.findByText('Henüz cari yok')).toBeInTheDocument()
  })
})
