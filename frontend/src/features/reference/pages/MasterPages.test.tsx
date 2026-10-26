import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { pickOption, renderReference, setupReference } from '@/test/handlers/referenceRender'
import { CostCentersPage } from './CostCentersPage'
import { CurrenciesPage } from './CurrenciesPage'
import { PaymentTermsPage } from './PaymentTermsPage'
import { ProjectsPage } from './ProjectsPage'
import { ReferenceSettingsPage } from './ReferenceSettingsPage'

describe('CurrenciesPage', () => {
  it('activates a currency for the company and keeps the base currency locked', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<CurrenciesPage />)

    const euro = await screen.findByRole('checkbox', {
      name: 'EUR para birimini şirkette etkinleştir',
    })
    expect(euro).not.toBeChecked()
    expect(
      screen.getByRole('checkbox', { name: 'TRY para birimini şirkette etkinleştir' }),
    ).toBeDisabled()
    expect(screen.getByText('Ana para birimi')).toBeInTheDocument()

    await user.click(euro)
    await waitFor(() =>
      expect(
        db.calls.find((c) => c.method === 'PATCH' && c.path === '/currencies/c-eur')?.body,
      ).toEqual({ is_active: true, version: 1 }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: 'EUR para birimini şirkette etkinleştir' }),
      ).toBeChecked(),
    )
  })

  it('is read-only without currencies.update', async () => {
    setupReference({ permissions: ['currencies.view'] })
    renderReference(<CurrenciesPage />)
    await screen.findByText('Euro')
    expect(screen.queryByRole('checkbox', { name: /etkinleştir/ })).not.toBeInTheDocument()
  })
})

describe('PaymentTermsPage', () => {
  it('creates a payment term with an idempotency key and reports server field errors', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<PaymentTermsPage />)

    await user.click(await screen.findByRole('button', { name: 'Yeni ödeme koşulu' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Kod/), 'net30')
    await user.type(within(dialog).getByLabelText(/^Ad\b/), 'Yinelenen')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    // The fake API rejects the duplicate code with a field error.
    expect(await within(dialog).findAllByText(/Bu kod zaten kullanılıyor/)).not.toHaveLength(0)

    const code = within(dialog).getByLabelText(/^Kod/)
    await user.clear(code)
    await user.type(code, 'net45')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const posts = db.calls.filter((c) => c.method === 'POST' && c.path === '/payment-terms')
    expect(posts).toHaveLength(2)
    expect(posts[1]?.body).toMatchObject({ code: 'NET45', due_days: 30, is_active: true })
    // A changed payload is a different request: it never reuses the earlier key.
    expect(posts[0]?.headers.get('Idempotency-Key')).not.toBe(
      posts[1]?.headers.get('Idempotency-Key'),
    )
    expect(await screen.findByText('NET45')).toBeInTheDocument()
  })

  it('offers a reload on VERSION_CONFLICT and saves on top of the fresh version', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<PaymentTermsPage />)

    await user.click(await screen.findByRole('button', { name: 'NET30 kaydını düzenle' }))
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByLabelText(/^Ad\b/)
    await user.clear(name)
    await user.type(name, 'Yeni ad')

    db.conflictOnNextPatch = true
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(
      await within(dialog).findByText('Kayıt başka biri tarafından değiştirildi'),
    ).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Yeniden yükle' }))
    await waitFor(() => expect(within(dialog).getByLabelText(/^Ad\b/)).toHaveValue('30 gün vade'))

    await user.clear(within(dialog).getByLabelText(/^Ad\b/))
    await user.type(within(dialog).getByLabelText(/^Ad\b/), 'Yeni ad')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const patches = db.calls.filter((c) => c.method === 'PATCH' && c.path === '/payment-terms/pt1')
    expect(patches[0]?.body).toMatchObject({ version: 1 })
    expect(patches[1]?.body).toMatchObject({ version: 2, name: 'Yeni ad' })
  })

  it('deletes after confirmation', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<PaymentTermsPage />)

    await user.click(await screen.findByRole('button', { name: 'NET30 kaydını sil' }))
    const confirm = await screen.findByRole('alertdialog')
    expect(db.calls.some((c) => c.method === 'DELETE')).toBe(false)
    await user.click(within(confirm).getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(db.calls.some((c) => c.method === 'DELETE')).toBe(true))
    // The backend requires the lock version on DELETE.
    const del = db.calls.find((c) => c.method === 'DELETE')
    expect(del?.path).toBe('/payment-terms/pt1')
    expect(del?.query.get('version')).toBe('1')
    await waitFor(() => expect(screen.queryByText('NET30')).not.toBeInTheDocument())
  })

  it('gates create, edit and delete on the separate backend permissions', async () => {
    setupReference({ permissions: ['payment_terms.view', 'payment_terms.update'] })
    renderReference(<PaymentTermsPage />)

    expect(await screen.findByRole('button', { name: 'NET30 kaydını düzenle' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'NET30 kaydını sil' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yeni ödeme koşulu' })).not.toBeInTheDocument()
  })
})

describe('ProjectsPage', () => {
  it('lists projects and creates one with a cost center', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<ProjectsPage />)

    expect(await screen.findByText('PRJ-1')).toBeInTheDocument()
    expect(screen.getByText('01.03.2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Yeni proje' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Kod/), 'prj-2')
    await user.type(within(dialog).getByLabelText(/^Ad\b/), 'Yeni depo')
    await pickOption(
      user,
      within(dialog).getByRole('combobox', { name: 'Masraf merkezi' }),
      /ADM-IT/,
    )
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/projects')
    expect(post?.body).toMatchObject({
      code: 'PRJ-2',
      status: 'planned',
      cost_center_id: 'cc2',
      start_date: null,
    })
  })
})

