import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { COMPANY_B } from '@/test/handlers/fea'
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
