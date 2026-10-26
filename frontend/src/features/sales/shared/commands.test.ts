import type { RouteObject } from 'react-router'
import i18n from '@/lib/i18n'
import { hasPermission } from '@/lib/permissions'
import type { SessionUser } from '@/stores/auth'
import { ordersCommands } from '../orders/commands'
import { ordersRoutes } from '../orders/routes'
import { quotesCommands } from '../quotes/commands'
import { quotesRoutes } from '../quotes/routes'

const user = { id: 'u', isSuperAdmin: false } as SessionUser
const paths = (routes: RouteObject[]) =>
  routes.flatMap((r) => (r.children ?? []).map((c) => c.path))

describe('sales quote and order commands and routes', () => {
  const commands = [...quotesCommands(), ...ordersCommands()]

  it('titles every command and gates it by permission', () => {
    const t = i18n.t.bind(i18n)
    for (const c of commands) {
      expect(c.title(t)).not.toMatch(/^palette\./)
      expect(c.permission).toBeDefined()
    }
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length)
    const visible = (granted: string[]) =>
      commands.filter((c) => hasPermission({ user, granted }, c.permission)).map((c) => c.id)
    expect(visible(['sales.quotes.view'])).toEqual(['sales.quotes'])
    expect(visible(['sales.orders.view', 'sales.orders.create'])).toEqual([
      'sales.orders',
      'sales.orders.new',
    ])
  })

  it('navigates to the pages the routes serve', () => {
    const navigate = vi.fn()
    for (const c of commands) void c.run({ navigate })
    const served = [...paths(quotesRoutes), ...paths(ordersRoutes)].map((p) => `/${p ?? ''}`)
    for (const [target] of navigate.mock.calls as [string][]) expect(served).toContain(target)
    expect(served).toEqual(
      expect.arrayContaining(['/sales/quotes', '/sales/quotes/new', '/sales/orders/:id']),
    )
  })
})
