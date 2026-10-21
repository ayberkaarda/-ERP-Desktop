import { act, renderHook } from '@testing-library/react'
import { useAuthStore, type SessionUser } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { presetStorageKey, usePresets } from './presets'

const user = (id: string) => ({ id, isSuperAdmin: false }) as SessionUser

describe('report and list presets', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAuthStore.setState({ user: user('u1') })
    useCompanyStore.setState({ activeCompanyId: 'c1' })
  })

  it('stores presets per user and company, in memory only without either', () => {
    expect(presetStorageKey('inv.reports', 'u1', 'c1')).toBe('keystone.presets.u1.c1.inv.reports')
    expect(presetStorageKey('inv.reports', null, 'c1')).toBeNull()
    expect(presetStorageKey('inv.reports', 'u1', null)).toBeNull()
  })

  it('reloads when the user or company changes and never shows another scope', () => {
    const { result } = renderHook(() => usePresets('inv.reports'))
    act(() => result.current.save({ name: 'Ana depo', params: { warehouse_id: 'w1' } }))
    expect(window.localStorage.getItem('keystone.presets.u1.c1.inv.reports')).toContain('Ana depo')

    act(() => {
      useCompanyStore.setState({ activeCompanyId: 'c2' })
    })
    expect(result.current.list).toEqual([])
    act(() => result.current.save({ name: 'Şube', params: {} }))
    expect(window.localStorage.getItem('keystone.presets.u1.c2.inv.reports')).toContain('Şube')

    act(() => {
      useAuthStore.setState({ user: user('u2') })
    })
    expect(result.current.list).toEqual([])

    act(() => {
      useAuthStore.setState({ user: user('u1') })
      useCompanyStore.setState({ activeCompanyId: 'c1' })
    })
    expect(result.current.list.map((p) => p.name)).toEqual(['Ana depo'])
  })

  it('keeps presets in memory when nobody is signed in', () => {
    useAuthStore.setState({ user: null })
    const { result } = renderHook(() => usePresets('inv.reports'))
    act(() => result.current.save({ name: 'Geçici', params: {} }))
    expect(result.current.list.map((p) => p.name)).toEqual(['Geçici'])
    const keys = Array.from({ length: window.localStorage.length }, (_, i) =>
      window.localStorage.key(i),
    )
    expect(keys.filter((k) => k?.startsWith('keystone.presets.'))).toEqual([])
  })
})
