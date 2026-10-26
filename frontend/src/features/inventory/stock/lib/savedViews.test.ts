import { act, renderHook } from '@testing-library/react'
import { useAuthStore, type SessionUser } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { useSavedViews, viewStorageKey } from './savedViews'

const user = (id: string): SessionUser => ({
  id,
  name: id,
  email: `${id}@keystone.test`,
  locale: 'tr',
  isSuperAdmin: false,
  mustChangePassword: false,
  twoFactorEnabled: false,
})

describe('saved views scope', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAuthStore.setState({ status: 'authenticated', user: user('u1'), permissions: {} })
    useCompanyStore.setState({ activeCompanyId: 'c1' })
  })

  it('keeps views per user and company and reloads on a switch', () => {
    const { result } = renderHook(() => useSavedViews('stock-status'))
    act(() => result.current.save({ name: 'Mine', values: { q: 'cıvata' } }))
    expect(result.current.list.map((v) => v.name)).toEqual(['Mine'])
    expect(window.localStorage.getItem(viewStorageKey('stock-status', 'u1', 'c1') ?? '')).toContain(
      'Mine',
    )

    act(() => {
      void useCompanyStore.setState({ activeCompanyId: 'c2' })
    })
    expect(result.current.list).toEqual([])

    act(() => useAuthStore.setState({ user: user('u2') }))
    act(() => {
      void useCompanyStore.setState({ activeCompanyId: 'c1' })
    })
    expect(result.current.list).toEqual([])
    act(() => result.current.save({ name: 'Theirs', values: {} }))

    act(() => useAuthStore.setState({ user: user('u1') }))
    expect(result.current.list.map((v) => v.name)).toEqual(['Mine'])
  })

  it('keeps nothing in storage without a signed-in user', () => {
    useAuthStore.setState({ status: 'anonymous', user: null })
    const { result } = renderHook(() => useSavedViews('stock-status'))
    act(() => result.current.save({ name: 'Temp', values: {} }))
    expect(result.current.list.map((v) => v.name)).toEqual(['Temp'])
    const keys = Array.from({ length: window.localStorage.length }, (_, i) =>
      window.localStorage.key(i),
    )
    expect(keys.filter((k) => k?.startsWith('keystone.inventory.views.'))).toEqual([])
    expect(viewStorageKey('x', null, 'c1')).toBeNull()
  })
})
