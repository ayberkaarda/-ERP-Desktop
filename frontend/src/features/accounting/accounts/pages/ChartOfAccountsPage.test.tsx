import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACC_KASA_TL, ACC_RECEIVABLES } from '@/test/handlers/accounting1'
import { ACC_PERMISSIONS } from '../../shared/permissions'
import { renderAccounting, setupAccounting } from '../../shared/testing'
// Loaded up front so the lazy route resolves without a chunk delay.
import './ChartOfAccountsPage'

const tree = () => screen.findByRole('tree', { name: 'Hesap planı' })

describe('ChartOfAccountsPage', () => {
  it('shows the chart as a tree that expands from the keyboard and filters by code or name', async () => {
    setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/accounts')

    const t = await tree()
    expect(within(t).getByRole('treeitem', { name: /^100, Kasa/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(within(t).queryByRole('treeitem', { name: /^100\.01/ })).not.toBeInTheDocument()

    t.focus()
    await user.keyboard('{ArrowRight}')
    expect(
      await within(t).findByRole('treeitem', { name: /^100\.01, Merkez Kasa TL/ }),
    ).toBeInTheDocument()
    await user.keyboard('{ArrowDown}')
    expect(t).toHaveAttribute(
      'aria-activedescendant',
      within(t).getByRole('treeitem', { name: /^100\.01/ }).id,
    )

    await user.type(screen.getByLabelText('Ara'), 'merkez')
    await waitFor(() =>
      expect(
        within(t)
          .getAllByRole('treeitem')
          .map((el) => el.getAttribute('aria-label')),
      ).toEqual([expect.stringMatching(/^100, Kasa/), expect.stringMatching(/^100\.01/)]),
    )
  })

  it('opens the detail panel with the balance as of a date', async () => {
    setupAccounting()
    const user = userEvent.setup()
    renderAccounting(`/accounting/accounts?account=${ACC_KASA_TL}`)
    const panel = await screen.findByRole('complementary', { name: '100.01 hesap ayrıntısı' })
    expect(await within(panel).findByText('12.499,50')).toBeInTheDocument()
    expect(within(panel).getAllByText('Borç')).toHaveLength(2)
    await user.click(within(panel).getByRole('button', { name: 'Ayrıntıyı kapat' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })

  it('creates a sub-account with a payload-bound Idempotency-Key and shows integrity messages', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/accounts')
    const t = await tree()
    await user.click(within(t).getByRole('button', { name: '120 altına hesap ekle' }))
    const dialog = await screen.findByRole('dialog')
    // The parent becomes a header account once it has a child.
    expect(within(dialog).getByText(/120 şu an hareket görüyor/)).toBeInTheDocument()

    const code = within(dialog).getByLabelText(/^Hesap kodu/)
    expect(code).toHaveValue('120')
    // Client-side uniqueness check before the request.
    await user.type(within(dialog).getByLabelText(/^Hesap adı/), 'Yurt içi alıcılar')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(
      await within(dialog).findAllByText('Bu kod zaten kullanılıyor (Alıcılar).'),
    ).not.toHaveLength(0)
    expect(db.calls.filter((c) => c.method === 'POST')).toHaveLength(0)

    await user.clear(code)
    await user.type(code, '120.01')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/accounts')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(post?.body).toMatchObject({
      code: '120.01',
      parent_id: ACC_RECEIVABLES,
      type: 'asset',
      normal_balance: 'debit',
      is_postable: true,
      tdhp_group: 1,
    })
    expect(db.accounts.find((a) => a.id === ACC_RECEIVABLES)?.is_postable).toBe(false)
  })

  it('maps server field errors and keeps the key for an identical retry', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/accounts')
    await tree()
    await user.click(screen.getByRole('button', { name: 'Yeni hesap' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Hesap kodu/), '150')
    await user.type(within(dialog).getByLabelText(/^Hesap adı/), 'İlk madde')
    // The parent has postings: the server refuses (field error on parent_id).
    await user.click(within(dialog).getByRole('combobox', { name: /Üst hesap/ }))
    await user.keyboard('100.01')
    await user.click(await screen.findByRole('option', { name: /100\.01 · Merkez Kasa TL/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(
      await within(dialog).findAllByText('Hareket görmüş hesabın altına hesap açılamaz.'),
    ).not.toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() =>
      expect(db.calls.filter((c) => c.method === 'POST' && c.path === '/accounts')).toHaveLength(2),
    )
    const [first, second] = db.calls.filter((c) => c.method === 'POST' && c.path === '/accounts')
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'))
  })

  it('blocks making a header account postable and offers a reload on a version conflict', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/accounts')
    const t = await tree()
    await user.click(within(t).getByRole('button', { name: '102 hesabını düzenle' }))
    const dialog = await screen.findByRole('dialog')
    const bank = db.accounts.find((a) => a.code === '102')
    if (bank) {
      bank.version = 4
      bank.name = 'Bankalar (güncel)'
    }
    const name = within(dialog).getByLabelText(/^Hesap adı/)
    await user.clear(name)
    await user.type(name, 'Banka hesapları')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(
      await within(dialog).findByText('Kayıt başka biri tarafından değiştirildi'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Son hâli yükle' }))
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^Hesap adı/)).toHaveValue('Bankalar (güncel)'),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(within(t).getByRole('button', { name: '100 hesabını düzenle' }))
    const kasa = await screen.findByRole('dialog')
    await user.click(within(kasa).getByLabelText(/Hareket görebilir/))
    expect(
      within(kasa).getAllByText('Alt hesabı olan hesap hareket göremez (1 alt hesap var).'),
    ).not.toHaveLength(0)
  })

  it('hides create and import without the manage permission', async () => {
    setupAccounting({ permissions: [ACC_PERMISSIONS.accounts.view] })
    renderAccounting('/accounting/accounts')
    const t = await tree()
    expect(screen.queryByRole('button', { name: 'Yeni hesap' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'İçe aktar' })).not.toBeInTheDocument()
    expect(within(t).queryByRole('button', { name: /düzenle/ })).not.toBeInTheDocument()
  })

  it('lists accounts flat through the server list with filters', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    renderAccounting('/accounting/accounts')
    await tree()
    await user.click(screen.getByRole('button', { name: 'Liste' }))
    const grid = await screen.findByRole('grid', { name: 'Hesap planı' })
    expect(await within(grid).findByText('Yurt Dışı Satışlar')).toBeInTheDocument()
    expect(
      db.calls.some((c) => c.path === '/accounts' && c.url.searchParams.get('sort') === 'code'),
    ).toBe(true)
  })

  it('runs an import dry run, shows failed rows, downloads the report and imports a clean file', async () => {
    const db = setupAccounting()
    const user = userEvent.setup()
    const created: Blob[] = []
    const createObjectURL = vi.fn((b: Blob) => {
      created.push(b)
      return 'blob:report'
    })
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    renderAccounting('/accounting/accounts')
    await tree()
    await user.click(screen.getByRole('button', { name: 'İçe aktar' }))
    const dialog = await screen.findByRole('dialog', { name: 'Hesap planı içe aktarma' })
    const bad = new File(['code,name,type\n150,İlk Madde,asset\n,Adsız,asset\n'], 'plan.csv', {
      type: 'text/csv',
    })
    await user.upload(within(dialog).getByLabelText('Dosya'), bad)
    await user.click(within(dialog).getByRole('button', { name: 'Deneme çalıştır' }))
    expect(await within(dialog).findByText('Hesap kodu zorunludur.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'İçe aktar' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Hata raporunu indir' }))
    expect(click).toHaveBeenCalled()
    const report = await created[0]?.text()
    expect(report).toContain('Hesap kodu zorunludur.')

    await user.click(within(dialog).getByRole('button', { name: 'Geri' }))
    const good = new File(['code,name,type\n150,İlk Madde,asset\n'], 'plan2.csv', {
      type: 'text/csv',
    })
    await user.upload(within(dialog).getByLabelText('Dosya'), good)
    await user.click(within(dialog).getByRole('button', { name: 'Deneme çalıştır' }))
    await user.click(await within(dialog).findByRole('button', { name: 'İçe aktar' }))
    expect(await within(dialog).findByText(/1 yeni hesap eklendi/)).toBeInTheDocument()
    expect(db.accounts.some((a) => a.code === '150')).toBe(true)
    const imports = db.calls.filter((c) => c.path === '/accounts/import')
    expect(new Set(imports.map((c) => c.headers.get('Idempotency-Key'))).size).toBe(3)
    click.mockRestore()
  })
})
