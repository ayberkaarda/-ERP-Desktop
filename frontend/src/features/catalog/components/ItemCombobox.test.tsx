import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderRoutes } from '@/test/handlers/feaRender'
import { ITEM_BOLT, U_PCS } from '@/test/handlers/catalog'
import { setupCatalog } from '../testing'
import type { Item } from '../types'
import { ItemCombobox } from './ItemCombobox'

function Harness({
  initial = null,
  onPick,
}: {
  initial?: string | null
  onPick: (item: Item | null) => void
}) {
  const [value, setValue] = useState<string | null>(initial)
  return (
    <ItemCombobox
      aria-label="Stok"
      value={value}
      onChange={(id, item) => {
        setValue(id)
        onPick(item)
      }}
    />
  )
}

describe('ItemCombobox', () => {
  it('searches items and shows base unit and tax code', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderRoutes([{ path: '/', element: <Harness onPick={onPick} /> }])
    const input = screen.getByRole('combobox', { name: 'Stok' })
    await user.type(input, 'cıv')
    await waitFor(() =>
      expect(
        db.calls
          .find((c) => c.path === '/items' && c.url.searchParams.get('q') === 'cıv')
          ?.url.searchParams.get('filter[is_active]'),
      ).toBe('true'),
    )
    const option = await screen.findByRole('option', { name: /STK000001 · Cıvata M8/ })
    expect(option).toHaveTextContent('Birim: ADET · Vergi kodu: tax-kdv20')
    await user.click(option)
    expect(onPick).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: ITEM_BOLT, base_unit_id: U_PCS }),
    )
    expect(input).toHaveValue('STK000001 · Cıvata M8')
  })

  it('returns the picked search record, not an older cached copy', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    const onPick = vi.fn()
    renderRoutes([{ path: '/', element: <Harness initial={ITEM_BOLT} onPick={onPick} /> }])
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Stok' })).toHaveValue('STK000001 · Cıvata M8'),
    )
    const input = screen.getByRole('combobox', { name: 'Stok' })
    const bolt = db.items.find((i) => i.id === ITEM_BOLT)
    if (bolt) bolt.name = 'Cıvata M8 (yeni)'
    await user.clear(input)
    await user.type(input, 'yeni')
    await waitFor(() =>
      expect(
        db.calls.some((c) => c.path === '/items' && c.url.searchParams.get('q') === 'yeni'),
      ).toBe(true),
    )
    await user.click(await screen.findByRole('option', { name: /Cıvata M8 \(yeni\)/ }))
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Cıvata M8 (yeni)' }))
  })

  it('labels a stored value from the item record', async () => {
    setupCatalog()
    renderRoutes([{ path: '/', element: <Harness initial={ITEM_BOLT} onPick={() => undefined} /> }])
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Stok' })).toHaveValue('STK000001 · Cıvata M8'),
    )
  })
})
