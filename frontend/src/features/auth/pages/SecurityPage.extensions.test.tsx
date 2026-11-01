import { screen } from '@testing-library/react'
import type { AppExtensions } from '@/app/extensions'
import { platform, type PlatformSession } from '@/platform'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { SecurityPage } from './SecurityPage'

const ext = vi.hoisted((): { value: AppExtensions } => ({
  value: { routes: [], publicRoutes: [] },
}))
vi.mock('@/app/extensions', () => ({
  get appExtensions() {
    return ext.value
  },
}))

function SecurityExtras() {
  return <section aria-label="Cihazlar">devices</section>
}

function session(passwordChange: PlatformSession['passwordChange']): PlatformSession {
  return { logout: vi.fn(), switchCompany: vi.fn(), passwordChange }
}

function renderSecurity() {
  const db = setupFea()
  signIn(db)
  renderRoutes([{ path: '/profile/security', element: <SecurityPage /> }], '/profile/security')
}

const passwordForm = () => screen.queryByRole('button', { name: 'Parolayı güncelle' })
const twoFactorStart = () => screen.queryByRole('button', { name: 'Kurulumu başlat' })
const sessionsTitle = () => screen.queryByText('Açık oturumlar')

afterEach(() => {
  ext.value = { routes: [], publicRoutes: [] }
  delete platform.session
})

describe('SecurityPage extension points', () => {
  it('shows the web cards and nothing else without extensions', async () => {
    renderSecurity()
    expect(await screen.findByRole('heading', { name: 'Güvenlik' })).toBeInTheDocument()
    expect(passwordForm()).toBeInTheDocument()
    expect(twoFactorStart()).toBeInTheDocument()
    expect(await screen.findByText('Açık oturumlar')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Cihazlar' })).not.toBeInTheDocument()
  })

  it('keeps the web cards and appends SecurityExtras for an inline session', async () => {
    platform.session = session('inline')
    ext.value = { routes: [], publicRoutes: [], SecurityExtras }
    renderSecurity()
    expect(await screen.findByRole('region', { name: 'Cihazlar' })).toBeInTheDocument()
    expect(passwordForm()).toBeInTheDocument()
    expect(twoFactorStart()).toBeInTheDocument()
  })

  it('hides password, two-factor and session cards when passwords are managed externally', async () => {
    platform.session = session('external')
    ext.value = { routes: [], publicRoutes: [], SecurityExtras }
    renderSecurity()
    expect(await screen.findByRole('region', { name: 'Cihazlar' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Güvenlik' })).toBeInTheDocument()
    expect(passwordForm()).not.toBeInTheDocument()
    expect(twoFactorStart()).not.toBeInTheDocument()
    expect(sessionsTitle()).not.toBeInTheDocument()
  })
})
