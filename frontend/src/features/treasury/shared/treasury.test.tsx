import { act, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { useCompanyStore } from '@/stores/company'
import { useAuthStore } from '@/stores/auth'
import { ListPage } from './ListPage'
import { treasuryApi } from './api'
import { ActionDialog } from './ActionDialog'
import { useState } from 'react'
import userEvent from '@testing-library/user-event'
import { COMPANY_A } from '@/test/handlers/fea'
import {
  TREAS_ACCOUNT,
  TREAS_INSTRUMENT,
  TREAS_MOVEMENT,
  TREAS_PAYMENT,
  TREAS_STATEMENT,
} from '@/test/handlers/treasury'
import { treasuryCommands } from '../commands'
import { Allocations } from '../payments/Allocations'
import { compatibleInvoice } from '../payments/lib'
import { compatibleInstrumentInvoice } from '../payments/lib'
import { createTreasuryDb } from '@/test/handlers/treasury'
import { renderRoutes } from '@/test/handlers/feaRender'
import { invalidateTreasury, submissionKeys, treasuryKey } from './keys'
import { TREASURY_PERMISSIONS, renderTreasury, setupTreasury } from './testing'
import type { Allocation } from './types'
import './RecordPage'
import '../reports/ReportsPage'

describe('treasury navigation and data boundaries', () => {
  it('clears previous-company rows while the next company fails to load', async () => {
    setupTreasury()
    useAuthStore.setState((state) => ({
      permissions: { ...state.permissions, 'company-b': TREASURY_PERMISSIONS },
    }))
    const { queryClient } = renderRoutes([{ path: '/', element: <ListPage area="accounts" /> }])
    queryClient.setDefaultOptions({ queries: { retry: false } })
    await screen.findByText('Merkez banka')
    server.use(
      http.get('*/api/v1/treasury-accounts', async () => {
        await delay(100)
        return HttpResponse.json({ errors: { message: 'Unavailable' } }, { status: 500 })
      }),
    )
    await act(() => useCompanyStore.setState({ activeCompanyId: 'company-b' }))
    expect(screen.queryByText('Merkez banka')).not.toBeInTheDocument()
    await screen.findByRole('alert')
    expect(screen.queryByText('Merkez banka')).not.toBeInTheDocument()
  })
  it('loads invoices beyond the first eligible page', async () => {
    const db = setupTreasury()
    const first = db.openItems[0]
    if (!first) throw new Error('Missing invoice')
    db.openItems = Array.from({ length: 26 }, (_, i) => ({
      ...first,
      id: `invoice-${i}`,
      number: `INVOICE-${i}`,
    }))
    renderRoutes([{ path: '/', element: <AllocationHarness /> }])
    await screen.findByRole('checkbox', { name: /INVOICE-0$/ })
    expect(screen.queryByRole('checkbox', { name: /INVOICE-25$/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }))
    expect(await screen.findByRole('checkbox', { name: /INVOICE-25$/ })).toBeInTheDocument()
  })
  it('sends extension status filters at the top level and offers the full instrument graph', async () => {
    setupTreasury()
    let received: URL | undefined
    server.use(
      http.get('*/api/v1/treasury-instruments', ({ request }) => {
        received = new URL(request.url)
        return HttpResponse.json({
          data: [],
          meta: { pagination: { current_page: 1, last_page: 1, per_page: 25, total: 0 } },
        })
      }),
    )
    renderTreasury('/treasury/instruments')
    const status = await screen.findByRole('combobox', { name: 'Durum' })
    expect(
      within(status)
        .getAllByRole('option')
        .map((o) => (o as HTMLOptionElement).value),
    ).toEqual([
      '',
      'draft',
      'portfolio',
      'issued',
      'collection',
      'pledged',
      'cleared',
      'endorsed',
      'dishonoured',
      'returned',
    ])
    await userEvent.selectOptions(status, 'pledged')
    await waitFor(() => expect(received?.searchParams.get('status')).toBe('pledged'))
    expect(received?.searchParams.has('filter[status]')).toBe(false)
  })
  it.each(['accounts', 'payments', 'transfers', 'instruments', 'banking', 'plans', 'reports'])(
    'guards %s without permission',
    async (area) => {
      setupTreasury([])
      renderTreasury(`/treasury/${area}`)
      expect(
        await screen.findByRole('heading', { name: 'Bu sayfaya erişiminiz yok' }),
      ).toBeInTheDocument()
    },
  )
  it('renders accounts with company balance and no edit controls for a viewer', async () => {
    setupTreasury(['treasury.accounts.view'])
    renderTreasury(`/treasury/accounts/${TREAS_ACCOUNT}`)
    expect(await screen.findByRole('heading', { name: 'Merkez banka' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Düzenle' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Açılış bakiyesi kaydet' })).not.toBeInTheDocument()
  })
  it('hides opening balance after an account has had movements', async () => {
    const db = setupTreasury()
    Object.assign(db.records.accounts[0] ?? {}, { has_movements: true, balance: '0.0000' })
    renderTreasury(`/treasury/accounts/${TREAS_ACCOUNT}`)
    await screen.findByRole('heading', { name: 'Merkez banka' })
    expect(screen.queryByRole('button', { name: 'Açılış bakiyesi kaydet' })).not.toBeInTheDocument()
  })
  it('renders account labels and leaves arbitrary descriptions untranslated', async () => {
    const db = setupTreasury()
    Object.assign(db.records.payments[0] ?? {}, { description: 'cash' })
    renderTreasury(`/treasury/payments/${TREAS_PAYMENT}`)
    expect(await screen.findByText('BNK-1 · Merkez banka')).toBeInTheDocument()
    expect(screen.getByText('cash')).toBeInTheDocument()
  })
  it('registers separate permission-bound navigation entries', () => {
    const commands = treasuryCommands()
    expect(commands).toHaveLength(7)
    expect(commands.find((c) => c.id === 'treasury.banking')?.permission).toBe(
      'treasury.banking.view',
    )
  })
  it('scopes retry keys and invalidations to the captured company', () => {
    const body = { version: 1 }
    expect(submissionKeys.keyFor({ company: 'a', body })).toBe(
      submissionKeys.keyFor({ company: 'a', body }),
    )
    expect(submissionKeys.keyFor({ company: 'b', body })).not.toBe(
      submissionKeys.keyFor({ company: 'a', body }),
    )
    const invalidateQueries = vi.fn()
    invalidateTreasury({ invalidateQueries } as never, 'a')
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: treasuryKey('a') })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['purchasing', 'a'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sales', 'a'] })
  })
  it('does not select refund notes in the wrong money direction', () => {
    const item = createTreasuryDb().openItems[0]
    if (!item) throw new Error('Missing invoice fixture')
    expect(compatibleInvoice(item, 'receipt')).toBe(true)
    expect(compatibleInvoice({ ...item, invoice_type: 'return' }, 'receipt')).toBe(false)
    expect(
      compatibleInvoice({ ...item, module: 'purchasing', invoice_type: 'return' }, 'receipt'),
    ).toBe(true)
  })
})
describe('posting and reversal dialogs', () => {
  it.each([
    ['payments', 'post'],
    ['payments', 'submit'],
    ['transfers', 'post'],
  ] as const)(
    '%s %s uses the stored document date and sends only its version',
    async (area, action) => {
      const db = setupTreasury()
      const record = db.records[area][0]
      if (!record) throw new Error('Missing record')
      const version = record.version
      renderRoutes([
        {
          path: '/',
          element: (
            <ActionDialog
              area={area}
              record={record}
              action={action}
              onClose={vi.fn()}
              onDone={vi.fn()}
              onReload={vi.fn()}
            />
          ),
        },
      ])
      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).queryByLabelText(/Belge tarihi/)).not.toBeInTheDocument()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Onayla' }))
      await waitFor(() =>
        expect(db.calls.find((call) => call.path.endsWith(`/${action}`))?.body).toEqual({
          version,
        }),
      )
    },
  )
  it('filters plan fulfilment on the server and loads older matching payments', async () => {
    setupTreasury()
    const requests: URL[] = []
    server.use(
      http.get('*/api/v1/treasury-payments', ({ request }) => {
        const url = new URL(request.url)
        requests.push(url)
        const current = Number(url.searchParams.get('page'))
        return HttpResponse.json({
          data: [
            {
              id: `payment-${current}`,
              reference: `FULFIL-${current}`,
              party_id: createTreasuryDb().openItems[0]?.party_id,
              direction: 'receipt',
              currency_code: 'TRY',
              amount: '100',
            },
          ],
          meta: { pagination: { current_page: current, last_page: 2, total: 2, per_page: 1 } },
        })
      }),
    )
    renderTreasury('/treasury/plans/plan-1')
    await userEvent.click(await screen.findByRole('button', { name: 'Kaydedilmiş ödemeyi bağla' }))
    await screen.findByRole('option', { name: /FULFIL-1/ })
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }))
    expect(await screen.findByRole('option', { name: /FULFIL-2/ })).toBeInTheDocument()
    expect(Object.fromEntries(requests[0]?.searchParams ?? [])).toMatchObject({
      'filter[status]': 'posted',
      'filter[direction]': 'receipt',
      'filter[currency_code]': 'TRY',
      'filter[account_id]': TREAS_ACCOUNT,
    })
  })
  it('reuses the posting key after the response was lost and the dialog reopened', async () => {
    const db = setupTreasury()
    const path = `/treasury-payments/${TREAS_PAYMENT}/post`
    db.failAfterCommit[path] = 1
    const user = userEvent.setup()
    renderTreasury(`/treasury/payments/${TREAS_PAYMENT}`)
    await screen.findByRole('heading', { name: 'Numarasız taslak' })
    await user.click(screen.getByRole('button', { name: 'Kaydet / işle' }))
    let dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    await within(dialog).findByRole('alert')
    await user.click(within(dialog).getByRole('button', { name: 'İptal' }))
    await user.click(screen.getByRole('button', { name: 'Kaydet / işle' }))
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    await screen.findByRole('heading', { name: 'PAY20270001' })
    const calls = db.calls.filter((c) => c.path === path)
    expect(calls).toHaveLength(2)
    if (!calls[0] || !calls[1]) throw new Error('Missing payment calls')
    expect(calls[0].key).toBeTruthy()
    expect(calls[1].key).toBe(calls[0].key)
    expect(calls[0].company).toBe(COMPANY_A)
  })
  it('requires a reversal reason and keeps a server refusal visible', async () => {
    const db = setupTreasury()
    const payment = db.records.payments[0]
    if (!payment) throw new Error('Missing payment fixture')
    payment.status = 'posted'
    db.errors[`/treasury-payments/${TREAS_PAYMENT}/reverse`] = {
      status: 422,
      message: 'Mutabakatı yeniden açın.',
    }
    const user = userEvent.setup()
    renderTreasury(`/treasury/payments/${TREAS_PAYMENT}`)
    await screen.findByRole('heading', { name: 'Numarasız taslak' })
    await user.click(screen.getByRole('button', { name: 'Ters kayıt' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Onayla' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText(/Gerekçe/), 'Yanlış kayıt')
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Mutabakatı yeniden açın.')
    expect(db.calls.find((c) => c.path.endsWith('/reverse'))?.body).toHaveProperty('date')
    expect(db.calls.find((c) => c.path.endsWith('/reverse'))?.body).not.toHaveProperty(
      'document_date',
    )
  })
  it('shows a stale-version message and offers reload without closing silently', async () => {
    const db = setupTreasury()
    db.errors[`/treasury-payments/${TREAS_PAYMENT}/post`] = {
      status: 409,
      message: 'Changed',
      code: 'VERSION_CONFLICT',
    }
    const user = userEvent.setup()
    renderTreasury(`/treasury/payments/${TREAS_PAYMENT}`)
    await screen.findByRole('heading', { name: 'Numarasız taslak' })
    await user.click(screen.getByRole('button', { name: 'Kaydet / işle' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Bu kayıt değişti')
    expect(within(dialog).getByRole('button', { name: 'Güncelle' })).toBeInTheDocument()
  })
  it('clears an instrument through an explicitly selected account', async () => {
    const db = setupTreasury()
    const user = userEvent.setup()
    renderTreasury(`/treasury/instruments/${TREAS_INSTRUMENT}`)
    await screen.findByRole('heading', { name: 'CHK-1' })
    await user.click(screen.getByRole('button', { name: 'Hesaptan tahsil / öde' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText(/Kasa \/ banka hesabı/), TREAS_ACCOUNT)
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    await waitFor(() => expect(db.records.instruments[0]?.status).toBe('cleared'))
    expect(db.calls.find((c) => c.path.endsWith('/clear'))?.body.account_id).toBe(TREAS_ACCOUNT)
  })
})
describe('bank statement workflow', () => {
  it.each(['csv', 'mt940'] as const)(
    'uses a backend delimiter enum for %s preview',
    async (format) => {
      const db = setupTreasury()
      await expect(
        treasuryApi.previewStatement({
          account_id: TREAS_ACCOUNT,
          content: 'statement',
          format,
          delimiter: 'comma',
        }),
      ).resolves.toHaveProperty('id')
      expect(db.calls.at(-1)?.body.delimiter).toBe('comma')
      await expect(
        treasuryApi.previewStatement({
          account_id: TREAS_ACCOUNT,
          content: 'statement',
          format,
          delimiter: ',',
        } as never),
      ).rejects.toHaveProperty('status', 422)
    },
  )
  it('loads the next page of compatible movements', async () => {
    setupTreasury()
    server.use(
      http.get('*/api/v1/treasury-bank-statements/:id/suggestions', ({ request }) => {
        const current = Number(new URL(request.url).searchParams.get('page'))
        return HttpResponse.json({
          data: [
            {
              id: `movement-${current}`,
              movement_id: `movement-${current}`,
              reference: `MATCH-${current}`,
              amount: '100',
              currency_code: 'TRY',
              document_date: '2027-06-15',
            },
          ],
          meta: { pagination: { current_page: current, last_page: 2, total: 2, per_page: 1 } },
        })
      }),
    )
    renderTreasury(`/treasury/banking/${TREAS_STATEMENT}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Eşleştir' }))
    await screen.findByRole('option', { name: /MATCH-1/ })
    await userEvent.click(screen.getByRole('button', { name: 'Sonraki' }))
    expect(await screen.findByRole('option', { name: /MATCH-2/ })).toBeInTheDocument()
  })
  it('requires a fresh preview after the import content changes', async () => {
    const db = setupTreasury()
    const user = userEvent.setup()
    renderTreasury('/treasury/banking/new')
    await screen.findByLabelText(/Ekstre içeriği/)
    await screen.findByRole('option', { name: /BNK-1/ })
    await user.selectOptions(screen.getByLabelText(/Kasa \/ banka hesabı/), TREAS_ACCOUNT)
    await user.type(screen.getByLabelText(/Ekstre içeriği/), 'date,amount\n2027-06-15,100')
    const importButton = screen.getByRole('button', { name: 'Ekstreyi içe aktar' })
    expect(importButton).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Önizleme' }))
    await waitFor(() => expect(importButton).toBeEnabled())
    expect(db.calls.find((call) => call.path.endsWith('/preview'))?.body.delimiter).toBe('comma')
    await user.type(screen.getByLabelText(/Ekstre içeriği/), '0')
    expect(importButton).toBeDisabled()
  })
  it('previews MT940 with a valid default delimiter even when its selector is hidden', async () => {
    const db = setupTreasury()
    renderTreasury('/treasury/banking/new')
    await screen.findByRole('option', { name: /BNK-1/ })
    await userEvent.selectOptions(screen.getByLabelText(/Kasa \/ banka hesabı/), TREAS_ACCOUNT)
    await userEvent.selectOptions(screen.getByLabelText(/Dosya biçimi/), 'mt940')
    await userEvent.type(screen.getByLabelText(/Ekstre içeriği/), ':20:STATEMENT')
    await userEvent.click(screen.getByRole('button', { name: 'Önizleme' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ekstreyi içe aktar' })).toBeEnabled(),
    )
    expect(db.calls.find((call) => call.path.endsWith('/preview'))?.body).toMatchObject({
      format: 'mt940',
      delimiter: 'comma',
    })
  })
  it('matches the canonical movement id rather than a payment alias', async () => {
    const db = setupTreasury()
    const user = userEvent.setup()
    renderTreasury(`/treasury/banking/${TREAS_STATEMENT}`)
    await screen.findByRole('heading', { name: 'ST-1' })
    await user.click(screen.getByRole('button', { name: 'Eşleştir' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText(/Kaydedilmiş ödeme/), TREAS_MOVEMENT)
    await user.click(within(dialog).getByRole('button', { name: 'Onayla' }))
    await waitFor(() => expect(db.calls.some((c) => c.path.endsWith('/match'))).toBe(true))
    const call = db.calls.find((c) => c.path.endsWith('/match'))
    expect(call?.body).toMatchObject({ movement_id: TREAS_MOVEMENT, line_id: 'line-1', version: 1 })
    expect(call?.body).not.toHaveProperty('payment_id')
  })
})
describe('open invoice visibility', () => {
  it('strips server-only payment allocation values when saving a draft', async () => {
    const db = setupTreasury()
    const record = db.records.payments[0]
    if (!record) throw new Error('Missing payment')
    Object.assign(record, {
      allocations: [
        {
          invoice_module: 'sales',
          invoice_id: db.openItems[0]?.id,
          amount: '100.0000',
          fx_rate: '1.000000',
          carrying_amount: '100.0000',
          settlement_amount: '100.0000',
          realized_fx: '0.0000',
        },
      ],
    })
    const user = userEvent.setup()
    renderTreasury(`/treasury/payments/${TREAS_PAYMENT}`)
    await screen.findByRole('heading', { name: 'Numarasız taslak' })
    await user.click(screen.getByRole('button', { name: 'Düzenle' }))
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(db.calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(db.calls.find((c) => c.method === 'PATCH')?.body.allocations).toEqual([
      {
        invoice_module: 'sales',
        invoice_id: db.openItems[0]?.id,
        amount: '100.0000',
        fx_rate: '1.000000',
      },
    ])
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Kaydet' })).not.toBeInTheDocument(),
    )
  })
  it('uses the payment-date rate for same-currency allocations rather than the historical rate', async () => {
    const db = setupTreasury()
    const item = db.openItems[0]
    if (!item) throw new Error('Missing invoice')
    item.currency_code = 'USD'
    item.fx_rate = '36.000000'
    const user = userEvent.setup()
    renderRoutes([{ path: '/', element: <AllocationHarness /> }])
    await user.click(await screen.findByRole('checkbox', { name: /INV-1/ }))
    expect(screen.getByLabelText(/Ödeme tarihindeki kur/)).toHaveValue('40,00')
  })
  it('does not offer return notes or foreign-currency invoices for instruments', () => {
    const item = createTreasuryDb().openItems[0]
    if (!item) throw new Error('Missing invoice')
    expect(compatibleInstrumentInvoice(item, 'receipt', 'TRY')).toBe(true)
    expect(compatibleInstrumentInvoice({ ...item, invoice_type: 'return' }, 'payment', 'TRY')).toBe(
      false,
    )
    expect(compatibleInstrumentInvoice({ ...item, currency_code: 'USD' }, 'receipt', 'TRY')).toBe(
      false,
    )
  })
  it('submits only permitted instrument allocation fields when editing', async () => {
    const db = setupTreasury()
    const record = db.records.instruments[0]
    if (!record) throw new Error('Missing instrument')
    Object.assign(record, {
      status: 'draft',
      allocations: [
        {
          invoice_module: 'sales',
          invoice_id: db.openItems[0]?.id,
          amount: '100.0000',
          fx_rate: '1.000000',
          carrying_amount: '100.0000',
          realized_fx: '0.0000',
        },
      ],
    })
    const user = userEvent.setup()
    renderTreasury(`/treasury/instruments/${TREAS_INSTRUMENT}`)
    await screen.findByRole('heading', { name: 'CHK-1' })
    await user.click(screen.getByRole('button', { name: 'Düzenle' }))
    expect(screen.queryByLabelText(/Ödeme tarihindeki kur/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(db.calls.some((c) => c.method === 'PATCH')).toBe(true))
    expect(db.calls.find((c) => c.method === 'PATCH')?.body.allocations).toEqual([
      { invoice_module: 'sales', invoice_id: db.openItems[0]?.id, amount: '100.0000' },
    ])
  })
  it('does not read open invoices without the source and open-items permissions', async () => {
    setupTreasury(TREASURY_PERMISSIONS.filter((p) => p !== 'sales.invoices.view'))
    renderRoutes([
      {
        path: '/',
        element: <Allocations partyId="party" direction="receipt" value={[]} onChange={vi.fn()} />,
      },
    ])
    expect(await screen.findByText('Bu işlem için yetkiniz yok.')).toBeInTheDocument()
  })
})
function AllocationHarness() {
  const [value, setValue] = useState<Allocation[]>([])
  return (
    <Allocations
      partyId={createTreasuryDb().openItems[0]?.party_id ?? ''}
      direction="receipt"
      value={value}
      onChange={setValue}
      currency="USD"
      fxRate="40.000000"
    />
  )
}
