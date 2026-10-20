import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { useQuery } from '@tanstack/react-query'
import { Can, checkPermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { COMPANY_A, COMPANY_B } from '@/test/handlers/fea'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { server } from '@/test/msw/server'
import { CompanySwitcher } from './CompanySwitcher'

describe('CompanySwitcher', () => {
  it('lists /auth/me companies and switches the X-Company-Id header', async () => {
    const db = setupFea()
    signIn(db)
    const info = vi.spyOn(platform.notify, 'info').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderRoutes([{ path: '/', element: <CompanySwitcher /> }])

    const trigger = screen.getByRole('button', {
      name: 'Şirket değiştir, geçerli şirket: Anadolu Makina A.Ş.',
    })
    await user.click(trigger)
    expect(screen.getByText('Yönetici')).toBeInTheDocument()
    await user.click(screen.getByRole('menuitemradio', { name: /Ege Dış Ticaret/ }))

    expect(useCompanyStore.getState().activeCompanyId).toBe(COMPANY_B)
    expect(
      screen.getByRole('button', {
        name: 'Şirket değiştir, geçerli şirket: Ege Dış Ticaret Ltd. Şti.',
      }),
    ).toBeInTheDocument()
    expect(info).toHaveBeenCalledWith('Ege Dış Ticaret Ltd. Şti. şirketine geçildi.')

    let header: string | null = null
    server.use(
      http.get('*/api/v1/probe', ({ request }) => {
        header = request.headers.get('X-Company-Id')
        return HttpResponse.json({ data: null })
      }),
    )
    await platform.http.get('/probe')
    await waitFor(() => expect(header).toBe(COMPANY_B))
    info.mockRestore()
  })
})

function TenantData() {
  const q = useQuery({
    queryKey: ['tenant-data'],
    queryFn: ({ signal }) => platform.http.get<{ data: string }>('/tenant-data', { signal }),
  })
  return <p>{q.data ? `data:${q.data.data}` : 'loading'}</p>
}

describe('company switch isolation', () => {
  it('cancels the previous company request and never shows its data under the new one', async () => {
    const db = setupFea()
    signIn(db)
    let releaseA: () => void = () => undefined
    const gateA = new Promise<void>((r) => (releaseA = r))
    let abortedA = false
    server.use(
      http.get('*/api/v1/tenant-data', async ({ request }) => {
        const company = request.headers.get('X-Company-Id')
        if (company === COMPANY_A) {
          request.signal.addEventListener('abort', () => (abortedA = true))
          await gateA
        }
        return HttpResponse.json({ data: company === COMPANY_A ? 'A' : 'B' })
      }),
    )
    const user = userEvent.setup()
    renderRoutes([
      {
        path: '/',
        element: (
          <>
            <CompanySwitcher />
            <TenantData />
          </>
        ),
      },
    ])
    expect(screen.getByText('loading')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Şirket değiştir/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /Ege Dış Ticaret/ }))
    expect(await screen.findByText('data:B')).toBeInTheDocument()
    expect(abortedA).toBe(true)
    releaseA()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('data:A')).not.toBeInTheDocument()
  })

  it('denies actions until a fresh /auth/me confirms the new company permissions', async () => {
    const db = setupFea()
    signIn(db)
    db.permissions = { ...db.permissions, [COMPANY_B]: ['invoices.create'] }
    let releaseMe: () => void = () => undefined
    const gateMe = new Promise<void>((r) => (releaseMe = r))
    server.use(
      http.get('*/api/v1/auth/me', async () => {
        await gateMe
        return HttpResponse.json({
          data: { user: db.user, companies: db.companies, permissions: db.permissions },
        })
      }),
    )
    const user = userEvent.setup()
    renderRoutes([
      {
        path: '/',
        element: (
          <>
            <CompanySwitcher />
            <Can permission="invoices.create" fallback={<span>no-create</span>}>
              <button type="button">Yeni fatura</button>
            </Can>
          </>
        ),
      },
    ])
    await user.click(screen.getByRole('button', { name: /Şirket değiştir/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /Ege Dış Ticaret/ }))

    expect(useAuthStore.getState().permissionsState).toBe('refreshing')
    expect(screen.getByText('no-create')).toBeInTheDocument()
    expect(checkPermission('invoices.create')).toBe(false)

    releaseMe()
    expect(await screen.findByRole('button', { name: 'Yeni fatura' })).toBeInTheDocument()
    expect(useAuthStore.getState().permissions[COMPANY_B]).toEqual(['invoices.create'])
    expect(useAuthStore.getState().permissionsState).toBe('fresh')
  })

  it('keeps permissions denied when the refresh fails', async () => {
    const db = setupFea()
    signIn(db)
    server.use(http.get('*/api/v1/auth/me', () => HttpResponse.json({}, { status: 503 })))
    const error = vi.spyOn(platform.notify, 'error').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderRoutes([{ path: '/', element: <CompanySwitcher /> }])
    await user.click(screen.getByRole('button', { name: /Şirket değiştir/ }))
    await user.click(screen.getByRole('menuitemradio', { name: /Ege Dış Ticaret/ }))
    await waitFor(() => expect(useAuthStore.getState().permissionsState).toBe('failed'))
    expect(checkPermission('dashboard.view')).toBe(false)
    expect(error).toHaveBeenCalledWith('Şirket yetkileri yenilenemedi.', expect.anything())
    error.mockRestore()
  })
})
