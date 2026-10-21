import type { RouteObject } from 'react-router'
import i18n from '@/lib/i18n'
import { hasPermission } from '@/lib/permissions'
import type { SessionUser } from '@/stores/auth'
import { countsCommands } from '../counts/commands'
import { countsRoutes } from '../counts/routes'
import { inventoryReportsCommands } from '../reports/commands'
import { inventoryReportsRoutes } from '../reports/routes'
import { reservationsCommands } from '../reservations/commands'
import { reservationsRoutes } from '../reservations/routes'
import { documentsCommands } from './commands'
import { documentsRoutes } from './routes'

const user = { id: 'u', isSuperAdmin: false } as SessionUser
const paths = (routes: RouteObject[]) =>
  routes.flatMap((r) => (r.children ?? []).map((c) => c.path))

describe('inventory document, count, reservation and report commands', () => {
  const commands = [
    ...documentsCommands(),
    ...countsCommands(),
    ...reservationsCommands(),
    ...inventoryReportsCommands(),
  ]

  it('titles every command and gates it by permission', () => {
    const t = i18n.t.bind(i18n)
    for (const c of commands) {
      expect(c.title(t)).not.toMatch(/^(nav|palette|report)\./)
      expect(c.permission).toBeDefined()
    }
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length)
    const visible = commands.filter((c) =>
      hasPermission({ user, granted: ['inventory.stock.view'] }, c.permission),
    )
    expect(visible.map((c) => c.id)).toEqual([
      'inventory.reservations',
      'inventory.reports',
      'inventory.reports.reorder',
    ])
  })

  it('navigates to registered routes', () => {
    const navigate = vi.fn()
    for (const c of commands) void c.run({ navigate })
    const known = [
      ...paths(documentsRoutes),
      ...paths(countsRoutes),
      ...paths(reservationsRoutes),
      ...paths(inventoryReportsRoutes),
    ]
    for (const [p] of navigate.mock.calls) {
      expect(known).toContain(String(p).slice(1).split('?')[0])
    }
  })
})
