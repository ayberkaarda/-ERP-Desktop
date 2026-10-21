import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useCompanyStore } from '@/stores/company'
import { accKeysFor, useAccKeys } from './keys'
import { useFiscalYears } from './queries'
import type { FiscalYear } from './types'

const A = 'company-a'
const B = 'company-b'

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => useCompanyStore.setState({ activeCompanyId: null }))

describe('accounting query keys', () => {
  it('start with the company id, so two companies never share a key', () => {
    expect(accKeysFor(A).fiscalYears()).toEqual(['accounting', A, 'fiscal-years'])
    expect(accKeysFor(A).account('x')).not.toEqual(accKeysFor(B).account('x'))
    expect(accKeysFor(A).periods().slice(0, 2)).toEqual(accKeysFor(A).all)
  })

  it('follow a company switch and never serve the other company cached data', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const yearOfA = [{ id: 'fy-a', code: '2026' }] as FiscalYear[]
    client.setQueryData(accKeysFor(A).fiscalYears(), yearOfA)
    useCompanyStore.setState({ activeCompanyId: A })

    const { result } = renderHook(() => ({ keys: useAccKeys(), years: useFiscalYears(false) }), {
      wrapper: wrapper(client),
    })
    expect(result.current.years.data).toEqual(yearOfA)

    act(() => {
      useCompanyStore.setState({ activeCompanyId: B })
    })
    expect(result.current.keys.fiscalYears()).toEqual(['accounting', B, 'fiscal-years'])
    expect(result.current.years.data).toBeUndefined()
  })
})
