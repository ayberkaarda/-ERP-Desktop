import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { fromSearchParams, toSearchParams, type ListQueryState } from './listQuery'
import { useListQuery, useUrlListQuery } from './useListQuery'

const defaults: ListQueryState = {
  page: 1,
  perPage: 25,
  sort: [{ id: 'number', desc: true }],
  filters: { status: 'open' },
  q: '',
}

describe('explicit empty overrides', () => {
  it('serializes cleared defaults distinctly from absent params', () => {
    const cleared: ListQueryState = { ...defaults, sort: [], filters: {} }
    const params = toSearchParams(cleared, defaults)
    expect(params.toString()).toBe('sort=&filter%5Bstatus%5D=')
    expect(fromSearchParams(params, defaults)).toEqual(cleared)
    // Absent params still mean "use the default".
    expect(fromSearchParams(new URLSearchParams(), defaults)).toEqual(defaults)
    expect(toSearchParams(defaults, defaults).toString()).toBe('')
    const extra = fromSearchParams(new URLSearchParams('filter[type]=a'), defaults)
    expect(extra.filters).toEqual({ status: 'open', type: 'a' })
  })
})

function routerWrapper(initial: string) {
  const location = { current: '' }
  function Probe({ children }: { children: ReactNode }) {
    const loc = useLocation()
    location.current = loc.search
    return children
  }
  const wrapper = ({ children }: { children: ReactNode }) => {
    const router = createMemoryRouter([{ path: '/', element: <Probe>{children}</Probe> }], {
      initialEntries: [initial],
    })
    return <RouterProvider router={router} />
  }
  return { wrapper, location }
}

describe('useUrlListQuery', () => {
  afterEach(() => localStorage.clear())

  it('rewrites only table-owned params', () => {
    const { wrapper, location } = routerWrapper('/?tab=lines&dialog=edit&page=2&filter[x]=1')
    const { result } = renderHook(() => useUrlListQuery(), { wrapper })
    expect(result.current.query.page).toBe(2)
    act(() => result.current.patch({ q: 'abc' }))
    const params = new URLSearchParams(location.current)
    expect(params.get('tab')).toBe('lines')
    expect(params.get('dialog')).toBe('edit')
    expect(params.get('q')).toBe('abc')
    expect(params.get('filter[x]')).toBe('1')
    expect(params.has('page')).toBe(false)
  })

  it('seeds sort and page size from the saved view, with the URL taking precedence', () => {
    localStorage.setItem(
      'keystone.view.sales.orders',
      JSON.stringify({
        columnVisibility: {},
        columnSizing: {},
        density: 'comfortable',
        perPage: 50,
        sort: [{ id: 'total', desc: true }],
      }),
    )
    const fromView = renderHook(() => useListQuery(undefined, { viewKey: 'sales.orders' }))
    expect(fromView.result.current.query).toMatchObject({
      perPage: 50,
      sort: [{ id: 'total', desc: true }],
    })

    const { wrapper } = routerWrapper('/?sort=name')
    const { result } = renderHook(() => useUrlListQuery(undefined, { viewKey: 'sales.orders' }), {
      wrapper,
    })
    expect(result.current.query.sort).toEqual([{ id: 'name', desc: false }])
    expect(result.current.query.perPage).toBe(50)
  })
})
