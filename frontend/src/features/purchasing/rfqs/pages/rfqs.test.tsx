import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RFQ_COLLECTING, RFQ_DRAFT, SUP_ACME, SUP_BETA } from '../../shared/test/handlers'
import { renderPurch, setupPurch, without } from '../../shared/test/testing'
import './RfqListPage'
import './RfqPage'

vi.setConfig({ testTimeout: 30_000 })

const COLLECTING = 'Teklif talebi RFQ2026000000001'

describe('requests for quotation', () => {
  it('invites a supplier on the draft and sends it', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/rfqs/${RFQ_DRAFT}`)
    await screen.findByRole('table', { name: 'Satırlar' })
    await user.type(screen.getByRole('combobox', { name: /Davet edilen tedarikçiler/ }), 'Beta')
    await user.click(await screen.findByRole('option', { name: /Beta Endüstri/ }))
    await user.click(screen.getByRole('button', { name: 'Gönder' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Teklif talebi gönderilsin mi?' })
    // Saved first; unchanged lines stay out so their request links survive.
    const patch = db.calls.find((c) => c.method === 'PATCH')
    expect(patch?.body).toMatchObject({ supplier_ids: [SUP_ACME, SUP_BETA], version: 1 })
    expect(patch?.body).not.toHaveProperty('lines')
    expect(within(dialog).getByText(/\(2\)/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Gönder' }))
    expect(
      await screen.findByRole('heading', { name: /^Teklif talebi RFQ2026/ }),
    ).toBeInTheDocument()
  })

  it('compares quotes: lowest price, fastest delivery and the cheapest complete supplier', async () => {
    setupPurch()
    const user = userEvent.setup()
    renderPurch(`/purchasing/rfqs/${RFQ_COLLECTING}`)
    await screen.findByRole('heading', { name: COLLECTING })
    await user.click(screen.getByRole('tab', { name: 'Karşılaştırma' }))
    const matrix = await screen.findByRole('table', { name: 'Karşılaştırma' })
    const beta = within(matrix).getByTestId(`cell-${RFQ_COLLECTING}-l1-${SUP_BETA}`)
    expect(beta).toHaveTextContent('8,50')
    expect(beta).toHaveTextContent('En düşük')
    expect(within(matrix).getByTestId(`cell-${RFQ_COLLECTING}-l1-${SUP_ACME}`)).toHaveTextContent(
      'En hızlı',
    )
    // ACME quoted every line: 10 × 9 + 5 × 100 = 590; BETA only one line.
    expect(within(matrix).getByTestId(`total-${SUP_ACME}`)).toHaveTextContent('590,00')
    expect(within(matrix).getByTestId(`total-${SUP_ACME}`)).toHaveTextContent('Tüm satırlar')
    expect(within(matrix).getByTestId(`total-${SUP_BETA}`)).toHaveTextContent('1/2 satır')
  })

  it('records a supplier quote with decimal strings and reuses the key on retry', async () => {
    const db = setupPurch({ db: { dropNext: ['/purchase-rfqs/quotes'] } })
    const user = userEvent.setup()
    renderPurch(`/purchasing/rfqs/${RFQ_COLLECTING}`)
    await screen.findByRole('heading', { name: COLLECTING })
    await user.click(screen.getByRole('tab', { name: 'Tedarikçiler ve teklifler' }))
    await user.click(screen.getByRole('button', { name: 'Beta Endüstri Ltd. teklifini gir' }))
    const dialog = await screen.findByRole('dialog', { name: 'Beta Endüstri Ltd. teklifi' })
    const price = within(dialog).getByLabelText('NAK-01 · Nakliye hizmeti birim fiyatı')
    await user.click(price)
    await user.keyboard('92,25')
    await user.type(
      within(dialog).getByLabelText('NAK-01 · Nakliye hizmeti teslim süresi (gün)'),
      '7',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Teklifi kaydet' }))
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Teklifi kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const calls = db.calls.filter((c) => c.path === `/purchase-rfqs/${RFQ_COLLECTING}/quotes`)
    expect(calls).toHaveLength(2)
    expect(calls[1]?.headers.get('Idempotency-Key')).toBe(calls[0]?.headers.get('Idempotency-Key'))
    expect(calls[0]?.body).toMatchObject({
      party_id: SUP_BETA,
      quotes: [
        { rfq_line_id: `${RFQ_COLLECTING}-l1`, unit_price: '8.5' },
        { rfq_line_id: `${RFQ_COLLECTING}-l2`, unit_price: '92.250000', lead_time_days: 7 },
      ],
    })
  })

  it('awards per line to the lowest quotes, creating one draft order per supplier', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    const { router } = renderPurch(`/purchasing/rfqs/${RFQ_COLLECTING}`)
    await screen.findByRole('heading', { name: COLLECTING })
    await user.click(await screen.findByRole('button', { name: 'Karar ver' }))
    const dialog = await screen.findByRole('dialog', { name: 'RFQ2026000000001 için karar' })
    await user.click(within(dialog).getByRole('radio', { name: 'Satır bazında tedarikçi seç' }))
    expect(
      within(dialog).getByRole('radio', { name: 'CVT-01 · Cıvata M8 için Beta Endüstri Ltd.' }),
    ).toBeChecked()
    const summary = within(dialog).getByRole('region', { name: 'Oluşacak siparişler' })
    expect(summary).toHaveTextContent('Beta Endüstri Ltd. — 1 satır')
    expect(summary).toHaveTextContent('85,00')
    await user.click(within(dialog).getByRole('button', { name: 'Siparişleri oluştur (2)' }))
    await waitFor(() => expect(router.state.location.search).toContain('filter[status]=draft'))
    const award = db.calls.find((c) => c.path === `/purchase-rfqs/${RFQ_COLLECTING}/award`)
    expect(award?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(award?.body).toMatchObject({
      version: 1,
      lines: [
        { rfq_line_id: `${RFQ_COLLECTING}-l1`, party_id: SUP_BETA },
        { rfq_line_id: `${RFQ_COLLECTING}-l2`, party_id: SUP_ACME },
      ],
    })
    expect(db.orders.filter((o) => o.rfq_id === RFQ_COLLECTING)).toHaveLength(2)
  })

  it('awards the whole RFQ to the cheapest complete supplier and opens its order', async () => {
    const db = setupPurch()
    const user = userEvent.setup()
    const { router } = renderPurch(`/purchasing/rfqs/${RFQ_COLLECTING}`)
    await screen.findByRole('heading', { name: COLLECTING })
    await user.click(await screen.findByRole('button', { name: 'Karar ver' }))
    const dialog = await screen.findByRole('dialog', { name: 'RFQ2026000000001 için karar' })
    expect(within(dialog).getByRole('radio', { name: /Acme Tedarik/ })).toBeChecked()
    await user.click(within(dialog).getByRole('button', { name: 'Siparişleri oluştur (1)' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toMatch(/^\/purchasing\/orders\/o-new-/),
    )
    expect(
      db.calls.find((c) => c.path === `/purchase-rfqs/${RFQ_COLLECTING}/award`)?.body,
    ).toMatchObject({
      party_id: SUP_ACME,
    })
  })

  it('hides award and quote entry without their permissions', async () => {
    setupPurch({ permissions: without('purchasing.rfqs.award', 'purchasing.rfqs.update') })
    const user = userEvent.setup()
    renderPurch(`/purchasing/rfqs/${RFQ_COLLECTING}`)
    await screen.findByRole('heading', { name: COLLECTING })
    expect(screen.queryByRole('button', { name: 'Karar ver' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Teklif talebini iptal et' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Tedarikçiler ve teklifler' }))
    expect(screen.queryByRole('button', { name: /teklifini gir/ })).not.toBeInTheDocument()
  })
})
