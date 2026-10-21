import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { YEAR_2025, YEAR_2026 } from '@/test/handlers/accounting1'
import { ACC_PERMISSIONS } from '../../shared/permissions'
import { renderAccounting, setupAccounting } from '../../shared/testing'
import './PeriodsBoardPage'

const card = (name: RegExp) => screen.findByRole('listitem', { name })

describe('PeriodsBoardPage', () => {
  it('soft closes, closes and reopens a period with a reason', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting(`/accounting/periods?year=${YEAR_2026}`)
    const jan = await card(/^1 · Ocak 2026/)
    expect(within(jan).getByText('Açık')).toBeInTheDocument()

    await user.click(within(jan).getByRole('button', { name: /dönemini geçici kapat/ }))
    let dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Geçici kapat' }))
    await waitFor(() => expect(within(jan).getByText('Geçici kapalı')).toBeInTheDocument())
    expect(db.periods.find((p) => p.id === `${YEAR_2026}-p1`)?.status).toBe('soft_closed')

    await user.click(within(jan).getByRole('button', { name: /dönemini yeniden aç/ }))
    dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Gerekçe/), 'Eksik fatura kaydı')
    await user.click(within(dialog).getByRole('button', { name: 'Yeniden aç' }))
    await waitFor(() => expect(within(jan).getByText('Açık')).toBeInTheDocument())
    const reopen = db.calls.find((c) => c.path === `/accounting-periods/${YEAR_2026}-p1/reopen`)
    expect(reopen?.body).toEqual({ version: 2, reason: 'Eksik fatura kaydı' })
  })

  it('shows why closing is blocked when the period has draft entries', async () => {
    const db = setupAccounting()
    const feb = db.periods.find((p) => p.id === `${YEAR_2026}-p2`)
    if (feb) feb.draft_entries_count = 3
    const user = userEvent.setup()
    renderAccounting(`/accounting/periods?year=${YEAR_2026}`)
    const card2 = await card(/^2 · Şubat 2026/)
    expect(within(card2).getByText('Taslak fiş: 3')).toBeInTheDocument()
    await user.click(within(card2).getByRole('button', { name: /dönemini kapat$/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Dönem kapatılamıyor')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Dönemi kapat' })).toBeDisabled()
  })

  it('renders the server refusal when drafts appear after the board loaded', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting(`/accounting/periods?year=${YEAR_2026}`)
    const mar = await card(/^3 · Mart 2026/)
    const p = db.periods.find((x) => x.id === `${YEAR_2026}-p3`)
    if (p) p.draft_entries_count = 2
    await user.click(within(mar).getByRole('button', { name: /dönemini kapat$/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Dönemi kapat' }))
    expect(
      await within(dialog).findByText('Dönemde taslak fişler varken dönem kapatılamaz.'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Dönemdeki taslak fiş sayısı: 2.')).toBeInTheDocument()
    expect(p?.status).toBe('open')
  })

  it('offers no actions in a closed year and hides reopen without the permission', async () => {
    setupAccounting({
      permissions: [ACC_PERMISSIONS.periods.view, ACC_PERMISSIONS.periods.close],
    })
    renderAccounting(`/accounting/periods?year=${YEAR_2025}`)
    expect(await screen.findByText(/Bu mali yıl kapalı/)).toBeInTheDocument()
    const dec = await card(/^12 · Aralık 2025/)
    expect(within(dec).queryByRole('button')).not.toBeInTheDocument()
  })

  it('filters by status from the URL', async () => {
    const db = setupAccounting()
    const p = db.periods.find((x) => x.id === `${YEAR_2026}-p5`)
    if (p) p.status = 'closed'
    renderAccounting(`/accounting/periods?year=${YEAR_2026}&status=closed`)
    expect(await card(/^5 · Mayıs 2026/)).toBeInTheDocument()
    const board = screen.getByRole('list', { name: '2026 dönemleri' })
    expect(within(board).getAllByRole('listitem')).toHaveLength(1)
  })
})
