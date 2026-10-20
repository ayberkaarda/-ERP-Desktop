import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderRoute } from '@/test/render'
import { HealthPage } from './HealthPage'

describe('HealthPage', () => {
  it('reports a healthy API', async () => {
    renderRoute(<HealthPage />)
    expect(await screen.findByText('Çalışıyor')).toBeInTheDocument()
  })

  it('surfaces the API error envelope', async () => {
    server.use(
      http.get('*/api/v1/health', () =>
        HttpResponse.json(
          { errors: { message: 'Veritabanına ulaşılamıyor', code: 'SERVICE_UNAVAILABLE' } },
          { status: 503 },
        ),
      ),
    )
    renderRoute(<HealthPage />)
    expect(await screen.findByText('Erişilemiyor')).toBeInTheDocument()
    expect(screen.getByText('Veritabanına ulaşılamıyor')).toBeInTheDocument()
  })
})
