import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Providers } from '@/app/providers'
import { createQueryClient } from '@/lib/queryClient'
import { COMPANY_A } from '@/test/handlers/fea'
import { setupFea, signIn } from '@/test/handlers/feaRender'
import { server } from '@/test/msw/server'
import type { CustomerExposureData } from '../lib/customer'
import { CustomerExposureBadge } from './CustomerExposureBadge'

const PARTY = '01a00000-0000-7000-8000-0000000000aa'

function setup(permissions: string[], exposure: Partial<CustomerExposureData>) {
  signIn(setupFea({ permissions: { [COMPANY_A]: permissions } }))
  const calls: string[] = []
  server.use(
    http.get('*/api/v1/customers/:id/exposure', ({ request }) => {
      calls.push(new URL(request.url).pathname)
      return HttpResponse.json({
        data: {
          party_id: PARTY,
          limit: '2000.00',
          currency: 'TRY',
          open_invoices: '1200.00',
          open_orders: '300.00',
          total: '1500.00',
          available: '500.00',
          ...exposure,
        },
      })
    }),
  )
  render(
    <Providers queryClient={createQueryClient()}>
      <CustomerExposureBadge partyId={PARTY} />
    </Providers>,
  )
  return calls
}

describe('CustomerExposureBadge', () => {
  it('shows the exposure against the limit', async () => {
    setup(['sales.orders.view'], {})
    const badge = await screen.findByTestId('exposure-badge')
    expect(badge).toHaveTextContent('Risk 1.500,00 TRY / 2.000,00 TRY')
    expect(badge).toHaveAttribute('title', expect.stringContaining('kullanılabilir 500,00 TRY'))
  })

  it('flags an exceeded limit', async () => {
    setup(['sales.invoices.view'], { total: '2100.00', available: '-100.00' })
    expect(await screen.findByTestId('exposure-badge')).toHaveTextContent(
      'Limit aşıldı: 2.100,00 TRY / 2.000,00 TRY',
    )
  })

  it('says unlimited without a risk limit', async () => {
    setup(['sales.quotes.view'], { limit: null, available: null })
    expect(await screen.findByTestId('exposure-badge')).toHaveTextContent('limitsiz')
  })

  it('asks nothing without a sales read permission', async () => {
    const calls = setup(['parties.view', 'sales.reports.view'], {})
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByTestId('exposure-badge')).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
})
