import type { RouteObject } from 'react-router'
import type { AppExtensions } from './extensions'

interface Shape {
  path?: string
  index?: boolean
  page: 'lazy' | 'component' | 'element' | 'none'
  children?: Shape[]
}

function shape(routes: RouteObject[]): Shape[] {
  return routes.map((r) => ({
    ...(r.path !== undefined ? { path: r.path } : {}),
    ...(r.index ? { index: true } : {}),
    page: r.lazy ? 'lazy' : r.Component ? 'component' : r.element ? 'element' : 'none',
    ...(r.children ? { children: shape(r.children) } : {}),
  }))
}

async function loadRoutes(extensions?: AppExtensions): Promise<RouteObject[]> {
  vi.resetModules()
  if (extensions) vi.doMock('./extensions', () => ({ appExtensions: extensions }))
  else vi.doUnmock('./extensions')
  return (await import('./router')).routes
}

/** The signed-in shell's page list (RequireAuth > AppShell > pathless error boundary). */
function shellPages(routes: RouteObject[]): RouteObject[] {
  const shell = routes.find((r) => r.path === '/')
  return shell?.children?.[0]?.children ?? []
}

const SetupPage = () => <p>setup</p>
const SyncPage = () => <p>sync</p>
const DesktopLogin = () => <p>desktop login</p>
const DesktopPasswordChange = () => <p>change on web</p>

const extended: AppExtensions = {
  routes: [{ path: 'sync', Component: SyncPage }],
  publicRoutes: [{ path: '/setup', Component: SetupPage }],
  LoginPage: DesktopLogin,
  PasswordChangePage: DesktopPasswordChange,
}

afterEach(() => {
  vi.doUnmock('./extensions')
  vi.resetModules()
})

describe('app extension points', () => {
  it('ships empty on web', async () => {
    const { appExtensions } = await import('./extensions')
    expect(appExtensions).toEqual({ routes: [], publicRoutes: [] })
  })

  it('keeps the web route tree when the extensions are empty', async () => {
    const routes = await loadRoutes()
    expect(routes.map((r) => r.path)).toEqual(['/login', '/password/change', '/'])
    const [login, password] = routes
    expect(shape(login?.children ?? [])).toEqual([{ index: true, page: 'lazy' }])
    expect(shape(password?.children ?? [])).toEqual([{ index: true, page: 'lazy' }])
    const pages = shellPages(routes)
    expect(pages[0]).toMatchObject({ index: true })
    expect(pages.at(-1)?.path).toBe('*')
    expect(pages.map((r) => r.path)).toEqual(
      expect.arrayContaining(['system/health', 'profile/security']),
    )
  })

  it('adds extension pages and overrides without changing the rest of the tree', async () => {
    const base = await loadRoutes()
    const routes = await loadRoutes(extended)

    expect(routes.map((r) => r.path)).toEqual(['/login', '/password/change', '/setup', '/'])
    expect(routes.find((r) => r.path === '/setup')?.Component).toBe(SetupPage)

    const loginPage = routes[0]?.children?.[0]
    expect(loginPage).toMatchObject({ index: true, Component: DesktopLogin })
    expect(loginPage?.lazy).toBeUndefined()
    const passwordPage = routes[1]?.children?.[0]
    expect(passwordPage).toMatchObject({ index: true, Component: DesktopPasswordChange })
    expect(passwordPage?.lazy).toBeUndefined()

    // Extension pages live inside the signed-in shell, ahead of the catch-all.
    const pages = shellPages(routes)
    expect(pages.at(-2)).toMatchObject({ path: 'sync', Component: SyncPage })
    expect(pages.at(-1)?.path).toBe('*')

    // Remove what the extensions added: the remaining tree is the web one.
    const withoutAdded = routes.filter((r) => r.path !== '/setup')
    const stripped = shape(withoutAdded).map((r) =>
      r.path === '/'
        ? {
            ...r,
            children: r.children?.map((c) => ({
              ...c,
              children: c.children?.filter((p) => p.path !== 'sync'),
            })),
          }
        : { ...r, children: r.children?.map(() => ({ index: true, page: 'lazy' as const })) },
    )
    expect(stripped).toEqual(shape(base))
  })
})
