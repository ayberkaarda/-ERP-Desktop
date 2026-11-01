import { cleanup, screen, within } from '@testing-library/react'
import type { AppExtensions } from '@/app/extensions'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { AppShell } from './AppShell'

const ext = vi.hoisted((): { value: AppExtensions } => ({
  value: { routes: [], publicRoutes: [] },
}))
vi.mock('@/app/extensions', () => ({
  get appExtensions() {
    return ext.value
  },
}))

function HeaderExtras() {
  return <button type="button">Senkron durumu</button>
}

async function headerButtons(): Promise<string[]> {
  const db = setupFea()
  signIn(db)
  renderRoutes([{ path: '/', element: <AppShell />, children: [{ index: true, element: null }] }])
  const header = (await screen.findByRole('button', { name: 'Kullanıcı menüsü' })).closest('header')
  if (!header) throw new Error('header missing')
  return within(header)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label') ?? b.textContent.trim())
}

afterEach(() => {
  ext.value = { routes: [], publicRoutes: [] }
})

describe('AppShell header extension', () => {
  it('renders the web header unchanged without extensions', async () => {
    const names = await headerButtons()
    expect(names).not.toContain('Senkron durumu')
    expect(names).toEqual(expect.arrayContaining(['Komut paletini aç', 'Kullanıcı menüsü']))
    expect(names.some((n) => n.startsWith('Bildirimler'))).toBe(true)
  })

  it('puts HeaderExtras next to the connectivity badge, before notifications', async () => {
    const base = await headerButtons()
    ext.value = { routes: [], publicRoutes: [], HeaderExtras }
    cleanup()
    const names = await headerButtons()
    const at = names.indexOf('Senkron durumu')
    expect(at).toBeGreaterThan(-1)
    expect(names[at + 1]).toMatch(/^Bildirimler/)
    expect(names.filter((n) => n !== 'Senkron durumu')).toEqual(base)
  })
})
