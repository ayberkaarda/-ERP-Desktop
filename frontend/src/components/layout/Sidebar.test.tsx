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
