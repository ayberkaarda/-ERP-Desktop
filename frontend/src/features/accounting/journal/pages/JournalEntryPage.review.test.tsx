import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { ENTRY_DRAFT } from '@/test/handlers/accounting2'
import { COMPANY_A, COMPANY_B } from '@/test/handlers/fea'
import { server } from '@/test/msw/server'
import { useCompanyStore } from '@/stores/company'
import type { JournalEntry, JournalLine } from '../types'
import { renderAccounting2, setupAccounting2 } from '../testing'
import './JournalEntryPage'

// Keyboard-driven flows through the real router are slow on a cold run.
vi.setConfig({ testTimeout: 30_000 })

const descriptionField = () =>
  screen.findByLabelText('Açıklama', { selector: 'input[name="description"]' })

function draftOf(db: { entries: JournalEntry[] }) {
  const draft = db.entries.find((e) => e.id === ENTRY_DRAFT)
  if (!draft) throw new Error('draft missing')
  return draft
}

describe('journal editor review fixes', () => {
  it('pins the version at edit start: a refetch shows a notice and never swaps it', async () => {
    const db = setupAccounting2()
    const user = userEvent.setup()
    const { queryClient } = renderAccounting2(`/accounting/journal-entries/${ENTRY_DRAFT}`)
    const description = await descriptionField()
    await user.clear(description)
    await user.type(description, 'Benim düzenlemem')

    Object.assign(draftOf(db), { version: 4, description: 'Başkası kaydetti' })
    await act(() => queryClient.invalidateQueries())
    expect(await screen.findByText('Fiş başka bir yerde değişti')).toBeInTheDocument()
    expect(description).toHaveValue('Benim düzenlemem')

    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    expect(await screen.findByText('Fiş başka biri tarafından değiştirildi')).toBeInTheDocument()
    const patch = db.calls.find((c) => c.method === 'PATCH')
    expect(patch?.body).toMatchObject({ version: 3 })
    expect(draftOf(db).description).toBe('Başkası kaydetti')
  })

  it('keeps the editor and unsaved edits when a background refetch fails', async () => {
    setupAccounting2()
    const user = userEvent.setup()
    const { queryClient } = renderAccounting2(`/accounting/journal-entries/${ENTRY_DRAFT}`)
    const description = await descriptionField()
    await user.clear(description)
    await user.type(description, 'Kaydedilmedi')
    server.use(
      http.get('*/api/v1/journal-entries/:id', () =>
        HttpResponse.json({ errors: { message: 'Sunucu hatası', code: 'X' } }, { status: 500 }),
      ),
    )
    await act(() => queryClient.invalidateQueries())
    expect(await screen.findByText(/Fişin son hâli alınamadı/)).toBeInTheDocument()
    expect(await descriptionField()).toHaveValue('Kaydedilmedi')
    expect(screen.getByRole('button', { name: 'Taslağı kaydet' })).toBeInTheDocument()
  })

  it('writes a save started under one company into that company only', async () => {
    const db = setupAccounting2()
    const user = userEvent.setup()
    let patched = false
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.patch('*/api/v1/journal-entries/:id', async ({ request }) => {
        patched = true
        await gate
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          data: { ...draftOf(db), description: body.description, version: 4 },
        })
      }),
    )
    const { queryClient } = renderAccounting2(`/accounting/journal-entries/${ENTRY_DRAFT}`)
    const description = await descriptionField()
    await user.clear(description)
    await user.type(description, 'A şirketinde')
    await user.click(screen.getByRole('button', { name: 'Taslağı kaydet' }))
    await waitFor(() => expect(patched).toBe(true))

    act(() => {
      useCompanyStore.setState({ activeCompanyId: COMPANY_B })
    })
    await act(async () => {
      release()
      await gate
    })
    const key = (company: string) => [
      'accounting-journal',
      company,
      'entries',
      'detail',
      ENTRY_DRAFT,
    ]
    await waitFor(() =>
      expect(queryClient.getQueryData<JournalEntry>(key(COMPANY_A))?.version).toBe(4),
    )
    expect(queryClient.getQueryData<JournalEntry>(key(COMPANY_B))?.description).not.toBe(
      'A şirketinde',
    )
    expect(screen.queryByText('Taslak kaydedildi.')).not.toBeInTheDocument()
  })

  it('rechecks version and balance at the moment the post is confirmed', async () => {
    const db = setupAccounting2()
    const user = userEvent.setup()
    renderAccounting2(`/accounting/journal-entries/${ENTRY_DRAFT}`)
    await user.click(await screen.findByRole('button', { name: 'Kesinleştir' }))
    const dialog = await screen.findByRole('alertdialog')

    // Someone else saved an unbalanced version while the dialog was open.
    const draft = draftOf(db)
    Object.assign(draft, { version: 4, lines: draft.lines.slice(0, 1) })
    await user.click(within(dialog).getByRole('button', { name: 'Kesinleştir' }))
    expect(await screen.findByText('Fiş başka biri tarafından değiştirildi')).toBeInTheDocument()
    expect(db.calls.some((c) => c.path.endsWith('/post'))).toBe(false)
    expect(draftOf(db).status).toBe('draft')
  })

  it('refuses to post when the stored draft no longer balances', async () => {
    const db = setupAccounting2()
    const user = userEvent.setup()
    renderAccounting2(`/accounting/journal-entries/${ENTRY_DRAFT}`)
    await user.click(await screen.findByRole('button', { name: 'Kesinleştir' }))
    const dialog = await screen.findByRole('alertdialog')
    const draft = draftOf(db)
    draft.lines = draft.lines.slice(0, 1)
    await user.click(within(dialog).getByRole('button', { name: 'Kesinleştir' }))
    expect(await screen.findByText(/Fiş artık dengede değil/)).toBeInTheDocument()
    expect(db.calls.some((c) => c.path.endsWith('/post'))).toBe(false)
  })

  it('stops every add-line path at the 500-line limit', async () => {
    const db = setupAccounting2()
    const draft = draftOf(db)
    const [expense, cash] = draft.lines as [JournalLine, JournalLine]
    draft.lines = Array.from({ length: 500 }, (_, i) => {
      const base = i % 2 === 0 ? expense : cash
      return { ...base, id: `big-${i}`, line_no: i + 1 }
    })
    const user = userEvent.setup()
    renderAccounting2(`/accounting/journal-entries/${ENTRY_DRAFT}`)
    const table = await screen.findByRole('table', { name: 'Fiş satırları' }, { timeout: 20_000 })
    const rows = () => within(table).getAllByRole('row', { name: /^\d+\. satır$/ }).length
    await waitFor(() => expect(rows()).toBe(500), { timeout: 20_000 })

    await user.click(screen.getByRole('button', { name: 'Satır ekle' }))
    expect(rows()).toBe(500)
    expect(await screen.findAllByText('Bir fişte en çok 500 satır olabilir.')).not.toHaveLength(0)

    const desc = within(table).getByLabelText('Açıklama, 3. satır')
    desc.focus()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(rows()).toBe(500)

    // Enter on the last editable cell of the last line (here the cost center picker).
    const last = within(table).getByRole('combobox', { name: 'Masraf merkezi, 500. satır' })
    last.focus()
    await user.keyboard('{Enter}')
    expect(rows()).toBe(500)
  }, 120_000)
})
