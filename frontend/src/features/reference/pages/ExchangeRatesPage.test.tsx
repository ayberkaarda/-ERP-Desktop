import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { pickOption, renderReference, setupReference } from '@/test/handlers/referenceRender'
import { ExchangeRatesPage } from './ExchangeRatesPage'

describe('ExchangeRatesPage', () => {
  it('shows the latest rates and a calm status line while rates are fresh', async () => {
    setupReference({ db: { rateStatus: { last_fetch_date: '2026-10-20', stale_days: 4 } } })
    renderReference(<ExchangeRatesPage />)

    const table = await screen.findByRole('table', { name: /güncel kurlar/i })
    expect(within(table).getByRole('rowheader', { name: 'USD' })).toBeInTheDocument()
    expect(within(table).getByText('41,2500')).toBeInTheDocument()

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Kurlar en son 20.10.2026 tarihinde güncellendi.')
    expect(status).toHaveAttribute('data-stale', 'false')
  })

  it('turns into a warning once the rates are older than 4 days', async () => {
    setupReference({ db: { rateStatus: { last_fetch_date: '2026-10-15', stale_days: 5 } } })
    renderReference(<ExchangeRatesPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-stale', 'true')
    expect(alert).toHaveTextContent('Kurlar güncel değil')
    expect(alert).toHaveTextContent('15.10.2026')
    expect(alert).toHaveTextContent('5 gün önce')
  })

  it('filters the history by date range through the list query', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<ExchangeRatesPage />)

    await user.click(await screen.findByRole('tab', { name: 'Kur geçmişi' }))
    const from = await screen.findByLabelText('Başlangıç tarihi')
    await user.type(from, '19.10.2026')
    await user.tab()

    await waitFor(() => {
      const last = db.calls.filter((c) => c.path === '/exchange-rates').at(-1)
      expect(last?.query.get('filter[date_from]')).toBe('2026-10-19')
    })
    await user.selectOptions(screen.getByLabelText('Para birimi', { selector: 'select' }), 'USD')
    await waitFor(() => {
      const last = db.calls.filter((c) => c.path === '/exchange-rates').at(-1)
      expect(last?.query.get('filter[currency_code]')).toBe('USD')
    })
  })

  it('submits a manual rate as decimal strings with an idempotency key', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<ExchangeRatesPage />)

    await user.click(await screen.findByRole('button', { name: 'Elle kur gir' }))
    const dialog = await screen.findByRole('dialog')

    await pickOption(user, within(dialog).getByRole('combobox', { name: /Para birimi/ }), /USD/)
    await user.type(within(dialog).getByLabelText(/^Döviz alış/), '41,25')
    await user.type(within(dialog).getByLabelText(/^Döviz satış/), '41,3')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/exchange-rates')
    const body = post?.body as Record<string, string>
    expect(body).toMatchObject({ currency_code: 'USD', source: 'manual' })
    expect(body.forex_buying).toMatch(/^41.250*$/)
    expect(body.forex_selling).toMatch(/^41.30*$/)
    expect(post?.body).not.toHaveProperty('banknote_buying')
    expect(post?.headers.get('Idempotency-Key')).toMatch(/[0-9a-f-]{36}/)
  })

  it('validates required rates before sending and maps server field errors', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<ExchangeRatesPage />)

    await user.click(await screen.findByRole('button', { name: 'Elle kur gir' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect((await within(dialog).findAllByText('Bu alan zorunludur.')).length).toBeGreaterThan(0)
    expect(db.calls.some((c) => c.method === 'POST')).toBe(false)

    await pickOption(user, within(dialog).getByRole('combobox', { name: /Para birimi/ }), /USD/)
    await user.type(within(dialog).getByLabelText(/^Döviz alış/), '50')
    await user.type(within(dialog).getByLabelText(/^Döviz satış/), '40')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Satış kuru alış kurundan küçük olamaz.')
    expect(dialog).toBeInTheDocument()
  })

  it('hides the manual entry action without the manage permission', async () => {
    setupReference({ permissions: ['exchange_rates.view'] })
    renderReference(<ExchangeRatesPage />)
    await screen.findByRole('table', { name: /güncel kurlar/i })
    expect(screen.queryByRole('button', { name: 'Elle kur gir' })).not.toBeInTheDocument()
  })
})
