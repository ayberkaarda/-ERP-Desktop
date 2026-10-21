import { useRegisteredCommands } from '@/features/command-palette/registry'
import i18n from '@/lib/i18n'
import { renderHook } from '@testing-library/react'
import { partyCommands, registerPartyCommands } from './commands'

describe('party commands', () => {
  it('registers permission-gated palette entries that navigate', () => {
    const unregister = registerPartyCommands()
    const { result } = renderHook(() => useRegisteredCommands())
    const ids = result.current.map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining(['parties.list', 'parties.new', 'parties.search']))
    unregister()

    const byId = Object.fromEntries(partyCommands().map((c) => [c.id, c]))
    expect(byId['parties.new']?.permission).toBe('parties.create')
    expect(byId['parties.search']?.title(i18n.t)).toBe('Cari ara')
    const navigate = vi.fn()
    void byId['parties.search']?.run({ navigate })
    expect(navigate).toHaveBeenCalledWith('/parties?focus=search')
  })
})
