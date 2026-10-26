import type { RouteObject } from 'react-router'
import i18n from '@/lib/i18n'
import { hasPermission } from '@/lib/permissions'
import type { SessionUser } from '@/stores/auth'
import { lotsCommands } from '../lots/commands'
import { lotsRoutes } from '../lots/routes'
import { movementsCommands } from '../movements/commands'
import { movementsRoutes } from '../movements/routes'
import { warehousesCommands } from '../warehouses/commands'
import { warehousesRoutes } from '../warehouses/routes'
import { stockCommands } from './commands'
import { stockRoutes } from './routes'

const user = { id: 'u', isSuperAdmin: false } as SessionUser
const paths = (routes: RouteObject[]) =>
  routes.flatMap((r) => (r.children ?? []).map((c) => c.path))
const commands = [...warehousesCommands, ...stockCommands, ...movementsCommands, ...lotsCommands]

describe('inventory stock commands', () => {
  it('titles every command and gates it by permission', () => {
    const t = i18n.t.bind(i18n)
    for (const c of commands) {
      expect(c.title(t)).not.toMatch(/^common\./)
      expect(c.permission).toBeDefined()
    }
    const visible = (granted: string[]) =>
      commands.filter((c) => hasPermission({ user, granted }, c.permission)).map((c) => c.id)
    expect(visible(['inventory.warehouses.view'])).toEqual(['inventory.warehouses'])
    expect(visible(['inventory.warehouses.manage'])).toEqual(['inventory.warehouses'])
    expect(visible(['inventory.stock.view'])).toEqual([
      'inventory.stock',
      'inventory.movements',
      'inventory.lots',
      'inventory.serials',
    ])
  })

  it('navigates to registered routes', () => {
    const navigate = vi.fn()
    for (const c of commands) void c.run({ navigate })
    const known = [
      ...paths(warehousesRoutes),
      ...paths(stockRoutes),
      ...paths(movementsRoutes),
      ...paths(lotsRoutes),
    ]
    for (const [p] of navigate.mock.calls) {
      expect(known).toContain(String(p).slice(1).split('?')[0])
    }
  })
})
