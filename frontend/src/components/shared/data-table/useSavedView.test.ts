import { act, renderHook } from '@testing-library/react'
import { sanitizeView, useSavedView } from './useSavedView'

describe('useSavedView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('persists per resource and restores on mount', () => {
    const { result, unmount } = renderHook(() => useSavedView('sales.invoices'))
    act(() => result.current.update({ density: 'compact', columnVisibility: { note: false } }))
    expect(JSON.parse(localStorage.getItem('keystone.view.sales.invoices') ?? '{}')).toMatchObject({
      density: 'compact',
      columnVisibility: { note: false },
    })
    unmount()
    const again = renderHook(() => useSavedView('sales.invoices'))
    expect(again.result.current.view.density).toBe('compact')
    act(() => again.result.current.reset())
    expect(localStorage.getItem('keystone.view.sales.invoices')).toBeNull()
    expect(again.result.current.view.density).toBe('comfortable')
  })

  it('keeps working when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { result } = renderHook(() => useSavedView('x'))
    expect(result.current.view.density).toBe('comfortable')
    act(() => result.current.update({ density: 'compact' }))
    expect(result.current.view.density).toBe('compact')
  })

  it('drops malformed stored data', () => {
    expect(
      sanitizeView({
        columnVisibility: { a: 'yes' },
        columnSizing: { a: 120 },
        density: 'tiny',
        perPage: 50,
        sort: [{ id: 1 }],
      }),
    ).toEqual({
      columnVisibility: {},
      columnSizing: { a: 120 },
      density: 'comfortable',
      perPage: 50,
    })
    localStorage.setItem('keystone.view.bad', '{not json')
    const { result } = renderHook(() => useSavedView('bad'))
    expect(result.current.view.columnVisibility).toEqual({})
  })
})
