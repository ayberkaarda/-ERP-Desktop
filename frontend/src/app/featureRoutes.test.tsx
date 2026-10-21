import { screen, within } from '@testing-library/react'
import { COMPANY_A, COMPANY_B } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { createPartiesDb, partiesHandlers } from '@/test/handlers/parties'
import { server } from '@/test/msw/server'
import { routes } from './router'

describe('feature routes in the app shell', () => {
  it('opens the party list from the sidebar entry the company grants', async () => {
    const db = setupFea({
      permissions: { [COMPANY_A]: ['parties.view'], [COMPANY_B]: [] },
    })
    server.use(...partiesHandlers(createPartiesDb()))
    signIn(db)
    renderRoutes(routes, '/parties')

    expect(await screen.findByRole('heading', { level: 1, name: 'Cariler' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Ana menü' })
    expect(within(nav).getByRole('link', { name: 'Cariler' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(nav).queryByRole('link', { name: 'Stok kartları' })).not.toBeInTheDocument()
  })

  it.each(['/catalog/items', '/reference/currencies', '/parties/new'])(
    'shows the forbidden state on %s without the permission',
    async (path) => {
      const db = setupFea({ permissions: { [COMPANY_A]: ['parties.view'], [COMPANY_B]: [] } })
      server.use(...partiesHandlers(createPartiesDb()))
      signIn(db)
      renderRoutes(routes, path)

      expect(
        await screen.findByRole('heading', { name: 'Bu sayfaya erişiminiz yok' }),
      ).toBeInTheDocument()
    },
  )
})
