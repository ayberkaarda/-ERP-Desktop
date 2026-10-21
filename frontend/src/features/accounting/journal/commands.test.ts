import type { RouteObject } from 'react-router'
import i18n from '@/lib/i18n'
import { hasPermission } from '@/lib/permissions'
import type { SessionUser } from '@/stores/auth'
import { reportsCommands } from '../reports/commands'
import { reportsRoutes } from '../reports/routes'
import { journalCommands } from './commands'
import { journalRoutes } from './routes'

const user = { id: 'u', isSuperAdmin: false } as SessionUser
const paths = (routes: RouteObject[]) =>
  routes.flatMap((r) => (r.children ?? []).map((c) => c.path))

describe('journal and report commands', () => {
  const commands = [...journalCommands(), ...reportsCommands()]

  it('titles every command and gates it by permission', () => {
    const t = i18n.t.bind(i18n)
    for (const c of commands) {
      expect(c.title(t)).not.toMatch(/^nav\.|^palette\./)
      expect(c.permission).toBeDefined()
    }
    const visible = commands.filter((c) =>
      hasPermission({ user, granted: ['accounting.entries.view'] }, c.permission),
    )
    expect(visible.map((c) => c.id)).toEqual(['accounting.journalEntries'])
  })

  it('navigates to registered routes', () => {
    const navigate = vi.fn()
    for (const c of commands) void c.run({ navigate })
    const known = [...paths(journalRoutes), ...paths(reportsRoutes)]
    for (const [p] of navigate.mock.calls) expect(known).toContain(String(p).slice(1))
  })
})
