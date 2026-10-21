import { renderHook } from '@testing-library/react'
import { useRegisteredCommands } from '@/features/command-palette/registry'
import { registerFeatureCommands } from './featureCommands'

describe('registerFeatureCommands', () => {
  it('adds the parties, catalog and reference palette entries once', () => {
    const off = registerFeatureCommands()
    expect(registerFeatureCommands()).toBe(off)

    const { result } = renderHook(() => useRegisteredCommands())
    const ids = result.current.map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining(['catalog.pricing', 'reference.currencies', 'reference.rate-entry']),
    )
    expect(ids.some((id) => id.startsWith('parties.'))).toBe(true)

    off()
    expect(renderHook(() => useRegisteredCommands()).result.current).toHaveLength(0)
  })
})
