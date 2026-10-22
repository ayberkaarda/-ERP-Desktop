import { renderHook } from '@testing-library/react'
import { useRegisteredCommands } from '@/features/command-palette/registry'
import { registerFeatureCommands } from './featureCommands'

describe('registerFeatureCommands', () => {
  it('adds the parties, catalog, reference, accounting, inventory and sales palette entries once', () => {
    const off = registerFeatureCommands()
    expect(registerFeatureCommands()).toBe(off)

    const { result } = renderHook(() => useRegisteredCommands())
    const ids = result.current.map((c) => c.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'catalog.pricing',
        'reference.currencies',
        'reference.rate-entry',
        'accounting.accounts',
        'accounting.journalEntries',
        'accounting.reports.trialBalance',
        'inventory.documents',
        'inventory.counts',
        'inventory.reservations',
        'inventory.reports',
        'sales.quotes',
        'sales.orders',
        'sales.deliveries',
        'sales.invoices',
        'sales.returns',
        'sales.reports',
      ]),
    )
    expect(ids.some((id) => id.startsWith('parties.'))).toBe(true)

    off()
    expect(renderHook(() => useRegisteredCommands()).result.current).toHaveLength(0)
  })
})
