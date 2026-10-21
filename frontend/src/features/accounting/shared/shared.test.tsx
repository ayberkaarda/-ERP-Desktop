import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Providers } from '@/app/providers'
import { createQueryClient } from '@/lib/queryClient'
import { accountsCommands } from '../accounts/commands'
import { determinationCommands } from '../determination/commands'
import { fiscalCommands } from '../fiscal/commands'
import { periodsCommands } from '../periods/commands'
import { AccountCombobox } from './AccountCombobox'
import { createPayloadKeys, stableStringify } from './idempotency'
import { sanitizeViews } from './savedViews'
import { setupAccounting } from './testing'
import type { Account } from './types'

function Picker({ postableOnly }: { postableOnly?: boolean }) {
  const [value, setValue] = useState<string | null>(null)
  const [picked, setPicked] = useState<Account | null>(null)
  return (
    <>
      <AccountCombobox
        aria-label="Hesap"
        value={value}
        postableOnly={postableOnly}
        onChange={(id, a) => {
          setValue(id)
          setPicked(a)
        }}
      />
      <output>{picked ? `${picked.code}/${picked.normal_balance}` : 'none'}</output>
    </>
  )
}

describe('AccountCombobox', () => {
  it('searches active postable accounts by code or name and returns the picked account', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    render(
      <Providers queryClient={createQueryClient()}>
        <Picker />
      </Providers>,
    )
    await user.click(screen.getByRole('combobox', { name: 'Hesap' }))
    await user.keyboard('ban')
    await user.click(await screen.findByRole('option', { name: /102 · Bankalar/ }))
    expect(screen.getByText('102/debit')).toBeInTheDocument()
    expect(screen.getByText('Varlık')).toBeInTheDocument()
    const search = db.calls.filter((c) => c.path === '/accounts').at(-1)
    expect(search?.url.searchParams.get('filter[is_active]')).toBe('true')
    expect(search?.url.searchParams.get('filter[is_postable]')).toBe('true')
    expect(search?.url.searchParams.get('q')).toBe('ban')
  })

  it('can include header accounts but never inactive ones', async () => {
    setupAccounting()
    const user = userEvent.setup()
    render(
      <Providers queryClient={createQueryClient()}>
        <Picker postableOnly={false} />
      </Providers>,
    )
    await user.click(screen.getByRole('combobox', { name: 'Hesap' }))
    await user.keyboard('6')
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /600 · Yurt İçi Satışlar/ })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('option', { name: /601/ })).not.toBeInTheDocument()
  })
})

describe('payload-bound idempotency keys', () => {
  it('reuses the key for an equal payload and renews it when the payload changes', () => {
    let n = 0
    const keyFor = createPayloadKeys(() => `k${++n}`)
    expect(keyFor({ a: 1, b: 2 })).toBe('k1')
    expect(keyFor({ b: 2, a: 1 })).toBe('k1')
    expect(keyFor({ a: 1, b: 3 })).toBe('k2')
    expect(stableStringify({ x: undefined, y: [1, { z: 'a' }] })).toBe('{"y":[1,{"z":"a"}]}')
  })
})

describe('saved views storage', () => {
  it('keeps only well-formed entries', () => {
    expect(
      sanitizeViews([{ name: 'Gelirler', values: { type: 'revenue', bad: 1 } }, { name: '' }, 'x']),
    ).toEqual([{ name: 'Gelirler', values: { type: 'revenue' } }])
  })
})

describe('commands', () => {
  it('registers permission-gated palette entries for every screen', () => {
    const all = [
      ...accountsCommands,
      ...fiscalCommands,
      ...periodsCommands,
      ...determinationCommands,
    ]
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length)
    const names = (p: (typeof all)[number]['permission']): readonly string[] =>
      p === undefined ? [] : typeof p === 'string' ? [p] : 'anyOf' in p ? p.anyOf : p
    expect(
      all.every((c) => {
        const list = names(c.permission)
        return list.length > 0 && list.every((n) => n.startsWith('accounting.'))
      }),
    ).toBe(true)
    const navigate = vi.fn()
    void accountsCommands[0]?.run({ navigate })
    expect(navigate).toHaveBeenCalledWith('/accounting/accounts')
  })
})
