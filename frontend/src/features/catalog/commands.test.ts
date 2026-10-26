import i18n from '@/lib/i18n'
import { hasPermission } from '@/lib/permissions'
import type { SessionUser } from '@/stores/auth'
import { catalogCommands, registerCatalogCommands } from './commands'
import { catalogRoutes } from './routes'

const user = { id: 'u', isSuperAdmin: false } as SessionUser

describe('catalog commands and routes', () => {
  it('titles every command and gates it by permission', () => {
    const commands = catalogCommands()
    const t = i18n.t.bind(i18n)
    for (const c of commands) {
      expect(c.title(t)).not.toMatch(/^nav\.|^palette\./)
      expect(c.permission).toBeDefined()
    }
    expect(commands.find((c) => c.id === 'catalog.items')?.title(t)).toBe('Stok kartları')

    const visible = commands.filter((c) =>
      hasPermission({ user, granted: ['items.view'] }, c.permission),
    )
    // Item viewers may also read units and categories (writes stay gated on the pages).
    expect(visible.map((c) => c.id)).toEqual([
      'catalog.items',
      'catalog.units',
      'catalog.categories',
    ])

    // The manage permission alone opens them as well (read OR manage, like the API policies).
    const managers = commands.filter((c) =>
      hasPermission(
        { user, granted: ['units.manage', 'item_categories.manage', 'discount_rules.manage'] },
        c.permission,
      ),
    )
    expect(managers.map((c) => c.id)).toEqual([
      'catalog.units',
      'catalog.categories',
      'catalog.discountRules',
    ])
  })

  it('navigates to the matching route', () => {
    const navigate = vi.fn()
    for (const c of catalogCommands()) void c.run({ navigate })
    const paths = navigate.mock.calls.map(([p]) => String(p).slice(1))
    const routePaths = catalogRoutes.flatMap((r) => (r.children ?? []).map((c) => c.path))
    for (const p of paths) expect(routePaths).toContain(p)
  })

  it('registers and unregisters', () => {
    const off = registerCatalogCommands()
    expect(typeof off).toBe('function')
    off()
  })
})
