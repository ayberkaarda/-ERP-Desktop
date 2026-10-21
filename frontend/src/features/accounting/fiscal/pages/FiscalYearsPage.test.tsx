import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { YEAR_2025, YEAR_2026 } from '@/test/handlers/accounting1'
import { ACC_PERMISSIONS } from '../../shared/permissions'
import { renderAccounting, setupAccounting } from '../../shared/testing'
import './FiscalYearsPage'

describe('FiscalYearsPage', () => {
  it('creates the next year, previews the periods and shows the generated ones', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/fiscal-years')
    expect(await screen.findByText('2026 hesap dönemi')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yeni mali yıl' }))
    const dialog = await screen.findByRole('dialog', { name: 'Yeni mali yıl' })
    // Suggested: the day after the latest year ends.
    expect(within(dialog).getByLabelText(/^Yıl kodu/)).toHaveValue('2027')
    const preview = within(dialog).getByRole('table', { name: 'Oluşturulacak dönemler' })
    expect(within(preview).getAllByRole('row')).toHaveLength(13)
    await user.click(within(dialog).getByLabelText(/13\. dönem/))
    expect(within(preview).getAllByRole('row')).toHaveLength(14)

    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(
      await screen.findByText(/2027 mali yılı oluşturuldu; 13 dönem açıldı/),
    ).toBeInTheDocument()
    const generated = screen.getByRole('table', { name: 'Oluşturulan dönemler' })
    expect(within(generated).getAllByText('Açık')).toHaveLength(13)
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/fiscal-years')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(post?.body).toMatchObject({
      code: '2027',
      start_date: '2027-01-01',
      end_date: '2027-12-31',
      adjustment_period: true,
    })
  })

  it('rejects an overlapping range before calling the API', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/fiscal-years?new=1')
    const dialog = await screen.findByRole('dialog', { name: 'Yeni mali yıl' })
    const code = within(dialog).getByLabelText(/^Yıl kodu/)
    await user.clear(code)
    await user.type(code, '2026')
    const start = within(dialog).getByLabelText(/^Başlangıç/)
    await user.clear(start)
    await user.type(start, '01.06.2026')
    await user.tab()
    expect(
      await within(dialog).findAllByText('Tarih aralığı 2026 mali yılı ile çakışıyor.'),
    ).not.toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(db.calls.filter((c) => c.method === 'POST')).toHaveLength(0)
  })

  it('closes a year after the acknowledgement and explains the procedure without a preview', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/fiscal-years')
    await screen.findByText('2026 hesap dönemi')
    await user.click(screen.getByRole('button', { name: 'Yılı kapat' }))
    const dialog = await screen.findByRole('dialog', { name: '2026 mali yılı kapatılsın mı?' })
    expect(await within(dialog).findByText(/Sunucu önizleme sağlamıyor/)).toBeInTheDocument()
    expect(within(dialog).getByText(/690 Dönem Kârı/)).toBeInTheDocument()
    expect(await within(dialog).findByText(/Kapatılmamış dönem sayısı: 12/)).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Yılı kapat' })
    expect(confirm).toBeDisabled()
    await user.click(within(dialog).getByLabelText(/anladım/))
    await user.click(confirm)
    await waitFor(() => expect(db.years.find((y) => y.id === YEAR_2026)?.status).toBe('closed'))
    const close = db.calls.find((c) => c.path === `/fiscal-years/${YEAR_2026}/close`)
    expect(close?.body).toEqual({ version: 1 })
    expect(close?.headers.get('Idempotency-Key')).toBeTruthy()
  })

  it('asks for a new confirmation when the year changed elsewhere while the dialog was open', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    const { queryClient } = renderAccounting('/accounting/fiscal-years')
    await screen.findByText('2026 hesap dönemi')
    await user.click(screen.getByRole('button', { name: 'Yılı kapat' }))
    const dialog = await screen.findByRole('dialog', { name: '2026 mali yılı kapatılsın mı?' })
    await user.click(within(dialog).getByLabelText(/anladım/))
    const y = db.years.find((x) => x.id === YEAR_2026)
    if (y) {
      y.version = 3
      y.name = '2026 (güncel)'
    }
    await queryClient.invalidateQueries()
    expect(await within(dialog).findByText('Mali yıl başka bir yerde değişti')).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Yılı kapat' })
    expect(confirm).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Güncel hâli kullan' }))
    // The acknowledgement must be given again for the new version.
    expect(within(dialog).getByLabelText(/anladım/)).not.toBeChecked()
    expect(confirm).toBeDisabled()
    await user.click(within(dialog).getByLabelText(/anladım/))
    await user.click(confirm)
    await waitFor(() => expect(y?.status).toBe('closed'))
    const closes = db.calls.filter((c) => c.path === `/fiscal-years/${YEAR_2026}/close`)
    expect(closes.map((c) => c.body)).toEqual([{ version: 3 }])
  })

  it('shows the closing preview when the API provides one', async () => {
    setupAccounting({
      db: {
        preview: {
          result: '125000.0000',
          result_side: 'credit',
          result_account_code: '590',
          entries: [
            {
              entry_type: 'closing',
              description: '6xx kapanışı',
              entry_date: '2026-12-31',
              line_count: 14,
              total_debit: '900000.0000',
              total_credit: '900000.0000',
            },
          ],
          warnings: ['2025 mali yılı hâlâ açık.'],
        },
      },
    })
    const user = userEvent.setup()
    renderAccounting('/accounting/fiscal-years')
    await screen.findByText('2026 hesap dönemi')
    await user.click(screen.getByRole('button', { name: 'Yılı kapat' }))
    const dialog = await screen.findByRole('dialog')
    expect(
      await within(dialog).findByText('Dönem sonucu: 125.000,00 (Alacak) → 590'),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('900.000,00')).toBeInTheDocument()
    expect(within(dialog).getByText('2025 mali yılı hâlâ açık.')).toBeInTheDocument()
  })

  it('reopens a closed year only with a reason', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/fiscal-years')
    await screen.findByText('2025 hesap dönemi')
    await user.click(screen.getByRole('button', { name: 'Yeniden aç' }))
    const dialog = await screen.findByRole('dialog', { name: '2025 mali yılı yeniden açılsın mı?' })
    await user.click(within(dialog).getByRole('button', { name: 'Yılı yeniden aç' }))
    expect(within(dialog).getByText('Gerekçe en az 5 karakter olmalıdır.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Gerekçe/), 'Denetim düzeltmesi')
    await user.click(within(dialog).getByRole('button', { name: 'Yılı yeniden aç' }))
    await waitFor(() => expect(db.years.find((y) => y.id === YEAR_2025)?.status).toBe('open'))
    expect(db.calls.find((c) => c.path === `/fiscal-years/${YEAR_2025}/reopen`)?.body).toEqual({
      version: 1,
      reason: 'Denetim düzeltmesi',
    })
  })

  it('hides year actions without the permissions', async () => {
    setupAccounting({ permissions: [ACC_PERMISSIONS.periods.view] })
    renderAccounting('/accounting/fiscal-years')
    await screen.findByText('2026 hesap dönemi')
    expect(screen.queryByRole('button', { name: 'Yeni mali yıl' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yılı kapat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yeniden aç' })).not.toBeInTheDocument()
  })
})