describe('CostCentersPage', () => {
  it('renders the tree, collapses a branch and deactivates a node', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<CostCentersPage />)

    const tree = await screen.findByRole('tree', { name: 'Masraf merkezleri' })
    expect(within(tree).getByText('ADM-IT')).toBeInTheDocument()
    const items = within(tree).getAllByRole('treeitem')
    expect(items[0]).toHaveAttribute('aria-level', '1')
    expect(items[1]).toHaveAttribute('aria-level', '2')

    await user.click(within(tree).getByRole('button', { name: 'Yönetim altını daralt' }))
    expect(within(tree).queryByText('ADM-IT')).not.toBeInTheDocument()
    await user.click(within(tree).getByRole('button', { name: 'Yönetim altını genişlet' }))

    await user.click(
      within(tree).getByRole('button', { name: 'Bilgi işlem masraf merkezini pasif yap' }),
    )
    await waitFor(() =>
      expect(
        db.calls.find((c) => c.method === 'PATCH' && c.path === '/cost-centers/cc2')?.body,
      ).toEqual({
        is_active: false,
        version: 1,
      }),
    )
  })

  it('leaves the cost center itself and its descendants out of the parent choices', async () => {
    setupReference()
    const user = userEvent.setup()
    renderReference(<CostCentersPage />)

    await user.click(await screen.findByRole('button', { name: 'Yönetim kaydını düzenle' }))
    const dialog = await screen.findByRole('dialog')
    const parent = within(dialog).getByLabelText('Üst masraf merkezi')
    const labels = within(parent)
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(labels).toEqual(['Üst kayıt yok (kök)'])
  })
})

describe('ReferenceSettingsPage', () => {
  it('reads the base currency and saves a new one through the settings API', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<ReferenceSettingsPage />)

    const field = await screen.findByRole('combobox', { name: 'Ana para birimi' })
    await waitFor(() => expect(field).toHaveValue('TRY · Türk Lirası'))
    const save = screen.getByRole('button', { name: 'Kaydet' })
    expect(save).toBeDisabled()

    await pickOption(user, field, /USD/)
    expect(save).toBeEnabled()
    await user.click(save)
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: 'Değiştir' }))

    await waitFor(() => {
      const patch = db.calls.find((c) => c.method === 'PATCH' && c.path === '/settings')
      expect(patch?.body).toEqual({ settings: { 'company.base_currency': 'USD' } })
    })
    await waitFor(() => expect(db.settings['company.base_currency']).toBe('USD'))
  })

  it('is read-only for users without settings.update', async () => {
    setupReference({ permissions: ['settings.view', 'currencies.view'] })
    renderReference(<ReferenceSettingsPage />)
    const field = await screen.findByRole('combobox', { name: 'Ana para birimi' })
    expect(field).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Kaydet' })).not.toBeInTheDocument()
    expect(screen.getByText('Bu ayarı değiştirme yetkiniz yok.')).toBeInTheDocument()
  })
})
