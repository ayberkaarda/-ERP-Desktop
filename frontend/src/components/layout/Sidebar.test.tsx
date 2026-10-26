import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuthStore, type SessionUser } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { useUiStore } from '@/stores/ui'
import { Sidebar } from './Sidebar'

const user: SessionUser = {
  id: 'u1',
  name: 'Deniz',
  email: 'deniz@keystone.test',
  locale: 'tr',
  isSuperAdmin: false,
  mustChangePassword: false,
  twoFactorEnabled: false,
}

function signInWith(permissions: string[], isSuperAdmin = false) {
  useAuthStore.getState().setSession({ ...user, isSuperAdmin }, { c1: permissions })
  useCompanyStore.setState({ activeCompanyId: 'c1' })
}

function renderSidebar(path = '/', variant: 'rail' | 'drawer' = 'rail', onNavigate?: () => void) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar variant={variant} onNavigate={onNavigate} />
      </MemoryRouter>
    </TooltipProvider>,
  )
}

afterEach(() => {
  useAuthStore.getState().clear()
  useCompanyStore.setState({ activeCompanyId: null })
  useUiStore.setState({ sidebarCollapsed: false })
})

describe('Sidebar', () => {
  it.each([false, true])('shows seven live treasury links for grants or admin (%s)', (admin) => {
    const areas = [
      'accounts',
      'payments',
      'transfers',
      'instruments',
      'banking',
      'plans',
      'reports',
    ]
    signInWith(admin ? [] : areas.map((area) => `treasury.${area}.view`), admin)
    renderSidebar('/treasury/accounts')
    for (const area of areas) {
      expect(
        screen
          .getAllByRole('link')
          .find((link) => link.getAttribute('href') === `/treasury/${area}`),
      ).toBeDefined()
    }
    const main = screen.getByRole('group', { name: 'Ana menü' })
    expect(within(main).queryByText('Finans')).not.toBeInTheDocument()
  })
  it('hides unauthorized treasury links', () => {
    signInWith(['treasury.accounts.view'])
    renderSidebar()
    expect(
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('href')?.startsWith('/treasury/'))
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/treasury/accounts'])
  })
  it('shows only purchasing entries granted by the active company', () => {
    signInWith(['purchasing.receipts.view', 'purchasing.reports.view'])
    renderSidebar('/purchasing/receipts')

    const purchasing = screen.getByRole('group', { name: 'Satın alma' })
    expect(
      within(screen.getByRole('group', { name: 'Ana menü' })).queryByText('Satın alma'),
    ).not.toBeInTheDocument()
    expect(within(purchasing).getByRole('link', { name: 'Mal kabulleri' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(purchasing).getByRole('link', { name: 'Satın alma raporları' })).toHaveAttribute(
      'href',
      '/purchasing/reports',
    )
    expect(
      within(purchasing).queryByRole('link', { name: 'Tedarikçi faturaları' }),
    ).not.toBeInTheDocument()
    expect(
      within(purchasing).queryByRole('link', { name: 'Satın alma siparişleri' }),
    ).not.toBeInTheDocument()
  })

  it('shows only the entries the active company grants and drops empty sections', () => {
    signInWith(['parties.view', 'items.view'])
    renderSidebar()

    const master = screen.getByRole('group', { name: 'Ana veriler' })
    expect(within(master).getByRole('link', { name: 'Cariler' })).toHaveAttribute(
      'href',
      '/parties',
    )
    expect(within(master).getByRole('link', { name: 'Stok kartları' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fiyat listeleri' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Referans' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sistem durumu' })).toBeInTheDocument()
  })

  it('shows the sales section entries the company grants', () => {
    signInWith(['sales.quotes.view', 'sales.invoices.view'])
    renderSidebar('/sales/invoices')

    const sales = screen.getByRole('group', { name: 'Satış' })
    expect(within(sales).getByRole('link', { name: 'Teklifler' })).toHaveAttribute(
      'href',
      '/sales/quotes',
    )
    expect(within(sales).getByRole('link', { name: 'Faturalar' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    for (const name of ['Siparişler', 'İrsaliyeler', 'İadeler', 'Satış raporları']) {
      expect(within(sales).queryByRole('link', { name })).not.toBeInTheDocument()
    }
  })

  it('shows sales reports, deliveries and returns to their own permissions only', () => {
    signInWith(['sales.deliveries.view', 'sales.returns.view', 'sales.reports.view'])
    renderSidebar()

    const sales = screen.getByRole('group', { name: 'Satış' })
    expect(within(sales).getByRole('link', { name: 'İrsaliyeler' })).toHaveAttribute(
      'href',
      '/sales/deliveries',
    )
    expect(within(sales).getByRole('link', { name: 'İadeler' })).toBeInTheDocument()
    expect(within(sales).getByRole('link', { name: 'Satış raporları' })).toBeInTheDocument()
    expect(within(sales).queryByRole('link', { name: 'Teklifler' })).not.toBeInTheDocument()
  })

  it('hides the sales section without any sales permission', () => {
    signInWith(['parties.view'])
    renderSidebar()

    expect(screen.queryByRole('group', { name: 'Satış' })).not.toBeInTheDocument()
  })

  it('shows the inventory section entries the company grants', () => {
    signInWith(['inventory.stock.view'])
    renderSidebar()

    const inventory = screen.getByRole('group', { name: 'Stok' })
    expect(within(inventory).getByRole('link', { name: 'Stok durumu' })).toHaveAttribute(
      'href',
      '/inventory/stock',
    )
    for (const name of ['Stok hareketleri', 'Lotlar', 'Seri numaraları', 'Rezervasyonlar']) {
      expect(within(inventory).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(within(inventory).queryByRole('link', { name: 'Stok fişleri' })).not.toBeInTheDocument()
    expect(within(inventory).queryByRole('link', { name: 'Sayımlar' })).not.toBeInTheDocument()
  })

  it('opens stock documents, counts and reports with their own permissions', () => {
    signInWith(['inventory.documents.view', 'inventory.reports.view'])
    renderSidebar()

    const inventory = screen.getByRole('group', { name: 'Stok' })
    expect(within(inventory).getByRole('link', { name: 'Stok fişleri' })).toHaveAttribute(
      'href',
      '/inventory/documents',
    )
    expect(within(inventory).getByRole('link', { name: 'Sayımlar' })).toBeInTheDocument()
    expect(within(inventory).getByRole('link', { name: 'Stok raporları' })).toBeInTheDocument()
    expect(within(inventory).queryByRole('link', { name: 'Stok durumu' })).not.toBeInTheDocument()
  })

  it('shows the accounting section entries the company grants', () => {
    signInWith(['accounting.entries.view', 'accounting.reports.view'])
    renderSidebar()

    const accounting = screen.getByRole('group', { name: 'Muhasebe' })
    expect(within(accounting).getByRole('link', { name: 'Yevmiye fişleri' })).toHaveAttribute(
      'href',
      '/accounting/journal-entries',
    )
    for (const name of ['Mizan', 'Büyük defter', 'Yevmiye defteri']) {
      expect(within(accounting).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(within(accounting).queryByRole('link', { name: 'Hesap planı' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Hesap belirleme' })).not.toBeInTheDocument()
  })

  it('shows read-or-manage entries to holders of the manage permission alone', () => {
    signInWith([
      'units.manage',
      'item_categories.manage',
      'discount_rules.manage',
      'accounting.accounts.manage',
      'accounting.periods.close',
    ])
    renderSidebar()

    const master = screen.getByRole('group', { name: 'Ana veriler' })
    for (const name of ['Birimler', 'Kategoriler', 'İskonto kuralları']) {
      expect(within(master).getByRole('link', { name })).toBeInTheDocument()
    }
    const accounting = screen.getByRole('group', { name: 'Muhasebe' })
    expect(within(accounting).getByRole('link', { name: 'Hesap planı' })).toBeInTheDocument()
    expect(within(accounting).getByRole('link', { name: 'Muhasebe dönemleri' })).toBeInTheDocument()
    // Fiscal years accept periods.view or periods.manage, not periods.close.
    expect(within(accounting).queryByRole('link', { name: 'Mali yıllar' })).not.toBeInTheDocument()
  })

  it('lists every accounting entry for a super admin', () => {
    signInWith([], true)
    renderSidebar()

    const accounting = screen.getByRole('group', { name: 'Muhasebe' })
    expect(within(accounting).getAllByRole('link')).toHaveLength(8)
    expect(within(accounting).getByRole('link', { name: 'Hesap planı' })).toHaveAttribute(
      'href',
      '/accounting/accounts',
    )
  })

  it('lists every master data and reference entry for a super admin', () => {
    signInWith([], true)
    renderSidebar()

    const reference = screen.getByRole('group', { name: 'Referans' })
    for (const name of [
      'Para birimleri',
      'Döviz kurları',
      'Vergi kodları',
      'Depolar',
      'Projeler',
    ]) {
      expect(within(reference).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('link', { name: 'Fiyat hesaplama' })).toHaveAttribute(
      'href',
      '/catalog/pricing',
    )
  })

  it('marks the entry of a nested route as active, also in the collapsed rail', () => {
    signInWith([], true)
    useUiStore.setState({ sidebarCollapsed: true })
    renderSidebar('/catalog/items/42')

    expect(screen.getByRole('link', { name: 'Stok kartları' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(screen.getByRole('link', { name: 'Stok kartları' })).toHaveClass('bg-sidebar-active')
    expect(screen.getByRole('link', { name: 'Panel' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'Panel' })).not.toHaveClass('bg-sidebar-active')
  })

  it('labels icon-only entries and shows a tooltip when the rail is collapsed', async () => {
    signInWith(['tax_codes.view'])
    useUiStore.setState({ sidebarCollapsed: true })
    renderSidebar()

    const link = screen.getByRole('link', { name: 'Vergi kodları' })
    expect(link).not.toHaveTextContent('Vergi kodları')
    // The tooltip trigger must keep the link's own classes (a function className would be lost).
    expect(link).toHaveClass('h-8', 'justify-center')
    await userEvent.setup().hover(link)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Vergi kodları')
  })

  it('keeps labels in the drawer and reports navigation so the drawer can close', async () => {
    signInWith([], true)
    useUiStore.setState({ sidebarCollapsed: true })
    const onNavigate = vi.fn()
    renderSidebar('/', 'drawer', onNavigate)

    const link = screen.getByRole('link', { name: 'Cariler' })
    expect(link).toHaveTextContent('Cariler')
    await userEvent.setup().click(link)
    expect(onNavigate).toHaveBeenCalledOnce()
  })
})
