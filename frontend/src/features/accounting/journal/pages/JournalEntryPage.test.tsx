import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ACC_CASH,
  ACC_RECEIVABLES,
  ENTRY_DRAFT,
  ENTRY_POSTED,
  PARTY_ACME,
} from '@/test/handlers/accounting2'
import type { JournalEntryInput } from '../types'
import { renderAccounting2, setupAccounting2 } from '../testing'
import './JournalEntryPage'

async function pickAccount(
  user: ReturnType<typeof userEvent.setup>,
  row: number,
  text: string,
  option: RegExp,
) {
  const table = screen.getByRole('table', { name: 'Fiş satırları' })
  const box = within(table).getByRole('combobox', { name: `Hesap, ${row}. satır` })
  await user.click(box)
  await user.type(box, text)
  await user.click(await screen.findByRole('option', { name: option }))
}

// Keyboard-driven flows through the real router are slow on a cold run.
vi.setConfig({ testTimeout: 15_000 })

describe('journal entry editor', () => {
  it('enters a balanced entry from the keyboard, saves it and posts it', async () => {
    const db = setupAccounting2()
    const user = userEvent.setup()
    const { router } = renderAccounting2('/accounting/journal-entries/new')
    const table = await screen.findByRole('table', { name: 'Fiş satırları' })

    await pickAccount(user, 1, '100', /100 · Kasa/)
    const debit1 = within(table).getByLabelText('Borç, 1. satır')
    await user.click(debit1)
    await user.keyboard('1200')
    // Enter after a debit skips the credit cell and lands on the next line's account.
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(within(table).getByRole('combobox', { name: 'Hesap, 2. satır' })).toHaveFocus(),
    )
    expect(screen.getByText('Alacak eksik: 1.200,00')).toBeInTheDocument()

    await pickAccount(user, 2, '600', /600 · Yurt İçi Satışlar/)
    const credit2 = within(table).getByLabelText('Alacak, 2. satır')
    await user.click(credit2)
    // F9 writes the balancing amount.
    await user.keyboard('{F9}')
    await waitFor(() => expect(credit2).toHaveValue('1200'))
    expect(screen.getByText('Fiş dengede')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/accounting/journal-entries/je-new-1'),
    )
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/journal-entries')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    const body = post?.body as JournalEntryInput
    expect(body.lines).toEqual([
      expect.objectContaining({ account_id: ACC_CASH, debit: '1200.00', credit: '0.00' }),
      expect.objectContaining({ debit: '0.00', credit: '1200.00', currency_code: null }),
    ])

    await screen.findByRole('heading', { name: 'Taslak fiş' })
    const postBtn = screen.getByRole('button', { name: 'Kesinleştir' })
    await user.click(postBtn)
    const confirm = await screen.findByRole('alertdialog')
    expect(
      within(confirm).getByText(/2 satır · Borç 1.200,00 · Alacak 1.200,00/),
    ).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Kesinleştir' }))
    const done = await screen.findByRole('dialog', { name: /Fiş kesinleşti/ })
    expect(within(done).getByTestId('posted-number')).toHaveTextContent('2026/000002')
    const postCall = db.calls.find((c) => c.path === '/journal-entries/je-new-1/post')
    expect(postCall?.body).toEqual({ version: 1 })
    expect(postCall?.headers.get('Idempotency-Key')).toBeTruthy()
    await user.click(within(done).getByRole('button', { name: 'Tamam' }))
    expect(await screen.findByRole('heading', { name: 'Fiş 2026/000002' })).toBeInTheDocument()
  })

  it('adds the party column for accounts that require one and validates it', async () => {
    const db = setupAccounting2()
    const user = userEvent.setup()
    renderAccounting2('/accounting/journal-entries/new')
    const table = await screen.findByRole('table', { name: 'Fiş satırları' })
    expect(within(table).queryByRole('columnheader', { name: 'Cari' })).not.toBeInTheDocument()

    await pickAccount(user, 1, '120', /120 · Alıcılar/)
    expect(await within(table).findByRole('columnheader', { name: 'Cari' })).toBeInTheDocument()
    await user.type(within(table).getByLabelText('Borç, 1. satır'), '50')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    expect(await within(table).findByText('Bu hesap cari ister.')).toBeInTheDocument()
    expect(db.calls.some((c) => c.method === 'POST')).toBe(false)

    const party = within(table).getByRole('combobox', { name: 'Cari, 1. satır' })
    await user.type(party, 'Acme')
    await user.click(await screen.findByRole('option', { name: /Acme Ticaret/ }))
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() => expect(db.calls.some((c) => c.method === 'POST')).toBe(true))
    const body = db.calls.find((c) => c.method === 'POST')?.body as JournalEntryInput
    expect(body.lines[0]).toMatchObject({ account_id: ACC_RECEIVABLES, party_id: PARTY_ACME })
  })

  it('shows currency columns with a base amount preview for foreign-currency accounts', async () => {
    setupAccounting2()
    const user = userEvent.setup()
    renderAccounting2('/accounting/journal-entries/new')
    const table = await screen.findByRole('table', { name: 'Fiş satırları' })
    await pickAccount(user, 1, 'Garanti', /102.02 · Garanti USD/)
    await user.type(await within(table).findByLabelText('Döviz tutarı, 1. satır'), '100')
    await user.type(within(table).getByLabelText('Kur, 1. satır'), '34,5')
    expect(within(table).getByTestId('base-preview-0')).toHaveTextContent('3.450,00')
    // Line 2 has no currency account: its fx cell is a read-only placeholder.
    expect(within(table).getByLabelText('Döviz tutarı, 2. satır')).toHaveAttribute('readonly')
    await user.click(within(table).getByRole('button', { name: '1. satıra TL karşılığını yaz' }))
    expect(within(table).getByLabelText('Borç, 1. satır')).toHaveValue('3.450,00')
  })

  it('surfaces an optimistic-lock conflict with a reload prompt', async () => {
    const db = setupAccounting2()
    const user = userEvent.setup()
    renderAccounting2(`/accounting/journal-entries/${ENTRY_DRAFT}`)
    const description = await screen.findByLabelText('Açıklama', {
      selector: 'input[name="description"]',
    })
    expect(description).toHaveValue('Kira tahakkuku')
    const draft = db.entries.find((e) => e.id === ENTRY_DRAFT)
    if (draft) Object.assign(draft, { version: 4, description: 'Başkası değiştirdi' })

    await user.clear(description)
    await user.type(description, 'Ekim kirası')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    const alert = await screen.findByText('Fiş başka biri tarafından değiştirildi')
    expect(alert).toBeInTheDocument()
    const patch = db.calls.find((c) => c.method === 'PATCH')
    expect(patch?.body).toMatchObject({ version: 3, description: 'Ekim kirası' })

    await user.click(screen.getByRole('button', { name: 'Son hâli yükle' }))
    await waitFor(() => expect(description).toHaveValue('Başkası değiştirdi'))
    expect(screen.queryByText('Fiş başka biri tarafından değiştirildi')).not.toBeInTheDocument()
  })

  it('hides posting without the post permission', async () => {
    setupAccounting2({ permissions: ['accounting.entries.view', 'accounting.entries.create'] })
    renderAccounting2(`/accounting/journal-entries/${ENTRY_DRAFT}`)
    expect(await screen.findByRole('button', { name: 'Taslağı kaydet' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Kesinleştir' })).not.toBeInTheDocument()
  })

  it('posts an unchanged stored draft with the post permission alone', async () => {
    const db = setupAccounting2({
      permissions: ['accounting.entries.view', 'accounting.entries.post'],
    })
    const user = userEvent.setup()
    renderAccounting2(`/accounting/journal-entries/${ENTRY_DRAFT}`)
    await user.click(await screen.findByRole('button', { name: 'Kesinleştir' }))
    expect(screen.queryByRole('button', { name: 'Taslağı kaydet' })).not.toBeInTheDocument()
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: 'Kesinleştir' }))
    expect(await screen.findByRole('dialog', { name: /Fiş kesinleşti/ })).toBeInTheDocument()
    expect(db.calls.some((c) => c.path === `/journal-entries/${ENTRY_DRAFT}/post`)).toBe(true)
    // Nothing is saved first: the draft was not changed.
    expect(db.calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('guards the routes by permission', async () => {
    setupAccounting2({ permissions: ['accounting.entries.view'] })
    renderAccounting2('/accounting/journal-entries/new')
    expect(await screen.findByText('Bu sayfaya erişiminiz yok')).toBeInTheDocument()
  })
})

describe('posted journal entry', () => {
  it('is read-only, shows the audit trail and reverses with date and reason', async () => {
    const db = setupAccounting2()
    const user = userEvent.setup()
    const { router } = renderAccounting2(`/accounting/journal-entries/${ENTRY_POSTED}`)
    expect(await screen.findByRole('heading', { name: 'Fiş 2026/000001' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Taslağı kaydet' })).not.toBeInTheDocument()
    const lines = screen.getByRole('table', { name: 'Fiş satırları' })
    expect(within(lines).getByText('600 · Yurt İçi Satışlar')).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Değişiklik geçmişi' })).getAllByRole('listitem')
        .length,
    ).toBeGreaterThan(0)
    // The API names the causer by id only.
    expect(
      within(screen.getByRole('region', { name: 'Değişiklik geçmişi' })).getAllByText('Kullanıcı')
        .length,
    ).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Ters kayıt' }))
    const dialog = await screen.findByRole('dialog', { name: /2026\/000001 için ters kayıt/ })
    await user.click(within(dialog).getByRole('button', { name: 'Ters kaydı oluştur' }))
    expect(await within(dialog).findByText('Gerekçe en az 3 karakter olmalı.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Gerekçe/), 'Hatalı tutar')
    await user.click(within(dialog).getByRole('button', { name: 'Ters kaydı oluştur' }))

    await waitFor(() => expect(router.state.location.pathname).toMatch(/je-rev-/))
    const call = db.calls.find((c) => c.path === `/journal-entries/${ENTRY_POSTED}/reverse`)
    expect(call?.body).toMatchObject({ reason: 'Hatalı tutar', version: 2 })
    expect(call?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(await screen.findByText('Bu fiş şu fişin ters kaydıdır:')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '2026/000001' })).toHaveAttribute(
      'href',
      `/accounting/journal-entries/${ENTRY_POSTED}`,
    )
  })
})
