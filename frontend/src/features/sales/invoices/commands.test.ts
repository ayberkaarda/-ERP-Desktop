import { salesDeliveriesCommands } from '../deliveries/commands'
import { salesReportsCommands } from '../reports/commands'
import { salesReturnsCommands } from '../returns/commands'
import { salesInvoicesCommands } from './commands'

describe('sales documents palette', () => {
  const all = [
    ...salesDeliveriesCommands(),
    ...salesInvoicesCommands(),
    ...salesReturnsCommands(),
    ...salesReportsCommands(),
  ]

  it('registers unique, permission-gated entries', () => {
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length)
    expect(all.every((c) => c.permission !== undefined)).toBe(true)
    expect(all.find((c) => c.id === 'sales.invoices.new')?.permission).toEqual([
      'sales.invoices.view',
      'sales.invoices.create',
    ])
  })

  it('navigates to the area pages', async () => {
    const navigate = vi.fn()
    const byId = (id: string) => all.find((c) => c.id === id)
    await byId('sales.deliveries')?.run({ navigate })
    await byId('sales.reports.margin')?.run({ navigate })
    expect(navigate.mock.calls).toEqual([['/sales/deliveries'], ['/sales/reports/margin']])
  })
})
