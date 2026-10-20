import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useAuthStore } from '@/stores/auth'
import { VALID_PASSWORD } from '@/test/handlers/fea'
import { renderRoutes, setupFea } from '@/test/handlers/feaRender'
import { server } from '@/test/msw/server'
import { routes } from './router'

describe('app routes', () => {
  it('signs in from a deep link, shows the shell and reaches the security page', async () => {
    setupFea()
    const user = userEvent.setup()
    const { router } = renderRoutes(routes, '/system/health')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    await user.type(await screen.findByLabelText('E-posta'), 'deniz@keystone.test')
    await user.type(screen.getByLabelText('Parola'), VALID_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/system/health'))
    expect(await screen.findByRole('button', { name: /Bildirimler/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Komut paletini aç' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Kullanıcı menüsü' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Güvenlik ve oturumlar' }))
    expect(await screen.findByRole('heading', { name: 'Güvenlik' })).toBeInTheDocument()
  })

  it('drops the session when any API call returns 401', async () => {
    const db = setupFea()
    db.authenticated = true
    const { router } = renderRoutes(routes, '/system/health')
    expect(await screen.findByRole('button', { name: /Bildirimler/ })).toBeInTheDocument()

    server.use(
      http.get('*/api/v1/health', () =>
        HttpResponse.json(
          { errors: { message: 'Unauthenticated.', code: 'UNAUTHENTICATED' } },
          { status: 401 },
        ),
      ),
    )
    await userEvent.setup().click(screen.getByRole('button', { name: 'Yeniden denetle' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('signs out from the user menu', async () => {
    const db = setupFea()
    db.authenticated = true
    const user = userEvent.setup()
    const { router } = renderRoutes(routes, '/system/health')
    await user.click(await screen.findByRole('button', { name: 'Kullanıcı menüsü' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Oturumu kapat' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(db.authenticated).toBe(false)
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('offers retry or a warned local sign-out when the server logout fails', async () => {
    const db = setupFea()
    db.authenticated = true
    let fail = true
    server.use(
      http.post('*/api/v1/auth/logout', () =>
        fail
          ? HttpResponse.json({ errors: { message: 'x', code: 'SERVER_ERROR' } }, { status: 500 })
          : new HttpResponse(null, { status: 204 }),
      ),
    )
    const user = userEvent.setup()
    const { router } = renderRoutes(routes, '/system/health')
    await user.click(await screen.findByRole('button', { name: 'Kullanıcı menüsü' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Oturumu kapat' }))

    const dialog = await screen.findByRole('dialog', { name: 'Oturum kapatılamadı' })
    expect(dialog).toHaveTextContent('oturum sunucuda açık kalabilir')
    expect(router.state.location.pathname).toBe('/system/health')
    expect(useAuthStore.getState().status).toBe('authenticated')

    await user.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByRole('dialog', { name: 'Oturum kapatılamadı' })).toBeInTheDocument()

    fail = false
    await user.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('signs out locally only on explicit request', async () => {
    const db = setupFea()
    db.authenticated = true
    server.use(http.post('*/api/v1/auth/logout', () => HttpResponse.json({}, { status: 503 })))
    const user = userEvent.setup()
    const { router } = renderRoutes(routes, '/system/health')
    await user.click(await screen.findByRole('button', { name: 'Kullanıcı menüsü' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Oturumu kapat' }))
    await user.click(await screen.findByRole('button', { name: 'Yalnızca bu cihazda kapat' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(useAuthStore.getState().status).toBe('anonymous')
  })
})
