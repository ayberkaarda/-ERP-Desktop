import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { makeParty } from '@/test/handlers/parties'
import { renderRoutes } from '@/test/handlers/feaRender'
import { must, setupParties } from '../testUtils'
import type { Party } from '../types'
import { PartyCombobox } from './PartyCombobox'

function Harness({ onPick }: { onPick: (party: Party | null) => void }) {
  const [value, setValue] = useState<string | null>(null)
  return (
    <PartyCombobox
      aria-label="Müşteri"
      role="customer"
      allowCreate
      value={value}
      onChange={(id, party) => {
        setValue(id)
        onPick(party)
      }}
    />
  )
}

function renderHarness(onPick = vi.fn()) {
  renderRoutes([{ path: '/', element: <Harness onPick={onPick} /> }])
  return onPick
}

describe('PartyCombobox', () => {
  it('searches active parties of the role and shows role badges for the pick', async () => {
    const db = setupParties({
      parties: [
        makeParty({
          code: 'P000010',
          name: 'Anadolu Makina',
          roles: ['customer', 'supplier'],
          tax_number: '1234567890',
        }),
      ],
    })
    const user = userEvent.setup()
    const onPick = renderHarness()

    await user.type(await screen.findByRole('combobox', { name: 'Müşteri' }), 'anad')
    const option = await screen.findByRole('option', { name: /Anadolu Makina/ })
    expect(option).toHaveTextContent('P000010 · 1234567890 · Müşteri, Tedarikçi')
    await user.click(option)

    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'P000010' }))
    expect(screen.getByRole('combobox', { name: 'Müşteri' })).toHaveValue('Anadolu Makina')
    expect(document.querySelector('[data-role="supplier"]')).not.toBeNull()
    const search = db.calls.find((c) => c.method === 'GET' && c.path.endsWith('/parties'))
    expect(search).toBeDefined()
  })

  it('creates a party in the quick-create dialog and selects it', async () => {
    const db = setupParties()
    const user = userEvent.setup()
    const onPick = renderHarness()

    await user.click(await screen.findByRole('button', { name: 'Yeni cari oluştur' }))
    const dialog = await screen.findByRole('dialog', { name: 'Hızlı cari oluştur' })
    const name = must(within(dialog).getAllByRole('textbox')[0])
    expect(name).toHaveFocus()
    await user.type(name, 'Karadeniz Gıda')
    await user.click(within(dialog).getByRole('button', { name: 'Oluştur ve seç' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Karadeniz Gıda' }))
    expect(screen.getByRole('combobox', { name: 'Müşteri' })).toHaveValue('Karadeniz Gıda')
    expect(db.parties[0]?.roles).toEqual(['customer'])
  })

  it('hides quick create without parties.create', async () => {
    setupParties({}, ['parties.view'])
    renderHarness()
    await screen.findByRole('combobox', { name: 'Müşteri' })
    expect(screen.queryByRole('button', { name: 'Yeni cari oluştur' })).not.toBeInTheDocument()
  })
})
