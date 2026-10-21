import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderReference, setupReference } from '@/test/handlers/referenceRender'
import { registerCommands } from '@/features/command-palette/registry'
import {
  CurrencySelect,
  PaymentTermSelect,
  TaxCodeSelect,
  WarehouseSelect,
  type Currency,
} from '../index'
import { referenceCommands } from '../commands'

function Harness({ onPick }: { onPick: (value: string | null) => void }) {
  const [currency, setCurrency] = useState<string | null>(null)
  return (
    <>
      <CurrencySelect
        aria-label="Para"
        value={currency}
        onChange={(v, row: Currency | null) => {
          setCurrency(v)
          onPick(row?.code ?? null)
        }}
      />
      <TaxCodeSelect aria-label="Vergi" value={null} onChange={() => undefined} />
      <PaymentTermSelect aria-label="Vade" value={null} onChange={() => undefined} />
      <WarehouseSelect aria-label="Depo" value={null} onChange={() => undefined} />
    </>
  )
}

describe('reference selects', () => {
  it('offers only company-active currencies and reports the picked row', async () => {
    setupReference()
    const onPick = vi.fn()
    const user = userEvent.setup()
    renderReference(<Harness onPick={onPick} />)

    await user.click(screen.getByRole('combobox', { name: 'Para' }))
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByRole('option', { name: /USD/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /EUR/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /USD/ }))
    expect(onPick).toHaveBeenCalledWith('USD')
    expect(screen.getByRole('combobox', { name: 'Para' })).toHaveValue('USD · ABD Doları')
  })

  it('loads tax codes, payment terms and warehouses through their API', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<Harness onPick={() => undefined} />)

    await user.click(screen.getByRole('combobox', { name: 'Vergi' }))
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByRole('option', { name: /KDV20/ })).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Vade' }))
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByRole('option', { name: /NET30/ })).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Depo' }))
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByRole('option', { name: /MERKEZ/ })).toBeInTheDocument()

    await waitFor(() =>
      expect(db.calls.find((c) => c.path === '/tax-codes')?.query.get('filter[is_active]')).toBe(
        '1',
      ),
    )
  })
})

describe('command palette entries', () => {
  it('registers navigation entries that are permission gated', () => {
    const remove = registerCommands(referenceCommands)
    const ids = referenceCommands.map((c) => c.id)
    expect(ids).toContain('reference.currencies')
    expect(ids).toContain('reference.rate-entry')
    expect(new Set(ids).size).toBe(ids.length)
    expect(referenceCommands.every((c) => typeof c.permission === 'string')).toBe(true)
    const entry = referenceCommands.find((c) => c.id === 'reference.exchange-rates')
    const navigate = vi.fn()
    void entry?.run({ navigate })
    expect(navigate).toHaveBeenCalledWith('/reference/exchange-rates')
    remove()
  })
})
