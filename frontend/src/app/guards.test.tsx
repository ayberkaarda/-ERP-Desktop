import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { Outlet } from 'react-router'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { COMPANY_B } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { server } from '@/test/msw/server'
import { RequireAuth } from './guards'

const routes = [
  { path: '/login', element: <p>login</p> },
  {
    path: '/password/change',
    element: (
      <RequireAuth allowPasswordChange>
        <p>change</p>
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <Outlet />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <p>home</p> },
      {
        path: 'users',
        element: (
          <RequireAuth permission="users.view">
            <p>users</p>
          </RequireAuth>
        ),
      },
    ],
  },
]

describe('route guards', () => {
  it('probes the session and sends visitors to login with the return path', async () => {
    setupFea()
    const { router } = renderRoutes(routes, '/users?page=2')
    expect(screen.getByRole('status')).toHaveTextContent('Oturum denetleniyor')
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.state).toEqual({ from: '/users?page=2' })
  })

  it('renders protected content for a live session', async () => {
    const db = setupFea()
    db.authenticated = true
    renderRoutes(routes, '/')
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('offers a retry when the session probe fails', async () => {
    const db = setupFea()
    db.authenticated = true
    server.use(
      http.get('*/api/v1/auth/me', () => HttpResponse.json({}, { status: 503 }), { once: true }),
    )
    renderRoutes(routes, '/')
    const retry = await screen.findByRole('button', { name: 'Tekrar dene' })
    await userEvent.setup().click(retry)
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('gates a route by the active company permissions', async () => {
    const db = setupFea()
    signIn(db)
    renderRoutes(routes, '/users')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()

    act(() => useCompanyStore.getState().setActiveCompany(COMPANY_B))
    expect(await screen.findByText('users')).toBeInTheDocument()
  })

  it('lets super admins through every gate', async () => {
    const db = setupFea()
    db.user.is_super_admin = true
    db.permissions = {}
    signIn(db)
    renderRoutes(routes, '/users')
    expect(await screen.findByText('users')).toBeInTheDocument()
  })

  it('pins a must-change-password account to the change page', async () => {
    const db = setupFea()
    db.user.must_change_password = true
    signIn(db)
    const { router } = renderRoutes(routes, '/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/password/change'))

    act(() => useAuthStore.getState().updateUser({ mustChangePassword: false }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('shows a pending state instead of "forbidden" while permissions refresh', async () => {
    const db = setupFea()
    signIn(db)
    act(() => useAuthStore.getState().setPermissionsState('refreshing'))
    renderRoutes(routes, '/users')
    expect(
      await screen.findByText('Seçili şirketteki yetkileriniz yükleniyor…'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Bu sayfaya erişiminiz yok')).not.toBeInTheDocument()

    act(() => useAuthStore.getState().setPermissionsState('failed'))
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Tekrar dene' }))
    act(() => useCompanyStore.getState().setActiveCompany(COMPANY_B))
    expect(await screen.findByText('users')).toBeInTheDocument()
  })
})
