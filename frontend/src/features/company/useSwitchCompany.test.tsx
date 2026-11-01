import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createQueryClient } from '@/lib/queryClient'
import { platform, PlatformCancelledError, type PlatformSession } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { COMPANY_A, COMPANY_B } from '@/test/handlers/fea'
import { setupFea, signIn } from '@/test/handlers/feaRender'
import { useSwitchCompany } from './useSwitchCompany'

function renderSwitch() {
  const queryClient = createQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useSwitchCompany(), { wrapper })
  return { queryClient, switchCompany: result.current }
}

function runtimeSession(switchImpl: (id: string) => Promise<void>): PlatformSession {
  return { logout: vi.fn(), switchCompany: vi.fn(switchImpl), passwordChange: 'external' }
}

beforeEach(() => {
  const db = setupFea()
  signIn(db)
  useCompanyStore.getState().setActiveCompany(COMPANY_A)
  vi.spyOn(platform.notify, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
  delete platform.session
  vi.restoreAllMocks()
})

describe('useSwitchCompany', () => {
  it('switches the local company on web (no runtime session)', async () => {
    const { switchCompany } = renderSwitch()
    await act(() => switchCompany(COMPANY_B))
    expect(useCompanyStore.getState().activeCompanyId).toBe(COMPANY_B)
  })

  it('waits for the runtime before cancelling queries and switching locally', async () => {
    const order: string[] = []
    platform.session = runtimeSession((id) => {
      order.push(`runtime:${id}:active=${useCompanyStore.getState().activeCompanyId ?? ''}`)
      return Promise.resolve()
    })
    const { queryClient, switchCompany } = renderSwitch()
    const cancel = vi.spyOn(queryClient, 'cancelQueries')
    cancel.mockImplementation(() => {
      order.push('cancel')
      return Promise.resolve()
    })
    await act(() => switchCompany(COMPANY_B))
    expect(order).toEqual([`runtime:${COMPANY_B}:active=${COMPANY_A}`, 'cancel'])
    expect(useCompanyStore.getState().activeCompanyId).toBe(COMPANY_B)
  })

  it('keeps the current company and reports when the runtime refuses', async () => {
    const error = vi.spyOn(platform.notify, 'error').mockImplementation(() => undefined)
    platform.session = runtimeSession(() => Promise.reject(new Error('pending work')))
    const { queryClient, switchCompany } = renderSwitch()
    const cancel = vi.spyOn(queryClient, 'cancelQueries')
    await act(() => switchCompany(COMPANY_B))
    expect(useCompanyStore.getState().activeCompanyId).toBe(COMPANY_A)
    expect(cancel).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('stays silent and keeps the company when the user cancels in the runtime', async () => {
    const error = vi.spyOn(platform.notify, 'error').mockImplementation(() => undefined)
    platform.session = runtimeSession(() => Promise.reject(new PlatformCancelledError()))
    const { queryClient, switchCompany } = renderSwitch()
    const cancel = vi.spyOn(queryClient, 'cancelQueries')
    await act(() => switchCompany(COMPANY_B))
    expect(useCompanyStore.getState().activeCompanyId).toBe(COMPANY_A)
    expect(cancel).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('does not call the runtime for the active or an unknown company', async () => {
    const runtimeSwitch = vi.fn(() => Promise.resolve())
    platform.session = runtimeSession(runtimeSwitch)
    const { switchCompany } = renderSwitch()
    await act(() => switchCompany(COMPANY_A))
    await act(() => switchCompany('unknown'))
    expect(runtimeSwitch).not.toHaveBeenCalled()
  })
})
