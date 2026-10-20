import {
  DEFAULT_LIST_QUERY,
  fromSearchParams,
  pageCount,
  parseSort,
  setFilter,
  toListParams,
  toSearchParams,
  updateListQuery,
  type ListQueryState,
} from './listQuery'

const state: ListQueryState = {
  page: 3,
  perPage: 50,
  sort: [
    { id: 'issued_at', desc: true },
    { id: 'number', desc: false },
  ],
  filters: { status: 'approved', customer_id: 'c-1' },
  q: '  anadolu ',
}

describe('ListQuery params', () => {
  it('maps state to backend params', () => {
    expect(toListParams(state)).toEqual({
      page: 3,
      per_page: 50,
      sort: '-issued_at,number',
      q: 'anadolu',
      'filter[status]': 'approved',
      'filter[customer_id]': 'c-1',
    })
  })

  it('caps per_page at 100 and omits empty parts', () => {
    expect(toListParams({ ...DEFAULT_LIST_QUERY, perPage: 500, page: 0 })).toEqual({
      page: 1,
      per_page: 100,
    })
    expect(toListParams({ ...DEFAULT_LIST_QUERY, filters: { status: '' }, q: '  ' })).toEqual({
      page: 1,
      per_page: 25,
    })
  })

  it('round-trips through the URL', () => {
    const params = toSearchParams(state)
    expect(params.toString()).toBe(
      'page=3&per_page=50&sort=-issued_at%2Cnumber&q=anadolu&filter%5Bstatus%5D=approved&filter%5Bcustomer_id%5D=c-1',
    )
    expect(fromSearchParams(params)).toEqual({ ...state, q: 'anadolu' })
    expect(toSearchParams(DEFAULT_LIST_QUERY).toString()).toBe('')
    expect(fromSearchParams(new URLSearchParams('per_page=1000&page=-2'))).toMatchObject({
      perPage: 100,
      page: 1,
    })
  })

  it('parses sort strings', () => {
    expect(parseSort('-a, b,,-')).toEqual([
      { id: 'a', desc: true },
      { id: 'b', desc: false },
    ])
    expect(parseSort(null)).toEqual([])
  })

  it('returns to page 1 on anything but a page change', () => {
    expect(updateListQuery(state, { page: 4 }).page).toBe(4)
    expect(updateListQuery(state, { q: 'x' }).page).toBe(1)
    expect(updateListQuery(state, { perPage: 10 }).page).toBe(1)
    const cleared = setFilter(state, 'status', null)
    expect(cleared.filters).toEqual({ customer_id: 'c-1' })
    expect(cleared.page).toBe(1)
    expect(setFilter(state, 'status', 'draft').filters.status).toBe('draft')
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(101, 25)).toBe(5)
  })
})
