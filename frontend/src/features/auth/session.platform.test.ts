import { http, HttpResponse } from 'msw'
import { platform, PlatformCancelledError, type PlatformSession } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { setupFea, signIn } from '@/test/handlers/feaRender'
import { server } from '@/test/msw/server'
import { logout } from './session'
import { signOut, useSignOutStore } from './signOut'

function runtimeSession(logoutImpl: () => Promise<void>): PlatformSession {
  return { logout: vi.fn(logoutImpl), switchCompany: vi.fn(), passwordChange: 'external' }
}

let serverLogouts = 0

beforeEach(() => {
  serverLogouts = 0
  const db = setupFea()
  signIn(db)
  server.use(
    http.post('*/api/v1/auth/logout', () => {
      serverLogouts += 1
      return new HttpResponse(null, { status: 204 })
    }),
  )
})

afterEach(() => {
  delete platform.session
})

describe('logout through a runtime session', () => {
  it('uses the web logout endpoint when the runtime has no session', async () => {
    await logout()
    expect(serverLogouts).toBe(1)
    expect(useAuthStore.getState().status).toBe('anonymous')
  })

  it('asks the runtime first, then clears stores, without the web endpoint', async () => {
    const seen: string[] = []
    platform.session = runtimeSession(() => {
      seen.push(`runtime:${useAuthStore.getState().status}`)
      return Promise.resolve()
    })
    const disconnect = vi.spyOn(platform.realtime, 'disconnect')
    await logout()
    expect(seen).toEqual(['runtime:authenticated'])
    expect(serverLogouts).toBe(0)
    expect(useAuthStore.getState().status).toBe('anonymous')
    expect(useCompanyStore.getState().companies).toEqual([])
    expect(disconnect).toHaveBeenCalled()
  })

  it('keeps the session when the runtime refuses, so the caller can retry', async () => {
    platform.session = runtimeSession(() => Promise.reject(new Error('pending work')))
    await expect(logout()).rejects.toThrow('pending work')
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(serverLogouts).toBe(0)
  })

  it('signOut navigates to login only after the runtime confirmed', async () => {
    const order: string[] = []
    platform.session = runtimeSession(() => {
      order.push('runtime')
      return Promise.resolve()
    })
    const ok = await signOut((to) => order.push(`navigate:${to}`))
    expect(ok).toBe(true)
    expect(order).toEqual(['runtime', 'navigate:/login'])
    expect(useSignOutStore.getState()).toMatchObject({ pending: false, failed: false })
  })

  it('signOut stays silent and keeps the session when the user cancels in the runtime', async () => {
    platform.session = runtimeSession(() => Promise.reject(new PlatformCancelledError()))
    const navigate = vi.fn()
    expect(await signOut(navigate)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(useSignOutStore.getState()).toMatchObject({ pending: false, failed: false })
    expect(useAuthStore.getState().status).toBe('authenticated')
    expect(serverLogouts).toBe(0)
  })

  it('signOut reports a refused runtime logout as failed', async () => {
    platform.session = runtimeSession(() => Promise.reject(new Error('no')))
    const navigate = vi.fn()
    expect(await signOut(navigate)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
    expect(useSignOutStore.getState().failed).toBe(true)
  })
})
