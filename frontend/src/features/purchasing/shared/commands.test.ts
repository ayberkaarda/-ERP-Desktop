import type { RouteObject } from 'react-router'
import i18n from '@/lib/i18n'
import { hasPermission } from '@/lib/permissions'
import type { SessionUser } from '@/stores/auth'
import { purchaseOrdersCommands } from '../orders/commands'
import { purchaseOrdersRoutes } from '../orders/routes'
import { purchaseRequestsCommands } from '../requests/commands'
import { purchaseRequestsRoutes } from '../requests/routes'
import { purchaseRfqsCommands } from '../rfqs/commands'
import { purchaseRfqsRoutes } from '../rfqs/routes'

const user = { id: 'u', isSuperAdmin: false } as SessionUser
const paths = (routes: RouteObject[]) =>
  routes.flatMap((r) => (r.children ?? []).map((c) => c.path))

describe('purchasing request, RFQ and order commands and routes', () => {
  const commands = [
    ...purchaseRequestsCommands(),
    ...purchaseRfqsCommands(),
    ...purchaseOrdersCommands(),
  ]

  it('titles every command and gates it by permission', () => {
    const t = i18n.t.bind(i18n)
    for (const c of commands) {
      expect(c.title(t)).not.toMatch(/^palette\./)
      expect(c.permission).toBeDefined()
    }
    expect(new Set(commands.map((c) => c.id)).size).toBe(commands.length)
    const visible = (granted: string[]) =>
      commands.filter((c) => hasPermission({ user, granted }, c.permission)).map((c) => c.id)
    expect(visible(['purchasing.requests.view'])).toEqual(['purchasing.requests'])
    expect(visible(['purchasing.orders.view', 'purchasing.orders.create'])).toEqual([
      'purchasing.orders',
      'purchasing.orders.new',
    ])
    expect(visible(['purchasing.rfqs.create'])).toEqual([])
  })

  it('navigates to the pages the routes serve', () => {
    const navigate = vi.fn()
    for (const c of commands) void c.run({ navigate })
    const served = [
      ...paths(purchaseRequestsRoutes),
      ...paths(purchaseRfqsRoutes),
      ...paths(purchaseOrdersRoutes),
    ].map((p) => `/${p ?? ''}`)
    for (const [target] of navigate.mock.calls as [string][]) expect(served).toContain(target)
    expect(served).toEqual(
      expect.arrayContaining([
        '/purchasing/requests/:id',
        '/purchasing/rfqs/new',
        '/purchasing/orders/:id',
      ]),
    )
  })
})
