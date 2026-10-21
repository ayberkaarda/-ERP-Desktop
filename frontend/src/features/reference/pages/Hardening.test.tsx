import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '@/test/msw/server'
import { renderRoutes } from '@/test/handlers/feaRender'
import { renderReference, setupReference } from '@/test/handlers/referenceRender'
import { fetchAll } from '../api/client'
import { CurrencySelect, TaxCodeSelect } from '../index'
import { CostCentersPage } from './CostCentersPage'
import { ExchangeRatesPage } from './ExchangeRatesPage'
import { PaymentTermsPage } from './PaymentTermsPage'
import { ReferenceSettingsPage } from './ReferenceSettingsPage'
import { WarehouseDetailPage } from './WarehouseDetailPage'

const clientError = () =>
  HttpResponse.json({ errors: { message: 'Hata', code: 'BAD_REQUEST' } }, { status: 400 })

describe('idempotent creates after an uncertain outcome', () => {
  it('replays the same key for an identical retry and uses a new key for an edited payload', async () => {
    const db = setupReference()
    const lost: (string | null)[] = []
    server.use(
      http.post(
        '*/api/v1/payment-terms',
        ({ request }) => {
          lost.push(request.headers.get('Idempotency-Key'))
          return HttpResponse.error()
        },
        { once: true },
      ),
    )
    const user = userEvent.setup()
    renderReference(<PaymentTermsPage />)

    await user.click(await screen.findByRole('button', { name: 'Yeni ödeme koşulu' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Kod/), 'net60')
    await user.type(within(dialog).getByLabelText(/^Ad\b/), 'Altmış gün')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    expect(await within(dialog).findByText(/Sonuç bilinmiyor/)).toBeInTheDocument()
    expect(lost).toHaveLength(1)

    // Identical payload: same key, so the server can replay the first attempt.
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/payment-terms')
    expect(post?.headers.get('Idempotency-Key')).toBe(lost[0])
  })

  it('does not reuse the key of a lost request when the payload changed', async () => {
    const db = setupReference()
    const lost: (string | null)[] = []
    server.use(
      http.post(
        '*/api/v1/payment-terms',
        ({ request }) => {
          lost.push(request.headers.get('Idempotency-Key'))
          return HttpResponse.error()
        },
        { once: true },
      ),
    )
    const user = userEvent.setup()
    renderReference(<PaymentTermsPage />)

    await user.click(await screen.findByRole('button', { name: 'Yeni ödeme koşulu' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Kod/), 'net60')
    await user.type(within(dialog).getByLabelText(/^Ad\b/), 'Altmış gün')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await within(dialog).findByText(/Sonuç bilinmiyor/)

    await user.type(within(dialog).getByLabelText(/^Ad\b/), ' (düzeltilmiş)')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/payment-terms')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(post?.headers.get('Idempotency-Key')).not.toBe(lost[0])
  })
})

describe('conflict reload', () => {
  it('shows a failure when the reload cannot read the record and recovers on retry', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<PaymentTermsPage />)

    await user.click(await screen.findByRole('button', { name: 'NET30 kaydını düzenle' }))
    const dialog = await screen.findByRole('dialog')
    db.conflictOnNextPatch = true
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await within(dialog).findByText('Kayıt başka biri tarafından değiştirildi')

    server.use(http.get('*/api/v1/payment-terms/pt1', clientError, { once: true }))
    await user.click(within(dialog).getByRole('button', { name: 'Yeniden yükle' }))
    expect(
      await within(dialog).findByText('Kayıt yeniden yüklenemedi. Tekrar deneyin.'),
    ).toBeInTheDocument()
    // The conflict prompt stays so the user can try again.
    await user.click(within(dialog).getByRole('button', { name: 'Yeniden yükle' }))
    await waitFor(() =>
      expect(
        within(dialog).queryByText('Kayıt başka biri tarafından değiştirildi'),
      ).not.toBeInTheDocument(),
    )
  })

  it('a move conflict reloads the record before retrying with the new version', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderRoutes(
      [{ path: '/reference/warehouses/:id', element: <WarehouseDetailPage /> }],
      '/reference/warehouses/w1',
    )

    await user.click(await screen.findByRole('button', { name: 'A koridoru lokasyonunu taşı' }))
    const dialog = await screen.findByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Yeni üst lokasyon'), 'l3')
    // Someone else saved the location first.
    const stored = db.locations.w1?.find((l) => l.id === 'l1')
    if (stored) stored.version = 5
    await user.click(within(dialog).getByRole('button', { name: 'Taşı' }))
    await within(dialog).findByText('Kayıt başka biri tarafından değiştirildi')

    await user.click(within(dialog).getByRole('button', { name: 'Yeniden yükle' }))
    await waitFor(() =>
      expect(
        within(dialog).queryByText('Kayıt başka biri tarafından değiştirildi'),
      ).not.toBeInTheDocument(),
    )
    await user.selectOptions(within(dialog).getByLabelText('Yeni üst lokasyon'), 'l3')
    await user.click(within(dialog).getByRole('button', { name: 'Taşı' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const patches = db.calls.filter(
      (c) => c.method === 'PATCH' && c.path === '/warehouses/w1/locations/l1',
    )
    expect(patches.map((p) => (p.body as { version: number }).version)).toEqual([1, 5])
  })
})

describe('fetchAll', () => {
  it('fails with LIMIT_EXCEEDED instead of truncating', async () => {
    server.use(
      http.get('*/api/v1/things', () =>
        HttpResponse.json({
          data: Array.from({ length: 100 }, (_, i) => ({ id: i })),
          meta: { last_page: 9 },
        }),
      ),
    )
    await expect(fetchAll('/things', {}, undefined, 2)).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })

  it('keeps paging when the API sends no paging meta', async () => {
    server.use(
      http.get('*/api/v1/things', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'))
        return HttpResponse.json({
          data: Array.from({ length: page === 1 ? 100 : 5 }, (_, i) => ({ id: `${page}-${i}` })),
        })
      }),
    )
    expect(await fetchAll('/things')).toHaveLength(105)
  })
})

describe('selects', () => {
  it('filters tax codes by effective date, default today', async () => {
    setupReference()
    const user = userEvent.setup()
    renderReference(
      <>
        <TaxCodeSelect aria-label="Bugün" value={null} onChange={() => undefined} />
        <TaxCodeSelect
          aria-label="Eski"
          asOf="2022-01-01"
          value={null}
          onChange={() => undefined}
        />
      </>,
    )
    await user.click(screen.getByRole('combobox', { name: 'Bugün' }))
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByRole('option', { name: /KDV20/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /KDV18/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    await user.click(screen.getByRole('combobox', { name: 'Eski' }))
    await user.keyboard('{ArrowDown}')
    expect(await screen.findByRole('option', { name: /KDV18/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /KDV20/ })).not.toBeInTheDocument()
  })

  it('shows an accessible error with retry when the lookup fails', async () => {
    setupReference()
    server.use(http.get('*/api/v1/currencies', clientError, { once: true }))
    const user = userEvent.setup()
    renderReference(<CurrencySelect aria-label="Para" value={null} onChange={() => undefined} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Veriler yüklenemedi.')
    await user.click(within(alert).getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByRole('combobox', { name: 'Para' })).toBeInTheDocument()
  })
})

describe('rate status banner', () => {
  it('reports an unavailable status with a retry instead of hiding', async () => {
    setupReference()
    server.use(http.get('*/api/v1/exchange-rates/status', clientError, { once: true }))
    const user = userEvent.setup()
    renderReference(<ExchangeRatesPage />)

    await screen.findByText('Kur durumu alınamadı.')
    await user.click(screen.getByRole('button', { name: 'Tekrar dene' }))
    expect(await screen.findByText(/Kurlar en son/)).toBeInTheDocument()
  })
})

describe('base currency change', () => {
  it('asks for confirmation with an impact warning before saving', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<ReferenceSettingsPage />)

    const field = await screen.findByRole('combobox', { name: 'Ana para birimi' })
    await waitFor(() => expect(field).toHaveValue('TRY · Türk Lirası'))
    await user.click(field)
    await user.keyboard('{ArrowDown}')
    await user.click(await screen.findByRole('option', { name: /USD/ }))
    expect(screen.getByText(/raporlamayı ve kur dönüşümlerini etkiler/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(confirm).toHaveTextContent('TRY yerine USD')
    expect(db.calls.some((c) => c.method === 'PATCH')).toBe(false)

    await user.click(within(confirm).getByRole('button', { name: 'Vazgeç' }))
    expect(db.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })
})

describe('tree keyboard behaviour', () => {
  it('uses a roving tabindex and arrow, Home/End and Enter keys', async () => {
    setupReference()
    const user = userEvent.setup()
    renderReference(<CostCentersPage />)

    const tree = await screen.findByRole('tree', { name: 'Masraf merkezleri' })
    const [root, child] = within(tree).getAllByRole('treeitem')
    expect(root).toHaveAttribute('tabindex', '0')
    expect(child).toHaveAttribute('tabindex', '-1')

    root?.focus()
    await user.keyboard('{ArrowDown}')
    expect(child).toHaveFocus()
    expect(child).toHaveAttribute('tabindex', '0')
    expect(root).toHaveAttribute('tabindex', '-1')

    await user.keyboard('{ArrowLeft}')
    expect(root).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(root).toHaveAttribute('aria-expanded', 'false')
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(1)

    await user.keyboard('{ArrowRight}')
    expect(root).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{ArrowRight}')
    expect(within(tree).getAllByRole('treeitem')[1]).toHaveFocus()

    await user.keyboard('{Home}')
    expect(within(tree).getAllByRole('treeitem')[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(within(tree).getAllByRole('treeitem')[1]).toHaveFocus()

    await user.keyboard('{Home}{Enter}')
    expect(within(tree).getAllByRole('treeitem')[0]).toHaveAttribute('aria-expanded', 'false')
    await user.keyboard(' ')
    expect(within(tree).getAllByRole('treeitem')[0]).toHaveAttribute('aria-expanded', 'true')
  })
})
